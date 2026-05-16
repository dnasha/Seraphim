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
import { stripe, tierFromPriceId, intervalFromPriceId } from '@/lib/stripe';
import { createClient as createServiceClient } from '@supabase/supabase-js';

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

    try {
        switch (event.type) {
            case 'checkout.session.completed': {
                await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
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
                console.log(`Unhandled Stripe event type: ${event.type}`);
        }
    } catch (err) {
        console.error(`Error processing webhook ${event.type}:`, err);
        // Return 200 to prevent Stripe retries on application errors
        // The error is logged for manual investigation
    }

    return NextResponse.json({ received: true });
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
        // Angel one-time purchase
        await supabaseAdmin
            .from('user_profiles')
            .update({
                tier: 'angel',
                subscription_status: 'active',
                billing_interval: 'lifetime',
                stripe_customer_id: session.customer as string,
            })
            .eq('id', userId);

        // Record angel purchase for quantity tracking
        await supabaseAdmin
            .from('angel_purchases')
            .insert({
                user_id: userId,
                stripe_payment_intent_id: session.payment_intent as string,
            });

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
                stripe_customer_id: session.customer as string,
                stripe_subscription_id: subscription.id,
                subscription_status: subscription.status,
                billing_interval: interval,
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
        const customerId = typeof subscription.customer === 'string'
            ? subscription.customer
            : subscription.customer;
        
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
        const customerId = typeof subscription.customer === 'string'
            ? subscription.customer
            : subscription.customer;

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

    const customerId = typeof invoice.customer === 'string'
        ? invoice.customer
        : invoice.customer;

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
            trial_ends_at: subscription.trial_end
                ? new Date(subscription.trial_end * 1000).toISOString()
                : null,
            current_period_end: subscription.items.data[0]?.current_period_end
                ? new Date(subscription.items.data[0].current_period_end * 1000).toISOString()
                : null,
        })
        .eq('id', userId);
}
