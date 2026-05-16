/**
 * Server-side Stripe client singleton.
 * 
 * Initializes a single Stripe instance using the secret key from environment variables.
 * This module must only be imported from server-side code (API routes, Server Actions).
 * 
 * Uses lazy initialization to prevent build-time crashes when env vars are not set.
 */

import 'server-only';
import Stripe from 'stripe';

let _stripe: Stripe | null = null;

/** Lazily initialized Stripe client — throws at call time (not import time) if key is missing */
export function getStripe(): Stripe {
    if (!_stripe) {
        const key = process.env.STRIPE_SECRET_KEY;
        if (!key) {
            throw new Error('Missing STRIPE_SECRET_KEY environment variable');
        }
        _stripe = new Stripe(key, {
            typescript: true,
        });
    }
    return _stripe;
}

/** 
 * Convenience alias — use this in route handlers.
 * @example const session = await stripe.checkout.sessions.create(...)
 */
export const stripe = new Proxy({} as Stripe, {
    get(_, prop) {
        return Reflect.get(getStripe(), prop);
    },
});

/**
 * Price ID mapping for Stripe products.
 * These must be created in the Stripe Dashboard and their IDs set as env vars.
 * 
 * Required env vars:
 * - STRIPE_PRICE_PRO_MONTHLY
 * - STRIPE_PRICE_PRO_YEARLY
 * - STRIPE_PRICE_ANALYST_MONTHLY
 * - STRIPE_PRICE_ANALYST_YEARLY
 * - STRIPE_PRICE_ANGEL (one-time payment)
 */
export const STRIPE_PRICES = {
    pro_monthly: process.env.STRIPE_PRICE_PRO_MONTHLY ?? '',
    pro_yearly: process.env.STRIPE_PRICE_PRO_YEARLY ?? '',
    analyst_monthly: process.env.STRIPE_PRICE_ANALYST_MONTHLY ?? '',
    analyst_yearly: process.env.STRIPE_PRICE_ANALYST_YEARLY ?? '',
    angel: process.env.STRIPE_PRICE_ANGEL ?? '',
} as const;

/** Maximum number of Angel lifetime purchases */
export const ANGEL_MAX_QUANTITY = 100;

/** Map a price ID back to its tier name */
export function tierFromPriceId(priceId: string): string {
    if (priceId === STRIPE_PRICES.pro_monthly || priceId === STRIPE_PRICES.pro_yearly) return 'pro';
    if (priceId === STRIPE_PRICES.analyst_monthly || priceId === STRIPE_PRICES.analyst_yearly) return 'analyst';
    if (priceId === STRIPE_PRICES.angel) return 'angel';
    return 'free';
}

/** Map a price ID to its billing interval */
export function intervalFromPriceId(priceId: string): string {
    if (priceId === STRIPE_PRICES.pro_yearly || priceId === STRIPE_PRICES.analyst_yearly) return 'year';
    if (priceId === STRIPE_PRICES.angel) return 'lifetime';
    return 'month';
}
