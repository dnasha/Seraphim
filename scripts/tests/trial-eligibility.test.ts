import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), subscriptions: vi.fn() }));
vi.mock('@/lib/core/supabase-admin', () => ({ supabaseAdmin: { rpc: mocks.rpc } }));
vi.mock('@/lib/stripe', () => ({ stripe: { subscriptions: { list: mocks.subscriptions } } }));
import { isTrialEligible } from '@/lib/server/trialEligibility';
beforeEach(() => { vi.clearAllMocks(); mocks.rpc.mockResolvedValue({ data: true, error: null }); });
it('records a historical trial before deciding eligibility', async () => {
  mocks.subscriptions.mockReturnValue((async function* () { yield { trial_start: 1700000000, metadata: { checkout_intent_id: 'old-intent' } }; })());
  mocks.rpc.mockImplementation(async (name: string) => ({ data: name === 'reserve_billing_trial' ? false : null, error: null }));
  expect(await isTrialEligible('user','customer','intent')).toBe(false);
  expect(mocks.rpc.mock.calls.map(([name]) => name)).toEqual(['record_billing_trial','reserve_billing_trial']);
  expect(mocks.rpc.mock.calls[0][1]).toMatchObject({ p_intent_id: 'old-intent' });
});
it('allows the database to grant an explicit promotion', async () => {
  mocks.subscriptions.mockReturnValue((async function* () { yield { trial_start: 1700000000 }; })());
  expect(await isTrialEligible('user','customer','intent')).toBe(true);
});
it('fails closed when Stripe history cannot be read', async () => {
  mocks.subscriptions.mockReturnValue((async function* () { throw new Error('history unavailable'); yield; })());
  await expect(isTrialEligible('user','customer','intent')).rejects.toThrow('history unavailable');
  expect(mocks.rpc).not.toHaveBeenCalled();
});
