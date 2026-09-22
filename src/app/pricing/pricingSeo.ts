import { safeRelativePath } from '@/lib/security/redirects';
import { TIERS } from './pricingConstants';

export interface PricingSearchParams {
  returnTo: string;
  requestedFeature: string | null;
  recommendedTier: 'pro' | 'analyst' | null;
  cancelledCheckoutIntent: string | null;
  initialPriceKey: string | null;
}

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export function sanitizeReturnTo(value: string | string[] | undefined) {
  return safeRelativePath(firstValue(value));
}

export function parsePricingSearchParams(
  params: Record<string, string | string[] | undefined>,
): PricingSearchParams {
  const feature = firstValue(params.feature)?.trim().slice(0, 80) || null;
  const tier = firstValue(params.tier);
  const plan = firstValue(params.plan);
  const initialPriceKey = plan && TIERS.some((tier) => tier.priceKeyMonthly === plan || tier.priceKeyYearly === plan)
    ? plan
    : null;
  const recommendedTier = tier === 'pro' || tier === 'analyst' ? tier : null;
  const checkoutIntent = firstValue(params.checkoutIntent);
  const cancelledCheckoutIntent = firstValue(params.checkout) === 'cancelled'
    && checkoutIntent
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(checkoutIntent)
    ? checkoutIntent
    : null;

  return {
    returnTo: sanitizeReturnTo(params.returnTo),
    requestedFeature: feature,
    initialPriceKey,
    recommendedTier,
    cancelledCheckoutIntent,
  };
}
