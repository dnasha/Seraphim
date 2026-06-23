import { describe, expect, it } from 'vitest';
import { canUseMapStyle, canUseOverlay, canUseTimeRange, getEntitlements, hasFeature, normalizeUserTier } from '@/lib/entitlements';

describe('tier entitlements', () => {
  it('keeps Angel exactly equivalent to Analyst access', () => {
    const analyst = getEntitlements('analyst');
    const angel = getEntitlements('angel');
    expect({ ...angel, tier: 'analyst' }).toEqual(analyst);
  });

  it('sets the intended story, history, and workflow boundaries', () => {
    expect(getEntitlements('guest').eventLimit).toBe(10);
    expect(getEntitlements('free').eventLimit).toBe(100);
    expect(getEntitlements('pro').eventLimit).toBe(1000);
    expect(canUseTimeRange('free', '1w')).toBe(false);
    expect(canUseTimeRange('pro', '1m')).toBe(true);
    expect(canUseTimeRange('pro', 'custom')).toBe(false);
    expect(canUseTimeRange('analyst', 'custom')).toBe(true);
    expect(hasFeature('pro', 'geoJsonTransfer')).toBe(false);
    expect(hasFeature('analyst', 'geoJsonTransfer')).toBe(true);
  });

  it('separates map intelligence into Free, Pro, and Analyst value', () => {
    expect(canUseOverlay('free', 'usgs')).toBe(true);
    expect(canUseOverlay('free', 'fires')).toBe(false);
    expect(canUseOverlay('pro', 'fires')).toBe(true);
    expect(canUseOverlay('pro', 'flights')).toBe(false);
    expect(canUseOverlay('analyst', 'flights')).toBe(true);
    expect(canUseMapStyle('free', 'satellite')).toBe(false);
    expect(canUseMapStyle('pro', 'satellite')).toBe(true);
  });

  it('normalizes unknown persisted tiers safely', () => {
    expect(normalizeUserTier('invalid', false)).toBe('guest');
    expect(normalizeUserTier('invalid', true)).toBe('free');
  });
});
