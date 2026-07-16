import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  checkoutEnabled: true,
  angelEnabled: true,
  getUser: vi.fn(),
  rpc: vi.fn(),
  from: vi.fn(),
  customerCreate: vi.fn(),
  priceRetrieve: vi.fn(),
  sessionCreate: vi.fn(),
  sessionRetrieve: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getUser: mocks.getUser } }) }));
vi.mock('@/lib/core/supabase-admin', () => ({ supabaseAdmin: { rpc: mocks.rpc, from: mocks.from } }));
vi.mock('@/lib/security/payments', () => ({
  getConfiguredSiteUrl: () => 'https://seraphim.example',
  isCheckoutEnabled: () => mocks.checkoutEnabled,
  isAngelCheckoutEnabled: () => mocks.angelEnabled,
}));
vi.mock('@/lib/security/sensitiveRequest', () => ({ hasValidSameOrigin: () => true, checkSensitiveRateLimit: async () => ({ allowed: true }) }));
vi.mock('@/lib/server/operations', () => ({ recordMetric: vi.fn(), recordIncident: vi.fn() }));
vi.mock('@/lib/stripe', () => ({
  ANGEL_MAX_QUANTITY: 100,
  STRIPE_PRICES: { pro_monthly: 'price_pro_monthly', pro_yearly: 'price_pro_yearly', analyst_monthly: 'price_analyst_monthly', analyst_yearly: 'price_analyst_yearly', angel: 'price_angel' },
  stripe: {
    prices: { retrieve: mocks.priceRetrieve },
    customers: { create: mocks.customerCreate },
    checkout: { sessions: { create: mocks.sessionCreate, retrieve: mocks.sessionRetrieve } },
  },
}));

import { POST } from '@/app/api/stripe/checkout/route';

function request(priceKey: string, returnTo?: string) {
  return new Request('https://seraphim.example/api/stripe/checkout', {
    method: 'POST', headers: { origin: 'https://seraphim.example', 'content-type': 'application/json' },
    body: JSON.stringify({ priceKey, returnTo }),
  }) as never;
}

function query(result: unknown = null) {
  const value: Record<string, unknown> = {};
  value.select = vi.fn(() => value);
  value.update = vi.fn(() => value);
  value.eq = vi.fn(() => value);
  value.single = vi.fn(async () => ({ data: result, error: null }));
  value.then = (resolve: (input: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(resolve);
  return value;
}

const reservation = (code = 'created') => ({
  data: [{ intent_id: code === 'created' ? 'intent-1' : null, intent_status: 'creating', existing_session_id: null, correlation_id: code === 'created' ? 'correlation-1' : null, expires_at: null, result_code: code }],
  error: null,
});

describe('POST /api/stripe/checkout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkoutEnabled = true;
    mocks.angelEnabled = true;
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'user-1', email: 'user@example.com' } }, error: null });
    mocks.rpc.mockResolvedValue(reservation());
    mocks.from.mockImplementation((table: string) => query(table === 'user_profiles' ? { stripe_customer_id: 'cus-1' } : null));
    mocks.priceRetrieve.mockResolvedValue({ product: { metadata: { inventory: '80' } } });
    mocks.sessionCreate.mockResolvedValue({ id: 'cs-1', url: 'https://checkout.stripe.example/session', expires_at: 1_900_000_000 });
  });

  it('checks the plan-specific kill switch before auth or Stripe', async () => {
    mocks.checkoutEnabled = false;
    expect((await POST(request('pro_monthly'))).status).toBe(503);
    expect(mocks.getUser).not.toHaveBeenCalled();
  });

  it('rejects invalid plans and unauthenticated requests', async () => {
    expect((await POST(request('unknown'))).status).toBe(400);
    mocks.getUser.mockResolvedValueOnce({ data: { user: null }, error: null });
    expect((await POST(request('pro_monthly'))).status).toBe(401);
  });

  it('creates an idempotent Pro trial checkout from a database reservation', async () => {
    const response = await POST(request('pro_monthly', '/account?tab=billing'));
    expect(await response.json()).toEqual({ url: 'https://checkout.stripe.example/session' });
    expect(mocks.rpc).toHaveBeenCalledWith('reserve_billing_checkout_intent', expect.objectContaining({ p_user_id: 'user-1', p_mode: 'subscription' }));
    expect(mocks.sessionCreate).toHaveBeenCalledWith(expect.objectContaining({
      customer: 'cus-1', mode: 'subscription',
      success_url: 'https://seraphim.example/account?tab=billing&checkout=success',
      subscription_data: expect.objectContaining({ trial_period_days: 7 }),
    }), { idempotencyKey: 'checkout-intent-intent-1' });
  });

  it('returns sold-out Angel inventory without creating a Stripe session', async () => {
    mocks.rpc.mockResolvedValue(reservation('angel_sold_out'));
    expect((await POST(request('angel'))).status).toBe(410);
    expect(mocks.sessionCreate).not.toHaveBeenCalled();
  });

  it('uses payment mode and PaymentIntent metadata for Angel checkout', async () => {
    await POST(request('angel'));
    expect(mocks.sessionCreate).toHaveBeenCalledWith(expect.objectContaining({ mode: 'payment', payment_intent_data: { metadata: expect.objectContaining({ price_key: 'angel' }) } }), expect.anything());
  });
});
