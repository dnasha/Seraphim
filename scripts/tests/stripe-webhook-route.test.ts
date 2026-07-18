import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  constructEvent: vi.fn(), rpc: vi.fn(), from: vi.fn(), priceRetrieve: vi.fn(), retrieveSubscription: vi.fn(),
  cancelSubscription: vi.fn(), updates: [] as Array<{ table: string; payload: Record<string, unknown> }>,
  profile: { tier: 'free', stripe_subscription_id: null as string | null }, claimError: null as null | { code: string }, released: vi.fn(),
  recordMetric: vi.fn(), recordIncident: vi.fn(), recoverIncident: vi.fn(),
}));

vi.mock('@/lib/core/supabase-admin', () => ({ supabaseAdmin: { from: mocks.from, rpc: mocks.rpc } }));
vi.mock('@/lib/server/operations', () => ({
  recordMetric: mocks.recordMetric,
  recordIncident: mocks.recordIncident,
  recoverIncident: mocks.recoverIncident,
  serverDiagnostic: vi.fn(),
}));
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
    mocks.from.mockImplementation(tableQuery);
    mocks.rpc.mockImplementation(async (name: string) => name === 'transition_angel_purchase'
      ? { data: [{ result_code: 'transitioned', affected_user_id: 'user-1', previous_status: 'active', current_status: 'revoked' }], error: null }
      : { data: true, error: null });
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

  it('accepts a Managed Payments-shaped subscription session without changing fulfillment', async () => {
    mocks.constructEvent.mockReturnValue({ id: 'evt-managed-sub', type: 'checkout.session.completed', data: { object: {
      id: 'cs-managed', mode: 'subscription', subscription: 'sub-1', managed_payments: { enabled: true },
      metadata: { supabase_user_id: 'user-1', price_key: 'analyst_yearly', checkout_intent_id: 'intent-managed' },
    } } });

    expect((await POST(webhookRequest('valid'))).status).toBe(200);
    expect(mocks.retrieveSubscription).toHaveBeenCalledWith('sub-1');
    expect(mocks.updates).toContainEqual(expect.objectContaining({
      table: 'billing_checkout_intents',
      payload: expect.objectContaining({ status: 'completed' }),
    }));
  });

  it.each([
    ['refund.created', { id: 're-partial', status: 'succeeded', amount: 1, payment_intent: 'pi-angel' }],
    ['refund.updated', { id: 're-full', status: 'succeeded', amount: 39900, payment_intent: 'pi-angel' }],
    ['charge.refunded', { id: 'ch-refunded', amount_refunded: 1, payment_intent: 'pi-angel' }],
  ])('revokes Angel for any succeeded refund through %s', async (type, object) => {
    mocks.constructEvent.mockReturnValue({ id: `evt-${type}`, type, data: { object } });

    expect((await POST(webhookRequest('valid'))).status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith('transition_angel_purchase', expect.objectContaining({
      p_stripe_payment_intent_id: 'pi-angel',
      p_transition: 'refund_succeeded',
    }));
    expect(mocks.recordIncident).toHaveBeenCalledWith(expect.objectContaining({
      type: 'angel_founder_role_requires_review',
    }));
  });

  it.each([
    ['pending', 'refund.created'],
    ['failed', 'refund.updated'],
    ['canceled', 'refund.updated'],
  ])('does not revoke Angel for a %s refund', async (status, type) => {
    mocks.constructEvent.mockReturnValue({
      id: `evt-refund-${status}`,
      type,
      data: { object: { id: `re-${status}`, status, amount: 39900, payment_intent: 'pi-angel' } },
    });

    expect((await POST(webhookRequest('valid'))).status).toBe(200);
    expect(mocks.rpc).not.toHaveBeenCalledWith('transition_angel_purchase', expect.anything());
  });

  it('ignores a failed refund that is unrelated to an Angel purchase', async () => {
    mocks.constructEvent.mockReturnValue({
      id: 'evt-refund-failed', type: 'refund.failed',
      data: { object: { id: 're-failed', status: 'failed', amount: 39900, payment_intent: 'pi-other' } },
    });

    expect((await POST(webhookRequest('valid'))).status).toBe(200);
    expect(mocks.rpc).not.toHaveBeenCalledWith('transition_angel_purchase', expect.anything());
    expect(mocks.recordMetric).not.toHaveBeenCalledWith(expect.objectContaining({ name: 'angel_refund_failed' }));
  });

  it.each([
    ['charge.dispute.created', 'needs_response', 'dispute_opened'],
    ['charge.dispute.closed', 'won', 'dispute_won'],
    ['charge.dispute.closed', 'warning_closed', 'dispute_won'],
    ['charge.dispute.closed', 'lost', 'dispute_lost'],
  ])('maps %s with status %s to %s', async (type, status, transition) => {
    mocks.constructEvent.mockReturnValue({
      id: `evt-${type}-${status}`,
      type,
      data: { object: { id: 'du-angel', status, payment_intent: 'pi-angel' } },
    });

    expect((await POST(webhookRequest('valid'))).status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith('transition_angel_purchase', {
      p_stripe_payment_intent_id: 'pi-angel',
      p_transition: transition,
      p_stripe_object_id: 'du-angel',
      p_stripe_event_at: expect.any(String),
    });
  });

  it('accepts a deferred out-of-order reversal without customer or role side effects', async () => {
    mocks.rpc.mockResolvedValue({
      data: [{ result_code: 'deferred', affected_user_id: null, previous_status: null, current_status: null }],
      error: null,
    });
    mocks.constructEvent.mockReturnValue({
      id: 'evt-early-refund', type: 'refund.created', created: 1_800_000_000,
      data: { object: { id: 're-early', status: 'succeeded', amount: 1, payment_intent: 'pi-early' } },
    });

    expect((await POST(webhookRequest('valid'))).status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith('transition_angel_purchase', expect.objectContaining({
      p_stripe_payment_intent_id: 'pi-early',
      p_stripe_event_at: new Date(1_800_000_000 * 1000).toISOString(),
    }));
    expect(mocks.recordIncident).not.toHaveBeenCalled();
  });

  it('raises a manual review incident instead of restoring a terminal Angel purchase', async () => {
    mocks.rpc.mockResolvedValue({
      data: [{ result_code: 'terminal', affected_user_id: 'user-1', previous_status: 'revoked', current_status: 'revoked' }],
      error: null,
    });
    mocks.constructEvent.mockReturnValue({
      id: 'evt-late-win', type: 'charge.dispute.closed',
      data: { object: { id: 'du-late-win', status: 'won', payment_intent: 'pi-angel' } },
    });

    expect((await POST(webhookRequest('valid'))).status).toBe(200);
    expect(mocks.recordIncident).toHaveBeenCalledWith(expect.objectContaining({
      type: 'angel_terminal_reversal_requires_review',
      severity: 'critical',
    }));
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
