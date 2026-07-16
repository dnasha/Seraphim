import { describe, expect, it } from 'vitest';

import { parsePricingSearchParams, sanitizeReturnTo } from '@/app/pricing/pricingSeo';

describe('pricing search parameters', () => {
  it('preserves safe local return destinations', () => {
    expect(sanitizeReturnTo('/?eventId=123')).toBe('/?eventId=123');
    expect(sanitizeReturnTo(['/account', '/ignored'])).toBe('/account');
  });

  it('rejects external and protocol-relative return destinations', () => {
    expect(sanitizeReturnTo('https://example.com')).toBe('/');
    expect(sanitizeReturnTo('//example.com')).toBe('/');
    expect(sanitizeReturnTo(undefined)).toBe('/');
  });

  it('preserves and bounds existing feature-gate context', () => {
    expect(parsePricingSearchParams({
      returnTo: '/account',
      tier: 'analyst',
      feature: `  ${'x'.repeat(100)}  `,
    })).toEqual({
      returnTo: '/account',
      recommendedTier: 'analyst',
      requestedFeature: 'x'.repeat(80),
    });

    expect(parsePricingSearchParams({ tier: 'angel' }).recommendedTier).toBeNull();
  });
});
