import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  enabled: true,
  origin: 'https://seraphim.example',
  sameOrigin: true,
  rateLimit: { allowed: true, retryAfterSeconds: 0 },
  getUser: vi.fn(),
  create: vi.fn(),
  profile: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getUser: mocks.getUser } }) }));
vi.mock('@/lib/stripe', () => ({ stripe: { billingPortal: { sessions: { create: mocks.create } } } }));
vi.mock('@/lib/security/payments', () => ({ isBillingPortalEnabled: () => mocks.enabled, getConfiguredSiteUrl: () => mocks.origin }));
vi.mock('@/lib/security/sensitiveRequest', () => ({
  hasValidSameOrigin: () => mocks.sameOrigin,
  checkSensitiveRateLimit: async () => mocks.rateLimit,
}));
vi.mock('@/lib/server/effectiveProfile', () => ({ resolveEffectiveProfile: mocks.profile }));
vi.mock('@/lib/server/operations', () => ({ recordMetric: vi.fn(), recordIncident: vi.fn() }));

import { POST } from '@/app/api/stripe/portal/route';

describe('POST /api/stripe/portal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.enabled = true;
    mocks.origin = 'https://seraphim.example';
    mocks.sameOrigin = true;
    mocks.rateLimit = { allowed: true, retryAfterSeconds: 0 };
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
    mocks.profile.mockResolvedValue({ stripeCustomerId: 'cus-1' });
    mocks.create.mockResolvedValue({ url: 'https://billing.stripe.example/session' });
  });

  it('independently disables portal creation before authentication', async () => {
    mocks.enabled = false;
    expect((await POST()).status).toBe(503);
    expect(mocks.getUser).not.toHaveBeenCalled();
  });

  it('rejects cross-origin portal requests before authentication', async () => {
    mocks.sameOrigin = false;
    expect((await POST()).status).toBe(403);
    expect(mocks.getUser).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('fails closed when the sensitive-action limiter is unavailable', async () => {
    mocks.rateLimit = { allowed: false, retryAfterSeconds: 60 };
    const response = await POST();
    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('60');
    expect(mocks.profile).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('requires authentication and a linked billing customer', async () => {
    mocks.getUser.mockResolvedValueOnce({ data: { user: null }, error: null });
    expect((await POST()).status).toBe(401);
    mocks.profile.mockResolvedValueOnce({ stripeCustomerId: null });
    expect((await POST()).status).toBe(404);
  });

  it('creates a portal session for the effective profile customer', async () => {
    const response = await POST();
    expect(await response.json()).toEqual({ url: 'https://billing.stripe.example/session' });
    expect(mocks.create).toHaveBeenCalledWith({ customer: 'cus-1', return_url: 'https://seraphim.example/account' });
  });
});
