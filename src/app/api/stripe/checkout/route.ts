/**
 * Stripe Checkout Session API Route
 * 
 * Creates a Stripe Checkout Session for subscription or one-time (Angel) purchases.
 * Validates the authenticated user, retrieves/creates a Stripe Customer,
 * and returns the Checkout URL for client-side redirect.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { stripe, STRIPE_PRICES, ANGEL_MAX_QUANTITY } from '@/lib/stripe';
import { createClient as createServiceClient } from '@supabase/supabase-js';
import { getConfiguredSiteUrl, isPaymentsEnabled } from '@/lib/security/payments';

const supabaseAdmin = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

type PriceKey = keyof typeof STRIPE_PRICES;

export async function POST(request: NextRequest) {
    try {
        if (!isPaymentsEnabled()) {
            return NextResponse.json({ error: 'Payments are currently disabled' }, { status: 503 });
        }

        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json() as { priceKey: string; returnTo?: string };
        const { priceKey } = body;
        const returnTo = body.returnTo?.startsWith('/') && !body.returnTo.startsWith('//')
            ? body.returnTo
            : '/';

        if (!priceKey || !(priceKey in STRIPE_PRICES)) {
            return NextResponse.json({ error: 'Invalid price key' }, { status: 400 });
        }

        const priceId = STRIPE_PRICES[priceKey as PriceKey];
        if (!priceId) {
            return NextResponse.json({ error: 'Price not configured' }, { status: 500 });
        }

        // Check Angel tier availability — dual enforcement (Stripe metadata + Supabase count)
        if (priceKey === 'angel') {
            // Read inventory limit from Stripe product metadata
            const price = await stripe.prices.retrieve(priceId, { expand: ['product'] });
            const product = price.product as { metadata?: Record<string, string> };
            const stripeInventory = parseInt(product?.metadata?.inventory ?? String(ANGEL_MAX_QUANTITY), 10);
            const maxQuantity = Math.min(stripeInventory, ANGEL_MAX_QUANTITY);

            const { count } = await supabaseAdmin
                .from('angel_purchases')
                .select('*', { count: 'exact', head: true });
            
            if ((count ?? 0) >= maxQuantity) {
                return NextResponse.json({ error: 'Angel tier is sold out' }, { status: 410 });
            }
        }

        // Get or create Stripe customer
        const { data: profile } = await supabaseAdmin
            .from('user_profiles')
            .select('stripe_customer_id')
            .eq('id', user.id)
            .single();

        let customerId = profile?.stripe_customer_id;

        if (!customerId) {
            const customer = await stripe.customers.create({
                email: user.email,
                metadata: {
                    supabase_user_id: user.id,
                },
            });
            customerId = customer.id;

            await supabaseAdmin
                .from('user_profiles')
                .update({ stripe_customer_id: customerId })
                .eq('id', user.id);
        }

        const isAngel = priceKey === 'angel';
        const isProMonthly = priceKey === 'pro_monthly';

        const origin = getConfiguredSiteUrl();
        if (!origin) {
            return NextResponse.json({ error: 'Site URL is not configured' }, { status: 500 });
        }

        const sessionParams: Parameters<typeof stripe.checkout.sessions.create>[0] = {
            customer: customerId,
            line_items: [{ price: priceId, quantity: 1 }],
            mode: isAngel ? 'payment' : 'subscription',
            success_url: `${origin}${returnTo}${returnTo.includes('?') ? '&' : '?'}checkout=success`,
            cancel_url: `${origin}${returnTo}${returnTo.includes('?') ? '&' : '?'}checkout=cancelled`,
            metadata: {
                supabase_user_id: user.id,
                price_key: priceKey,
            },
            allow_promotion_codes: true,
        };

        // Add 7-day trial for Pro monthly only
        if (!isAngel && isProMonthly) {
            sessionParams.subscription_data = {
                trial_period_days: 7,
                metadata: {
                    supabase_user_id: user.id,
                    price_key: priceKey,
                },
            };
        } else if (!isAngel) {
            sessionParams.subscription_data = {
                metadata: {
                    supabase_user_id: user.id,
                    price_key: priceKey,
                },
            };
        }

        // Angel is a one-time payment, add metadata for fulfillment
        if (isAngel) {
            sessionParams.payment_intent_data = {
                metadata: {
                    supabase_user_id: user.id,
                    price_key: priceKey,
                },
            };
        }

        const session = await stripe.checkout.sessions.create(sessionParams);

        return NextResponse.json({ url: session.url });
    } catch (err) {
        console.error('Stripe checkout error:', err);
        return NextResponse.json(
            { error: 'Failed to create checkout session' },
            { status: 500 }
        );
    }
}
