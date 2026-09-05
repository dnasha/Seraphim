import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ claim: vi.fn(), run: vi.fn() }));
vi.mock('@/lib/server/recoveryJobs', () => ({ claimRecoveryJob: mocks.claim }));
vi.mock('@/lib/server/runRecoveryJob', () => ({ runRecoveryJob: mocks.run }));
import { POST } from '@/app/api/internal/billing-recovery/route';

const token = 'a'.repeat(64);
const request = (authorization?: string) => new Request('https://seraphi.me/api/internal/billing-recovery', {
  method: 'POST', headers: authorization ? { authorization } : {},
  body: JSON.stringify({ payload: 'untrusted caller input is ignored' }),
});
beforeEach(() => { vi.resetAllMocks(); vi.stubEnv('BILLING_RECOVERY_TOKEN', token); });
afterEach(() => vi.unstubAllEnvs());

it('fails closed when its token is missing or weak', async () => {
  for (const value of ['', 'short']) {
    vi.stubEnv('BILLING_RECOVERY_TOKEN', value);
    expect((await POST(request(`Bearer ${value}`))).status).toBe(503);
  }
  expect(mocks.claim).not.toHaveBeenCalled();
});
it('rejects absent, truncated, and same-length incorrect tokens before database access', async () => {
  for (const value of [undefined, 'Bearer short', `Bearer ${'b'.repeat(64)}`]) {
    expect((await POST(request(value))).status).toBe(401);
  }
  expect(mocks.claim).not.toHaveBeenCalled();
});
it('returns idle when there is no due job', async () => {
  mocks.claim.mockResolvedValue(null);
  const response = await POST(request(`Bearer ${token}`));
  expect(await response.json()).toMatchObject({ processed: false });
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(mocks.run).not.toHaveBeenCalled();
});
it('processes only the claimed job and never returns its private payload', async () => {
  const job = { job_key: 'private-id', payload: { sensitive: true } };
  mocks.claim.mockResolvedValue(job);
  const response = await POST(request(`Bearer ${token}`));
  expect(mocks.claim).toHaveBeenCalledWith();
  expect(mocks.run).toHaveBeenCalledWith(job);
  expect(await response.json()).toEqual({ processed: true, commit: expect.toBeOneOf([null, process.env.GITHUB_SHA, process.env.VERCEL_GIT_COMMIT_SHA]) });
});
it('reports failures without exposing database or Stripe error details', async () => {
  mocks.claim.mockResolvedValue({ job_key: 'private-id' });
  mocks.run.mockRejectedValue(new Error('sensitive error details'));
  const response = await POST(request(`Bearer ${token}`));
  expect(response.status).toBe(503);
  expect(response.headers.get('retry-after')).toBe('60');
  expect(await response.json()).toEqual({ error: 'Recovery deferred' });
});
