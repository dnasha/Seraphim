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

const supabaseAdmin = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET() {
    try {
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

        const { count } = await supabaseAdmin
            .from('angel_purchases')
            .select('*', { count: 'exact', head: true });

        const remaining = Math.max(0, maxQuantity - (count ?? 0));

        return NextResponse.json({ remaining, total: maxQuantity });
    } catch {
        return NextResponse.json({ remaining: ANGEL_MAX_QUANTITY, total: ANGEL_MAX_QUANTITY });
    }
}
