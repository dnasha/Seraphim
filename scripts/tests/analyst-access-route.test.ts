import { beforeEach, expect, it, vi } from 'vitest';
import { getEntitlements, type UserTier } from '@/lib/entitlements';
const resolve = vi.hoisted(() => vi.fn());
vi.mock('@/lib/server/entitlements', () => ({ resolveRequestEntitlements: resolve }));
import { GET } from '@/app/api/analyst/access/route';
beforeEach(() => vi.clearAllMocks());
it.each(['guest', 'free', 'pro', 'analyst', 'angel'] as UserTier[])('server authorizes evidence access for %s', async tier => {
  resolve.mockResolvedValue({ tier, userId: tier === 'guest' ? null : 'owner', entitlements: getEntitlements(tier) });
  const result = await GET();
  expect(result.status).toBe(tier === 'guest' ? 401 : tier === 'analyst' || tier === 'angel' ? 200 : 403);
  expect(result.headers.get('cache-control')).toBe('private, no-store');
  if (result.status === 200) expect(await result.json()).toEqual({ userId: 'owner', tier });
});
it('fails closed when access resolution fails', async () => {
  resolve.mockRejectedValue(new Error('database unavailable'));
  expect((await GET()).status).toBe(503);
});
