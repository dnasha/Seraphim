import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({
  writes: [] as string[], failIngest: false, capped: false, openCircuit: false,
  persist: vi.fn(), metric: vi.fn(), incident: vi.fn(), recover: vi.fn(),
}));
vi.mock('@/lib/core/supabase-admin', () => ({ supabaseAdmin: {
  from: (table: string) => {
    const query = {
      insert: () => { state.writes.push(table + ':insert'); return query; },
      update: () => { state.writes.push(table + ':update'); return query; },
      select: () => query, eq: () => query,
      single: async () => ({ data: { id: 'run' }, error: null }),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve),
    };
    return query;
  },
  rpc: async (name: string) => {
    if (name === 'check_urls_exist') return { data: [], error: null };
    state.writes.push(name);
    return state.failIngest ? { data: null, error: { message: 'write failed' } } : { data: [{ upserted_count: 1, merged_count: 0 }], error: null };
  },
} }));
vi.mock('@/lib/api/rss', () => ({
  fetchAllRSSFeeds: async (_now: number, options: { onValidator: (url: string, validator: object) => void }) => {
    options.onValidator('https://example.com/rss', { etag: 'next' });
    return [{ id: 'source', title: 'Officials report major flooding in Example City', description: 'Authorities reported flooding and evacuated residents from the affected neighborhoods.', url: 'https://example.com/article', source: 'Example', sourceType: 'rss', category: 'world', publishedAt: '2026-09-05T00:00:00Z' }];
  }, fetchAllRedditFeeds: async () => [],
}));
vi.mock('@/lib/api/gnews', () => ({ fetchHealthEventGNews: async () => [] }));
vi.mock('@/lib/api/social', () => ({ fetchSocialFeeds: async () => [] }));
vi.mock('@/lib/api/sourceHealth', () => ({ beginSourceHealthCollection: vi.fn(), completeSourceHealthCollection: () => [{ outcome: 'healthy' }] }));
vi.mock('@/lib/api/outboundScheduler', () => ({ scheduleOutboundSource: async (_host: string, run: () => unknown) => run() }));
vi.mock('@/lib/operationsCore', () => ({ createOperationsRecorder: () => ({ recordMetric: state.metric, recordIncident: state.incident, recoverIncident: state.recover }) }));
vi.mock('@/scraper/feedValidators', () => ({ loadFeedValidators: async () => new Map(), persistFeedValidators: state.persist }));
vi.mock('@/scraper/sourceCircuits', () => ({ loadOpenSourceCircuits: async () => new Set(state.openCircuit ? ['rss:Unavailable'] : []) }));
vi.mock('@/scraper/sourceBudget', () => ({ loadSourceNoveltyLimits: async () => new Map(), applySourceNoveltyLimits: (items: unknown[]) => ({ accepted: items, cappedBySource: state.capped ? { Example: 1 } : {} }) }));
vi.mock('@/lib/geocoding', () => ({ enrichItemsWithLocation: async (items: object[]) => items.map(item => ({ ...item, latitude: 10, longitude: 20 })) }));
vi.mock('@/scraper/merger', () => ({ resolveStoryMerges: async (events: unknown[]) => ({ newEvents: events, merges: new Map(), imageTargets: [] }) }));
vi.mock('@/scraper/imageEnrichment', () => ({ enrichResolvedStoryImages: async () => ({ pageLookups: 1, hits: 1, fills: 1, refreshes: 0, durationMs: 1 }) }));
vi.mock('@/lib/security/ogImage', () => ({ closePublicFetchAgents: vi.fn() }));

beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks(); state.writes = []; state.failIngest = false; state.capped = false; state.openCircuit = false;
  vi.stubEnv('DRY_RUN', 'false');
  state.persist.mockImplementation(async () => { state.writes.push('checkpoint'); });
});
afterEach(() => { vi.unstubAllEnvs(); process.exitCode = 0; });
async function run() { await (await import('@/scraper/index')).ingestionCompletion; }
it('dry run performs no database or operational writes', async () => {
  vi.stubEnv('DRY_RUN', 'true'); await run();
  expect(state.writes).toEqual([]);
  expect(state.persist).not.toHaveBeenCalled(); expect(state.metric).not.toHaveBeenCalled();
  expect(state.incident).not.toHaveBeenCalled(); expect(state.recover).not.toHaveBeenCalled();
});
it('commits checkpoints only after successful ingestion', async () => {
  await run();
  expect(state.writes.indexOf('bulk_ingest_events')).toBeGreaterThanOrEqual(0);
  expect(state.writes.indexOf('checkpoint')).toBeGreaterThan(state.writes.indexOf('bulk_ingest_events'));
});
it('leaves checkpoints unchanged after a database failure', async () => {
  state.failIngest = true; await run(); expect(state.persist).not.toHaveBeenCalled(); expect(process.exitCode).toBe(1);
});
it('leaves capped feeds replayable', async () => {
  state.capped = true; await run(); expect(state.persist).not.toHaveBeenCalled();
});
it('does not recover provider health while a source circuit is still open', async () => {
  state.openCircuit = true; await run();
  expect(state.recover).not.toHaveBeenCalled();
  expect(state.incident).toHaveBeenCalledWith(expect.objectContaining({ type: 'source_cohort_degraded', safeContext: { source_failures: 1 } }));
});
