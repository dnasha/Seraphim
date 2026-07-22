import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  from: vi.fn(),
  sessionRetrieve: vi.fn(),
  sessionExpire: vi.fn(),
  recordMetric: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: mocks.getUser } }),
}));
vi.mock('@/lib/core/supabase-admin', () => ({
  supabaseAdmin: { from: mocks.from },
}));
vi.mock('@/lib/stripe', () => ({
  stripe: { checkout: { sessions: { retrieve: mocks.sessionRetrieve, expire: mocks.sessionExpire } } },
}));
vi.mock('@/lib/security/payments', () => ({
  getConfiguredSiteUrl: () => 'https://seraphim.example',
}));
vi.mock('@/lib/security/sensitiveRequest', () => ({
  hasValidSameOrigin: () => true,
  checkSensitiveRateLimit: async () => ({ allowed: true }),
}));
vi.mock('@/lib/server/operations', () => ({ recordMetric: mocks.recordMetric }));

import { POST } from '@/app/api/stripe/checkout/cancel/route';

function query(result: unknown = null) {
  const value: Record<string, unknown> = {};
  value.select = vi.fn(() => value);
  value.update = vi.fn(() => value);
  value.eq = vi.fn(() => value);
  value.maybeSingle = vi.fn(async () => ({ data: result, error: null }));
  value.then = (resolve: (input: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(resolve);
  return value;
}

function request(intentId = '123e4567-e89b-42d3-a456-426614174000') {
  return new Request('https://seraphim.example/api/stripe/checkout/cancel', {
    method: 'POST',
    headers: { origin: 'https://seraphim.example', 'content-type': 'application/json' },
    body: JSON.stringify({ intentId }),
  });
}

describe('POST /api/stripe/checkout/cancel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
    mocks.from.mockReturnValue(query({
      id: '123e4567-e89b-42d3-a456-426614174000',
      status: 'open',
      stripe_session_id: 'cs-open',
    }));
    mocks.sessionRetrieve.mockResolvedValue({ id: 'cs-open', status: 'open' });
    mocks.sessionExpire.mockResolvedValue({ id: 'cs-open', status: 'expired' });
  });

  it('expires the authenticated user\'s open Session and releases its reservation', async () => {
    const response = await POST(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ cancelled: true });
    expect(mocks.sessionExpire).toHaveBeenCalledWith('cs-open');
    expect(mocks.recordMetric).toHaveBeenCalledWith(expect.objectContaining({ name: 'checkout_cancelled' }));
  });

  it('is idempotent when the reservation is already closed', async () => {
    mocks.from.mockReturnValue(query({
      id: '123e4567-e89b-42d3-a456-426614174000',
      status: 'expired',
      stripe_session_id: 'cs-expired',
    }));

    const response = await POST(request());

    await expect(response.json()).resolves.toEqual({ cancelled: false });
    expect(mocks.sessionRetrieve).not.toHaveBeenCalled();
    expect(mocks.sessionExpire).not.toHaveBeenCalled();
  });
});
