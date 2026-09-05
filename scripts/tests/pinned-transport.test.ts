import { afterEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock('undici', async (original) => ({ ...await original<typeof import('undici')>(), fetch: mocks.fetch }));
import { closePublicFetchAgents, fetchPublicBytes } from '@/lib/security/ogImage';

afterEach(async () => { await closePublicFetchAgents(); vi.unstubAllGlobals(); });

it('uses the explicit dispatcher transport even when the runtime native fetch ignores it', async () => {
  const native = vi.fn(() => { throw new Error('native fetch must not be used'); });
  vi.stubGlobal('fetch', native);
  mocks.fetch.mockResolvedValue(new Response('<rss/>', { headers: { 'Content-Type': 'application/xml' } }));
  const result = await fetchPublicBytes('https://publisher.example/feed', {
    maxBytes: 1000, resolveHost: async () => [{ address: '93.184.216.34', family: 4 }],
    throwOnError: true,
  });
  expect(new TextDecoder().decode(result?.bytes)).toBe('<rss/>');
  expect(mocks.fetch).toHaveBeenCalledWith(expect.any(URL), expect.objectContaining({
    redirect: 'manual', dispatcher: expect.objectContaining({ dispatch: expect.any(Function) }),
  }));
  expect(native).not.toHaveBeenCalled();
});
