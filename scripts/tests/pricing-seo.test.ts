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
    expect(sanitizeReturnTo('/\\evil.example')).toBe('/');
    expect(sanitizeReturnTo('/account\nnext')).toBe('/');
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
      cancelledCheckoutIntent: null,
      initialPriceKey: null,
    });

    expect(parsePricingSearchParams({ tier: 'angel' }).recommendedTier).toBeNull();
  });

  it('restores only recognized checkout plans after signup', () => {
    expect(parsePricingSearchParams({ plan: 'analyst_monthly' }).initialPriceKey).toBe('analyst_monthly');
    expect(parsePricingSearchParams({ plan: 'pro_yearly' }).initialPriceKey).toBe('pro_yearly');
    expect(parsePricingSearchParams({ plan: 'angel' }).initialPriceKey).toBe('angel');
    expect(parsePricingSearchParams({ plan: 'free_monthly' }).initialPriceKey).toBeNull();
    expect(parsePricingSearchParams({ plan: 'https://example.com' }).initialPriceKey).toBeNull();
    expect(parsePricingSearchParams({ plan: '' }).initialPriceKey).toBeNull();
  });

  it('accepts only UUID checkout intents on an explicit cancellation return', () => {
    expect(parsePricingSearchParams({
      checkout: 'cancelled',
      checkoutIntent: '123e4567-e89b-42d3-a456-426614174000',
    }).cancelledCheckoutIntent).toBe('123e4567-e89b-42d3-a456-426614174000');
    expect(parsePricingSearchParams({
      checkout: 'success',
      checkoutIntent: '123e4567-e89b-42d3-a456-426614174000',
    }).cancelledCheckoutIntent).toBeNull();
    expect(parsePricingSearchParams({
      checkout: 'cancelled',
      checkoutIntent: 'not-an-intent',
    }).cancelledCheckoutIntent).toBeNull();
  });
});
