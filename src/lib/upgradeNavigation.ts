import { safeRelativePath } from '@/lib/security/redirects';
import type { RequiredAccessTier } from '@/lib/entitlements';

/** Capture at interaction time: the map updates its URL without remounting. */
export function currentReturnPath() {
  if (typeof window === 'undefined') return '/';
  return safeRelativePath(`${window.location.pathname}${window.location.search}${window.location.hash}`);
}

export function pricingHref(returnTo: string, feature?: string, tier?: RequiredAccessTier) {
  const params = new URLSearchParams({ returnTo: safeRelativePath(returnTo) });
  if (feature) params.set('feature', feature);
  if (tier) params.set('tier', tier);
  return `/pricing?${params.toString()}`;
}
