import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), stripe: vi.fn(), deletion: vi.fn() }));
vi.mock('@/lib/core/supabase-admin', () => ({ supabaseAdmin: { rpc: mocks.rpc } }));
vi.mock('@/lib/server/stripeEventProcessor', () => ({ processStripeEvent: mocks.stripe }));
vi.mock('@/lib/server/accountDeletionProcessor', () => ({ processAccountDeletion: mocks.deletion }));
import { claimRecoveryJob, enqueueRecoveryJob, type RecoveryJob } from '@/lib/server/recoveryJobs';
import { runRecoveryJob } from '@/lib/server/runRecoveryJob';

const job: RecoveryJob = { job_key: 'evt-test', kind: 'stripe_webhook', payload: { id: 'evt-test' }, claim_token: 'attempt-token', attempts: 2 };
beforeEach(() => { vi.clearAllMocks(); mocks.rpc.mockResolvedValue({ data: true, error: null }); mocks.stripe.mockResolvedValue(undefined); });

it('does not mistake an enqueue failure for a completed duplicate', async () => {
  mocks.rpc.mockResolvedValue({ data: null, error: { code: 'unavailable' } });
  await expect(enqueueRecoveryJob(job.job_key, job.kind, job.payload)).rejects.toEqual({ code: 'unavailable' });
});
it('leaves running or deferred jobs unclaimed', async () => {
  mocks.rpc.mockResolvedValue({ data: [], error: null });
  expect(await claimRecoveryJob('evt-test')).toBeNull();
});
it('finishes with the current attempt token only after the effect succeeds', async () => {
  await runRecoveryJob(job);
  expect(mocks.stripe).toHaveBeenCalledWith(job.payload);
  expect(mocks.rpc).toHaveBeenCalledWith('finish_recovery_job', { p_key: job.job_key, p_token: job.claim_token, p_success: true });
  expect(mocks.stripe.mock.invocationCallOrder[0]).toBeLessThan(mocks.rpc.mock.invocationCallOrder[0]);
});
it('retains retryable work when an effect fails', async () => {
  mocks.stripe.mockRejectedValue(new Error('stripe unavailable'));
  await expect(runRecoveryJob(job)).rejects.toThrow('stripe unavailable');
  expect(mocks.rpc).toHaveBeenCalledWith('finish_recovery_job', expect.objectContaining({ p_success: false }));
  expect(mocks.rpc).not.toHaveBeenCalledWith('finish_recovery_job', expect.objectContaining({ p_success: true }));
});
it('rejects completion after losing a lease', async () => {
  mocks.rpc.mockResolvedValue({ data: false, error: null });
  await expect(runRecoveryJob(job)).rejects.toThrow('job_lease_lost');
});
it('recovers deletion using the durable job reference without an Auth session', async () => {
  await runRecoveryJob({ ...job, kind: 'account_deletion', payload: { deletionJobId: 'deletion-id' } });
  expect(mocks.deletion).toHaveBeenCalledWith('deletion-id');
  expect(mocks.stripe).not.toHaveBeenCalled();
});

it('renews a long-running claim and rejects a failed renewal', async () => {
  vi.useFakeTimers();
  let finish!: () => void;
  mocks.stripe.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
  mocks.rpc.mockImplementation(async (name: string) => ({ data: name !== 'renew_recovery_job', error: null }));
  try {
    const run = runRecoveryJob(job);
    const assertion = expect(run).rejects.toThrow('job_lease_lost');
    await vi.advanceTimersByTimeAsync(30_000);
    expect(mocks.rpc).toHaveBeenCalledWith('renew_recovery_job', { p_key: job.job_key, p_token: job.claim_token });
    finish();
    await assertion;
    expect(vi.getTimerCount()).toBe(0);
  } finally { vi.useRealTimers(); }
});
