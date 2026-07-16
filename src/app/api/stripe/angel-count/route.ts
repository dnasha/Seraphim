/**
 * Angel Tier Availability API
 * 
 * Returns the number of remaining Angel tier purchases.
 * Reads the max inventory from the Stripe product metadata `inventory` field,
 * falls back to 100 if not set, and cross-checks against Supabase purchase count.
 * 
 * Public endpoint — no auth required.
 */

import { NextResponse } from 'next/server';
import { createClient as createServiceClient } from '@supabase/supabase-js';
import { stripe, STRIPE_PRICES, ANGEL_MAX_QUANTITY } from '@/lib/stripe';
import { isAngelCheckoutEnabled } from '@/lib/security/payments';

const supabaseAdmin = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET() {
    try {
        if (!isAngelCheckoutEnabled()) {
            return NextResponse.json({ error: 'Payments are currently disabled' }, { status: 503 });
        }

        // Read max inventory from Stripe product metadata
        let maxQuantity = ANGEL_MAX_QUANTITY;
        const angelPriceId = STRIPE_PRICES.angel;

        if (angelPriceId) {
            try {
                const price = await stripe.prices.retrieve(angelPriceId, { expand: ['product'] });
                const product = price.product as { metadata?: Record<string, string> };
                const stripeInventory = parseInt(product?.metadata?.inventory ?? '', 10);
                if (!isNaN(stripeInventory) && stripeInventory > 0) {
                    maxQuantity = Math.min(stripeInventory, ANGEL_MAX_QUANTITY);
                }
            } catch {
                // Stripe lookup failed — fall back to app-level default
            }
        }

        const { count, error: purchaseCountError } = await supabaseAdmin
            .from('angel_purchases')
            .select('*', { count: 'exact', head: true });

        const { count: reservedCount, error: reservationCountError } = await supabaseAdmin
            .from('billing_checkout_intents')
            .select('*', { count: 'exact', head: true })
            .eq('price_key', 'angel')
            .in('status', ['creating', 'open', 'pending_payment']);
        if (purchaseCountError || reservationCountError) throw new Error('inventory_count_unavailable');

        const remaining = Math.max(0, maxQuantity - (count ?? 0) - (reservedCount ?? 0));

        return NextResponse.json({ remaining, total: maxQuantity });
    } catch {
        return NextResponse.json({ error: 'Angel availability is temporarily unavailable.' }, { status: 503 });
    }
}
