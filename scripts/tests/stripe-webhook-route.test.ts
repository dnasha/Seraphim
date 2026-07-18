import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  constructEvent: vi.fn(), rpc: vi.fn(), from: vi.fn(), priceRetrieve: vi.fn(), retrieveSubscription: vi.fn(),
  cancelSubscription: vi.fn(), updates: [] as Array<{ table: string; payload: Record<string, unknown> }>,
  profile: { tier: 'free', stripe_subscription_id: null as string | null }, claimError: null as null | { code: string }, released: vi.fn(),
}));

vi.mock('@/lib/core/supabase-admin', () => ({ supabaseAdmin: { from: mocks.from, rpc: mocks.rpc } }));
vi.mock('@/lib/server/operations', () => ({ recordMetric: vi.fn(), recordIncident: vi.fn(), recoverIncident: vi.fn(), serverDiagnostic: vi.fn() }));
vi.mock('@/lib/stripe', () => ({
  ANGEL_MAX_QUANTITY: 100,
  STRIPE_PRICES: {
    pro_monthly: 'price_pro_monthly', pro_yearly: 'price_pro_yearly',
    analyst_monthly: 'price_analyst_monthly', analyst_yearly: 'price_analyst_yearly', angel: 'price_angel',
  },
  intervalFromPriceId: () => 'month', tierFromPriceId: () => 'pro',
  stripe: {
    webhooks: { constructEvent: mocks.constructEvent }, prices: { retrieve: mocks.priceRetrieve },
    subscriptions: { retrieve: mocks.retrieveSubscription, cancel: mocks.cancelSubscription },
  },
}));

import { POST } from '@/app/api/stripe/webhook/route';

function webhookRequest(signature: string | null) {
  return new Request('https://seraphim.example/api/stripe/webhook', { method: 'POST', body: 'signed', headers: signature ? { 'stripe-signature': signature } : {} }) as never;
}

function tableQuery(table: string) {
  const query: Record<string, unknown> = {};
  query.insert = vi.fn(async () => ({ error: table === 'stripe_processed_events' ? mocks.claimError : null }));
  query.delete = vi.fn(() => { mocks.released(); return query; });
  query.select = vi.fn(() => query);
  query.eq = vi.fn(() => query);
  query.maybeSingle = vi.fn(async () => ({ data: null, error: null }));
  query.single = vi.fn(async () => ({ data: table === 'user_profiles' ? mocks.profile : null, error: null }));
  query.update = vi.fn((payload: Record<string, unknown>) => { mocks.updates.push({ table, payload }); return query; });
  query.then = (resolve: (input: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(resolve);
  return query;
}

const activeSubscription = {
  id: 'sub-1', status: 'active', customer: 'cus-1', cancel_at: null, cancel_at_period_end: false, trial_end: null,
  metadata: { supabase_user_id: 'user-1' }, items: { data: [{ price: { id: 'price-pro' }, current_period_end: 1_800_000_000 }] },
};

describe('POST /api/stripe/webhook', () => {
  beforeEach(() => {
    vi.clearAllMocks(); mocks.updates.length = 0; mocks.claimError = null; mocks.profile = { tier: 'free', stripe_subscription_id: null };
    mocks.from.mockImplementation(tableQuery); mocks.rpc.mockResolvedValue({ data: true, error: null });
    mocks.priceRetrieve.mockResolvedValue({ product: { metadata: { inventory: '50' } } });
    mocks.retrieveSubscription.mockResolvedValue(activeSubscription);
  });

  it('rejects unsigned and invalidly signed webhook requests', async () => {
    expect((await POST(webhookRequest(null))).status).toBe(400);
    mocks.constructEvent.mockImplementation(() => { throw new Error('bad signature'); });
    expect((await POST(webhookRequest('bad'))).status).toBe(400);
  });

  it('acknowledges an already claimed Stripe event without processing it', async () => {
    mocks.claimError = { code: '23505' };
    mocks.constructEvent.mockReturnValue({ id: 'evt-duplicate', type: 'invoice.payment_succeeded', data: { object: {} } });
    expect(await (await POST(webhookRequest('valid'))).json()).toEqual({ received: true, duplicate: true });
  });

  it('fulfills a paid Angel checkout through the atomic inventory RPC', async () => {
    mocks.constructEvent.mockReturnValue({ id: 'evt-angel', type: 'checkout.session.completed', data: { object: {
      id: 'cs-angel', mode: 'payment', payment_status: 'paid', payment_intent: 'pi-1', customer: 'cus-1',
      metadata: { supabase_user_id: 'user-1', price_key: 'angel', checkout_intent_id: 'intent-1' },
    } } });
    expect((await POST(webhookRequest('valid'))).status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith('fulfill_angel_purchase', expect.objectContaining({ p_user_id: 'user-1', p_max_quantity: 50 }));
    expect(mocks.updates).toContainEqual(expect.objectContaining({ table: 'billing_checkout_intents', payload: expect.objectContaining({ status: 'completed' }) }));
  });

  it('keeps active, trialing, and past-due subscriptions entitled', async () => {
    mocks.constructEvent.mockReturnValue({ id: 'evt-sub', type: 'checkout.session.completed', data: { object: {
      id: 'cs-sub', mode: 'subscription', subscription: 'sub-1', metadata: { supabase_user_id: 'user-1', price_key: 'pro_monthly', checkout_intent_id: 'intent-1' },
    } } });
    expect((await POST(webhookRequest('valid'))).status).toBe(200);
    expect(mocks.updates).toContainEqual(expect.objectContaining({ table: 'user_profiles', payload: expect.objectContaining({ tier: 'pro', subscription_status: 'active' }) }));
  });

  it('recognizes Billing Portal cancellations represented by cancel_at', async () => {
    mocks.retrieveSubscription.mockResolvedValue({
      ...activeSubscription,
      cancel_at: 1_800_000_000,
      cancel_at_period_end: false,
    });
    mocks.constructEvent.mockReturnValue({
      id: 'evt-portal-cancel',
      type: 'customer.subscription.updated',
      data: { object: { id: 'sub-1' } },
    });

    expect((await POST(webhookRequest('valid'))).status).toBe(200);
    expect(mocks.updates).toContainEqual(expect.objectContaining({
      table: 'user_profiles',
      payload: expect.objectContaining({ cancel_at_period_end: true }),
    }));
  });

  it('downgrades incomplete or unpaid subscription states', async () => {
    mocks.retrieveSubscription.mockResolvedValue({ ...activeSubscription, id: 'sub-incomplete', status: 'incomplete' });
    mocks.constructEvent.mockReturnValue({ id: 'evt-incomplete', type: 'checkout.session.completed', data: { object: {
      id: 'cs-incomplete', mode: 'subscription', subscription: 'sub-incomplete', metadata: { supabase_user_id: 'user-1', price_key: 'pro_monthly' },
    } } });
    await POST(webhookRequest('valid'));
    expect(mocks.updates).toContainEqual(expect.objectContaining({ table: 'user_profiles', payload: expect.objectContaining({ tier: 'free', subscription_status: 'incomplete' }) }));
  });

  it('releases the idempotency claim when processing fails', async () => {
    mocks.retrieveSubscription.mockRejectedValue(new Error('unavailable'));
    mocks.constructEvent.mockReturnValue({ id: 'evt-failure', type: 'checkout.session.completed', data: { object: {
      id: 'cs-failure', mode: 'subscription', subscription: 'sub-failure', metadata: { supabase_user_id: 'user-1', price_key: 'pro_monthly' },
    } } });
    expect((await POST(webhookRequest('valid'))).status).toBe(500);
    expect(mocks.released).toHaveBeenCalled();
  });
});
