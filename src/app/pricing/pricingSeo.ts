export interface PricingSearchParams {
  returnTo: string;
  requestedFeature: string | null;
  recommendedTier: 'pro' | 'analyst' | null;
}

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export function sanitizeReturnTo(value: string | string[] | undefined) {
  const candidate = firstValue(value);
  if (!candidate || !candidate.startsWith('/') || candidate.startsWith('//')) {
    return '/';
  }
  return candidate;
}

export function parsePricingSearchParams(
  params: Record<string, string | string[] | undefined>,
): PricingSearchParams {
  const feature = firstValue(params.feature)?.trim().slice(0, 80) || null;
  const tier = firstValue(params.tier);
  const recommendedTier = tier === 'pro' || tier === 'analyst' ? tier : null;

  return {
    returnTo: sanitizeReturnTo(params.returnTo),
    requestedFeature: feature,
    recommendedTier,
  };
}
