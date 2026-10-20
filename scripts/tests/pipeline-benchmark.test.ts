import { expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ rss: vi.fn(async () => [{ title: 'Flooding in Paris' }]), close: vi.fn() }));
vi.mock('@/lib/geocoding/dictionary', () => ({ KNOWN_LOCATIONS: { Paris: { type: 'city' } }, ensureInitialized() {} }));
vi.mock('@/lib/api/rss', () => ({ fetchAllRSSFeeds: mocks.rss, fetchAllRedditFeeds: async () => [] }));
vi.mock('@/lib/api/gnews', () => ({ fetchGNews: async () => [], fetchOSINTGNews: async () => [] }));
vi.mock('@/lib/api/social', () => ({ fetchSocialFeeds: async () => [] }));
vi.mock('@/lib/geocoding/enricher', () => ({ enrichItemsWithLocation: async (items: object[]) => items.map(item => ({ ...item, latitude: 48.8, longitude: 2.3 })) }));
vi.mock('@/lib/security/ogImage', () => ({ closePublicFetchAgents: mocks.close }));

it('runs the benchmark through the current production module paths and closes transports', async () => {
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  const previous = process.env.IS_BENCHMARK;
  try {
    await (await import('../diagnostics/benchmark-pipeline.mjs')).benchmarkCompletion;
    expect(mocks.rss).toHaveBeenCalledOnce();
    expect(mocks.close).toHaveBeenCalledOnce();
    expect(log.mock.calls.some(([value]) => String(value).includes('PARIS') || String(value).includes('Entries:'))).toBe(true);
  } finally {
    log.mockRestore();
    if (previous === undefined) delete process.env.IS_BENCHMARK;
    else process.env.IS_BENCHMARK = previous;
  }
});
