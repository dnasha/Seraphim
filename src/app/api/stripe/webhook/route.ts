/**
 * Stripe Webhook Handler
 * 
 * Processes Stripe webhook events to synchronize subscription state with Supabase.
 * Handles: checkout completion, subscription updates/deletions, payment success/failure.
 * 
 * Security: Verifies Stripe signature on every request.
 * Uses Supabase service-role client to bypass RLS for writes.
 */

import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { stripe, tierFromPriceId, intervalFromPriceId, STRIPE_PRICES, ANGEL_MAX_QUANTITY } from '@/lib/stripe';
import { createClient as createServiceClient } from '@supabase/supabase-js';
import { canFulfillAngelCheckout } from '@/lib/security/payments';

const supabaseAdmin = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!;

/**
 * Next.js App Router requires explicit body parsing config.
 * Stripe webhooks need the raw body for signature verification.
 */
export async function POST(request: NextRequest) {
    const body = await request.text();
    const signature = request.headers.get('stripe-signature');

    if (!signature) {
        return NextResponse.json({ error: 'Missing stripe-signature header' }, { status: 400 });
    }

    let event: Stripe.Event;

    try {
        event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
    } catch (err) {
        console.error('⚠️ Webhook signature verification failed:', err);
        return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
    }

    const claimed = await claimStripeEvent(event.id, event.type);
    if (!claimed) {
        return NextResponse.json({ received: true, duplicate: true });
    }

    try {
        switch (event.type) {
            case 'checkout.session.completed': {
                await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
                break;
            }
            case 'checkout.session.async_payment_succeeded': {
                await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
                break;
            }
            case 'checkout.session.async_payment_failed': {
                break;
            }
            case 'customer.subscription.updated': {
                await handleSubscriptionUpdated(event.data.object as Stripe.Subscription);
                break;
            }
            case 'customer.subscription.deleted': {
                await handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
                break;
            }
            case 'invoice.payment_succeeded': {
                await handlePaymentSucceeded(event.data.object as Stripe.Invoice);
                break;
            }
            case 'invoice.payment_failed': {
                await handlePaymentFailed(event.data.object as Stripe.Invoice);
                break;
            }
            default:
                console.debug(`Unhandled Stripe event type: ${event.type}`);
        }
    } catch (err) {
        console.error(`Error processing webhook ${event.type}:`, err);
        await releaseStripeEventClaim(event.id);
        return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 });
    }

    return NextResponse.json({ received: true });
}

async function claimStripeEvent(eventId: string, eventType: string) {
    const { error } = await supabaseAdmin
        .from('stripe_processed_events')
        .insert({ event_id: eventId, event_type: eventType });

    if (!error) return true;
    if (error.code === '23505') return false;
    throw error;
}

async function releaseStripeEventClaim(eventId: string) {
    const { error } = await supabaseAdmin
        .from('stripe_processed_events')
        .delete()
        .eq('event_id', eventId);
    if (error) {
        console.error('Failed to release Stripe event claim:', error);
    }
}

function getCustomerId(customer: string | Stripe.Customer | Stripe.DeletedCustomer | null) {
    if (!customer) return null;
    return typeof customer === 'string' ? customer : customer.id;
}

/**
 * Checkout completed — set up the user's subscription/purchase.
 */
async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
    const userId = session.metadata?.supabase_user_id;
    const priceKey = session.metadata?.price_key;

    if (!userId || !priceKey) {
        console.error('Missing metadata in checkout session:', session.id);
        return;
    }

    if (session.mode === 'payment' && priceKey === 'angel') {
        if (!canFulfillAngelCheckout({
            mode: session.mode,
            priceKey,
            paymentStatus: session.payment_status,
            paymentIntent: session.payment_intent,
        })) {
            console.warn('Angel checkout completed before payment was paid:', session.id);
            return;
        }

        const maxQuantity = await getAngelMaxQuantity();
        const { data: fulfilled, error } = await supabaseAdmin.rpc('fulfill_angel_purchase', {
            p_user_id: userId,
            p_stripe_payment_intent_id: session.payment_intent,
            p_stripe_customer_id: typeof session.customer === 'string' ? session.customer : null,
            p_max_quantity: maxQuantity,
        });

        if (error) throw error;
        if (fulfilled !== true) {
            throw new Error(`Angel tier fulfillment failed or sold out for session ${session.id}`);
        }

        // Angel one-time purchase
        return;
    }

    if (session.mode === 'subscription' && session.subscription) {
        const subscription = await stripe.subscriptions.retrieve(session.subscription as string);
        const priceId = subscription.items.data[0]?.price?.id ?? '';
        const tier = tierFromPriceId(priceId);
        const interval = intervalFromPriceId(priceId);

        await supabaseAdmin
            .from('user_profiles')
            .update({
                tier,
                stripe_customer_id: getCustomerId(session.customer),
                stripe_subscription_id: subscription.id,
                subscription_status: subscription.status,
                billing_interval: interval,
                cancel_at_period_end: subscription.cancel_at_period_end ?? false,
                trial_ends_at: subscription.trial_end
                    ? new Date(subscription.trial_end * 1000).toISOString()
                    : null,
                current_period_end: subscription.items.data[0]?.current_period_end
                    ? new Date(subscription.items.data[0].current_period_end * 1000).toISOString()
                    : null,
            })
            .eq('id', userId);
    }
}

/**
 * Subscription updated — sync status changes (active, past_due, trialing, canceled).
 */
async function handleSubscriptionUpdated(subscription: Stripe.Subscription) {
    const userId = subscription.metadata?.supabase_user_id;
    if (!userId) {
        // Try to find user by customer ID
        const customerId = getCustomerId(subscription.customer);
        if (!customerId) return;
        
        const { data: profile } = await supabaseAdmin
            .from('user_profiles')
            .select('id')
            .eq('stripe_customer_id', customerId)
            .single();

        if (!profile) {
            console.error('No user found for subscription:', subscription.id);
            return;
        }
        
        await syncSubscription(profile.id, subscription);
        return;
    }

    await syncSubscription(userId, subscription);
}

/**
 * Subscription deleted — downgrade user to free tier.
 */
async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
    const userId = subscription.metadata?.supabase_user_id;
    let targetUserId = userId;

    if (!targetUserId) {
        const customerId = getCustomerId(subscription.customer);
        if (!customerId) return;

        const { data: profile } = await supabaseAdmin
            .from('user_profiles')
            .select('id, tier')
            .eq('stripe_customer_id', customerId)
            .single();

        if (!profile) return;
        
        // Don't downgrade Angel users (their purchase is lifetime)
        if (profile.tier === 'angel') return;

        targetUserId = profile.id;
    }

    if (!targetUserId) return;

    // Check if angel before downgrading
    const { data: currentProfile } = await supabaseAdmin
        .from('user_profiles')
        .select('tier')
        .eq('id', targetUserId)
        .single();

    if (currentProfile?.tier === 'angel') return;

    await supabaseAdmin
        .from('user_profiles')
        .update({
            tier: 'free',
            subscription_status: 'canceled',
            stripe_subscription_id: null,
            trial_ends_at: null,
            current_period_end: null,
            cancel_at_period_end: false,
        })
        .eq('id', targetUserId);
}

/**
 * Payment succeeded — confirms the subscription is active.
 */
async function handlePaymentSucceeded(invoice: Stripe.Invoice) {
    // In Stripe v22+, subscription is accessed via invoice.parent
    const subRef = invoice.parent?.subscription_details?.subscription;
    if (!subRef) return;
    const subId = typeof subRef === 'string' ? subRef : subRef.id;

    const subscription = await stripe.subscriptions.retrieve(subId);
    const userId = subscription.metadata?.supabase_user_id;

    if (userId) {
        await syncSubscription(userId, subscription);
    }
}

/**
 * Payment failed — mark subscription as past_due.
 */
async function handlePaymentFailed(invoice: Stripe.Invoice) {
    // In Stripe v22+, subscription is accessed via invoice.parent
    const subRef = invoice.parent?.subscription_details?.subscription;
    if (!subRef) return;

    const customerId = getCustomerId(invoice.customer);
    if (!customerId) return;

    const { data: profile } = await supabaseAdmin
        .from('user_profiles')
        .select('id')
        .eq('stripe_customer_id', customerId)
        .single();

    if (profile) {
        await supabaseAdmin
            .from('user_profiles')
            .update({ subscription_status: 'past_due' })
            .eq('id', profile.id);
    }
}

async function getAngelMaxQuantity() {
    const priceId = STRIPE_PRICES.angel;
    if (!priceId) return ANGEL_MAX_QUANTITY;

    try {
        const price = await stripe.prices.retrieve(priceId, { expand: ['product'] });
        const product = price.product as { metadata?: Record<string, string> };
        const stripeInventory = parseInt(product?.metadata?.inventory ?? '', 10);
        if (Number.isFinite(stripeInventory) && stripeInventory > 0) {
            return Math.min(stripeInventory, ANGEL_MAX_QUANTITY);
        }
    } catch (err) {
        console.warn('Failed to retrieve Angel inventory from Stripe metadata:', err);
    }

    return ANGEL_MAX_QUANTITY;
}

/**
 * Shared helper to sync a Stripe subscription state to user_profiles.
 */
async function syncSubscription(userId: string, subscription: Stripe.Subscription) {
    const priceId = subscription.items.data[0]?.price?.id ?? '';
    const tier = tierFromPriceId(priceId);
    const interval = intervalFromPriceId(priceId);

    // If subscription is canceled/expired, downgrade to free
    const isActive = ['active', 'trialing', 'past_due'].includes(subscription.status);

    await supabaseAdmin
        .from('user_profiles')
        .update({
            tier: isActive ? tier : 'free',
            stripe_subscription_id: subscription.id,
            subscription_status: subscription.status,
            billing_interval: isActive ? interval : 'month',
            cancel_at_period_end: subscription.cancel_at_period_end ?? false,
            trial_ends_at: subscription.trial_end
                ? new Date(subscription.trial_end * 1000).toISOString()
                : null,
            current_period_end: subscription.items.data[0]?.current_period_end
                ? new Date(subscription.items.data[0].current_period_end * 1000).toISOString()
                : null,
        })
        .eq('id', userId);
}
