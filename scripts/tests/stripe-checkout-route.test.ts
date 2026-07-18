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
    process.env.STRIPE_MANAGED_PAYMENTS_ENABLED = 'false';
    process.env.STRIPE_AUTOMATIC_TAX_ENABLED = 'false';
    delete process.env.STRIPE_PROMOTION_CODES_ENABLED;
  });

  it('checks the plan-specific kill switch before auth or Stripe', async () => {
    mocks.checkoutEnabled = false;
    expect((await POST(request('pro_monthly'))).status).toBe(503);
    expect(mocks.getUser).not.toHaveBeenCalled();
  });

  it('checks the Angel kill switch independently before auth or Stripe', async () => {
    mocks.angelEnabled = false;
    expect((await POST(request('angel'))).status).toBe(503);
    expect(mocks.getUser).not.toHaveBeenCalled();
    expect(mocks.sessionCreate).not.toHaveBeenCalled();
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
      consent_collection: { terms_of_service: 'required' },
      subscription_data: expect.objectContaining({ trial_period_days: 14 }),
    }), { idempotencyKey: 'checkout-intent-intent-1' });
  });

  it.each(['pro_monthly', 'pro_yearly', 'analyst_monthly', 'analyst_yearly'])(
    'applies the 14-day trial to %s',
    async (priceKey) => {
      await POST(request(priceKey));
      expect(mocks.sessionCreate).toHaveBeenCalledWith(expect.objectContaining({
        subscription_data: expect.objectContaining({ trial_period_days: 14 }),
      }), expect.anything());
    },
  );

  it('returns sold-out Angel inventory without creating a Stripe session', async () => {
    mocks.rpc.mockResolvedValue(reservation('angel_sold_out'));
    expect((await POST(request('angel'))).status).toBe(410);
    expect(mocks.sessionCreate).not.toHaveBeenCalled();
  });

  it('uses payment mode and PaymentIntent metadata for Angel checkout', async () => {
    await POST(request('angel'));
    expect(mocks.sessionCreate).toHaveBeenCalledWith(expect.objectContaining({ mode: 'payment', payment_intent_data: { metadata: expect.objectContaining({ price_key: 'angel' }) } }), expect.anything());
  });

  it('blocks every paid Checkout while an Angel dispute is pending', async () => {
    mocks.rpc.mockResolvedValue(reservation('angel_payment_review'));
    const response = await POST(request('pro_monthly'));
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      code: 'angel_payment_review',
      error: 'Billing is unavailable while the Angel payment is under review.',
    });
    expect(mocks.customerCreate).not.toHaveBeenCalled();
    expect(mocks.sessionCreate).not.toHaveBeenCalled();
  });

  it('enables Stripe Tax only when explicitly configured', async () => {
    process.env.STRIPE_AUTOMATIC_TAX_ENABLED = 'true';
    await POST(request('pro_yearly'));
    expect(mocks.sessionCreate).toHaveBeenCalledWith(expect.objectContaining({
      automatic_tax: { enabled: true },
      billing_address_collection: 'required',
      customer_update: { address: 'auto' },
    }), expect.anything());
  });

  it('keeps Managed Payments off by default and enables it explicitly without ordinary tax fields', async () => {
    await POST(request('pro_monthly'));
    expect(mocks.sessionCreate).toHaveBeenLastCalledWith(
      expect.not.objectContaining({ managed_payments: expect.anything() }),
      expect.anything(),
    );

    vi.clearAllMocks();
    mocks.rpc.mockResolvedValue(reservation());
    mocks.from.mockImplementation((table: string) => query(table === 'user_profiles' ? { stripe_customer_id: 'cus-1' } : null));
    mocks.sessionCreate.mockResolvedValue({ id: 'cs-managed', url: 'https://checkout.stripe.example/managed', expires_at: 1_900_000_000 });
    process.env.STRIPE_MANAGED_PAYMENTS_ENABLED = 'true';

    await POST(request('analyst_monthly'));
    expect(mocks.sessionCreate).toHaveBeenLastCalledWith(expect.objectContaining({
      managed_payments: { enabled: true },
      consent_collection: { terms_of_service: 'required' },
      subscription_data: expect.objectContaining({ trial_period_days: 14 }),
    }), expect.anything());
    const params = mocks.sessionCreate.mock.calls.at(-1)?.[0];
    expect(params).not.toHaveProperty('automatic_tax');
    expect(params).not.toHaveProperty('billing_address_collection');
    expect(params).not.toHaveProperty('customer_update');
  });

  it('fails closed before auth, reservations, or Stripe when Managed Payments conflicts with automatic tax', async () => {
    process.env.STRIPE_MANAGED_PAYMENTS_ENABLED = 'true';
    process.env.STRIPE_AUTOMATIC_TAX_ENABLED = 'true';

    const response = await POST(request('pro_yearly'));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ code: 'configuration_error', error: 'Checkout is unavailable.' });
    expect(mocks.getUser).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.customerCreate).not.toHaveBeenCalled();
    expect(mocks.sessionCreate).not.toHaveBeenCalled();
  });

  it('keeps promotion codes off by default and enables them only by configuration', async () => {
    await POST(request('pro_monthly'));
    expect(mocks.sessionCreate).toHaveBeenLastCalledWith(
      expect.not.objectContaining({ allow_promotion_codes: true }),
      expect.anything(),
    );

    vi.clearAllMocks();
    mocks.rpc.mockResolvedValue(reservation());
    mocks.from.mockImplementation((table: string) => query(table === 'user_profiles' ? { stripe_customer_id: 'cus-1' } : null));
    mocks.sessionCreate.mockResolvedValue({ id: 'cs-2', url: 'https://checkout.stripe.example/session-2', expires_at: 1_900_000_000 });
    process.env.STRIPE_PROMOTION_CODES_ENABLED = 'true';

    await POST(request('pro_monthly'));
    expect(mocks.sessionCreate).toHaveBeenLastCalledWith(
      expect.objectContaining({ allow_promotion_codes: true }),
      expect.anything(),
    );
  });
});
