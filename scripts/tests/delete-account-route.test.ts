import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  getClaims: vi.fn(),
  deleteUser: vi.fn(),
  from: vi.fn(),
  deleteCustomer: vi.fn(),
  profile: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getUser: mocks.getUser, getClaims: mocks.getClaims } }) }));
vi.mock('@/lib/core/supabase-admin', () => ({ supabaseAdmin: { from: mocks.from, auth: { admin: { deleteUser: mocks.deleteUser } } } }));
vi.mock('@/lib/stripe', () => ({ stripe: { customers: { del: mocks.deleteCustomer } } }));
vi.mock('@/lib/server/effectiveProfile', () => ({ resolveEffectiveProfile: mocks.profile }));
vi.mock('@/lib/security/payments', () => ({ getConfiguredSiteUrl: () => 'https://seraphim.example' }));
vi.mock('@/lib/security/sensitiveRequest', () => ({
  hasValidSameOrigin: (request: Request, origin: string) => request.headers.get('origin') === origin,
  checkSensitiveRateLimit: async () => ({ allowed: true }),
}));
vi.mock('@/lib/server/operations', () => ({ recordMetric: vi.fn(), recordIncident: vi.fn() }));

import { POST } from '@/app/api/auth/delete-account/route';

function req(origin = 'https://seraphim.example') {
  return new Request('https://seraphim.example/api/auth/delete-account', { method: 'POST', headers: origin ? { origin } : {} });
}

function query(table: string) {
  let operation = 'select';
  const value: Record<string, unknown> = {};
  value.select = vi.fn(() => value);
  value.eq = vi.fn(() => value);
  value.neq = vi.fn(() => value);
  value.insert = vi.fn(() => { operation = 'insert'; return value; });
  value.update = vi.fn(() => { operation = 'update'; return value; });
  value.delete = vi.fn(() => { operation = 'delete'; return value; });
  value.maybeSingle = vi.fn(async () => ({ data: null, error: null }));
  value.single = vi.fn(async () => ({ data: operation === 'insert' && table === 'account_deletion_jobs' ? { id: 'job-1' } : null, error: null }));
  value.then = (resolve: (input: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(resolve);
  return value;
}

describe('POST /api/auth/delete-account', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'user-1', last_sign_in_at: new Date().toISOString() } }, error: null });
    mocks.getClaims.mockResolvedValue({ data: { claims: { sub: 'user-1', session_id: 'session-1', amr: [{ method: 'otp', timestamp: Math.floor(Date.now() / 1000) }] } }, error: null });
    mocks.deleteUser.mockResolvedValue({ error: null });
    mocks.deleteCustomer.mockResolvedValue({ deleted: true });
    mocks.profile.mockResolvedValue({ stripeCustomerId: 'cus-1', stripeSubscriptionId: 'sub-1' });
    mocks.from.mockImplementation(query);
  });

  it('rejects cross-origin requests before authentication', async () => {
    expect((await POST(req('https://evil.example'))).status).toBe(403);
    expect(mocks.getUser).not.toHaveBeenCalled();
  });

  it('requires authentication and recent email verification', async () => {
    mocks.getUser.mockResolvedValueOnce({ data: { user: null }, error: null });
    expect((await POST(req())).status).toBe(401);
    mocks.getClaims.mockResolvedValueOnce({ data: { claims: { sub: 'user-1', session_id: 'old-session', amr: [{ method: 'otp', timestamp: 1 }] } }, error: null });
    expect((await POST(req())).status).toBe(403);
  });

  it('deletes Stripe billing immediately, pseudonymizes operations, and deletes Auth', async () => {
    const response = await POST(req());
    expect(response.status).toBe(200);
    expect(mocks.deleteCustomer).toHaveBeenCalledWith('cus-1');
    expect(mocks.from).toHaveBeenCalledWith('user_entitlement_overrides');
    expect(mocks.from).toHaveBeenCalledWith('billing_checkout_intents');
    expect(mocks.from).toHaveBeenCalledWith('angel_purchases');
    expect(mocks.deleteUser).toHaveBeenCalledWith('user-1');
  });

  it('returns a resumable reference when Auth deletion fails', async () => {
    mocks.deleteUser.mockResolvedValue({ error: { message: 'failed' } });
    const response = await POST(req());
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: 'deletion_failed', reference: 'job-1' });
  });

  it('does not return success when finalization fails after Auth deletion', async () => {
    let calls = 0;
    mocks.from.mockImplementation((table: string) => {
      const result = query(table);
      if (table === 'account_deletion_jobs' && ++calls === 4) {
        result.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ error: { message: 'database unavailable' } }).then(resolve);
      }
      return result;
    });
    const response = await POST(req());
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ reference: 'job-1', error: expect.stringContaining('Your account was deleted') });
  });
});
