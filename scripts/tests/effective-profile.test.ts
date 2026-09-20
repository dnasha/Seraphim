import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock('@/lib/core/supabase-admin', () => ({ supabaseAdmin: { from: mocks.from } }));

import { resolveEffectiveProfile, resolveEffectiveTier, resolveStripeCustomerId } from '@/lib/server/effectiveProfile';

function query(data: unknown, error: unknown = null) {
  const result = {
    select: vi.fn(), eq: vi.fn(), is: vi.fn(), gt: vi.fn(), order: vi.fn(), limit: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue({ data, error }),
  };
  for (const name of ['select', 'eq', 'is', 'gt', 'order', 'limit'] as const) {
    result[name].mockReturnValue(result);
  }
  return result;
}

beforeEach(() => vi.clearAllMocks());

describe('narrow profile reads', () => {
  it('resolves an active override without requesting billing details or Angel history', async () => {
    const profile = query({ tier: 'free' });
    const override = query({ tier: 'analyst', expires_at: '2099-01-01T00:00:00Z' });
    mocks.from.mockImplementation((table: string) => table === 'user_profiles' ? profile : override);

    await expect(resolveEffectiveTier('user-1')).resolves.toBe('analyst');

    expect(mocks.from.mock.calls).toEqual([['user_profiles'], ['user_entitlement_overrides']]);
    expect(profile.select).toHaveBeenCalledWith('tier');
    expect(profile.eq).toHaveBeenCalledWith('id', 'user-1');
    expect(override.eq).toHaveBeenCalledWith('user_id', 'user-1');
    expect(override.is).toHaveBeenCalledWith('revoked_at', null);
    expect(override.gt).toHaveBeenCalledWith('expires_at', expect.any(String));
  });

  it.each([
    { profile: { tier: 'pro' }, override: null, error: null, expected: 'pro' },
    { profile: { tier: 'pro' }, override: { tier: 'analyst' }, error: new Error('override unavailable'), expected: 'pro' },
    { profile: null, override: null, error: null, expected: 'free' },
  ])('keeps the existing billing-tier fallback ($expected)', async ({ profile, override, error, expected }) => {
    mocks.from.mockImplementation((table: string) => table === 'user_profiles'
      ? query(profile)
      : query(override, error));

    await expect(resolveEffectiveTier('user-1')).resolves.toBe(expected);
  });

  it('reads only the billing customer column for portal creation', async () => {
    const profile = query({ stripe_customer_id: 'cus-1' });
    mocks.from.mockReturnValue(profile);

    await expect(resolveStripeCustomerId('user-1')).resolves.toBe('cus-1');
    expect(mocks.from.mock.calls).toEqual([['user_profiles']]);
    expect(profile.select).toHaveBeenCalledWith('stripe_customer_id');
    expect(profile.eq).toHaveBeenCalledWith('id', 'user-1');

    profile.maybeSingle.mockResolvedValueOnce({ data: null, error: null });
    await expect(resolveStripeCustomerId('missing-user')).resolves.toBeNull();
  });

  it('propagates profile failures instead of treating them as missing billing or free access', async () => {
    const error = new Error('profile unavailable');
    mocks.from.mockReturnValue(query(null, error));

    await expect(resolveEffectiveTier('user-1')).rejects.toBe(error);
    await expect(resolveStripeCustomerId('user-1')).rejects.toBe(error);
  });

  it('retains the complete account profile including overrides and Angel status', async () => {
    mocks.from.mockImplementation((table: string) => query(table === 'user_profiles'
      ? { tier: 'pro', stripe_customer_id: 'cus-1', subscription_status: 'active' }
      : table === 'user_entitlement_overrides'
        ? { tier: 'analyst', expires_at: '2099-01-01T00:00:00Z' }
        : { status: 'dispute_pending' }));

    await expect(resolveEffectiveProfile('user-1')).resolves.toMatchObject({
      billingTier: 'pro', effectiveTier: 'analyst', tierSource: 'override',
      overrideExpiresAt: '2099-01-01T00:00:00Z', stripeCustomerId: 'cus-1',
      subscriptionStatus: 'active', angelStatus: 'dispute_pending',
    });
  });
});
