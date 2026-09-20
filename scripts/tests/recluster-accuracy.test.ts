import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { DbEvent } from '@/types';

vi.mock('@/lib/core/supabase-admin', () => ({ supabaseAdmin: null }));
import { reClusterHistoricalData } from '../maintenance/re-cluster';

function event(id: string, overrides: Partial<DbEvent> = {}): DbEvent {
    return {
        id, title: 'Warehouse fire in Bristol leaves several people injured',
        description: 'Crews fought a fire at a warehouse in Bristol.',
        source: id, source_type: 'rss', url: `https://${id}.example/story`, category: 'crisis',
        published_at: '2026-09-19T12:00:00Z', latitude: 51.455, longitude: -2.596,
        location_name: 'Bristol', credibility_tier: 2, sources: [], embedding: '[1,0]',
        ...overrides,
    };
}

function database(rows: DbEvent[], similarity: number) {
    let page = 0;
    const query = {
        select: vi.fn((_fields: string, options?: { head?: boolean }) => options?.head
            ? Promise.resolve({ count: rows.length, error: null }) : query),
        lt: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(),
        limit: vi.fn(async () => ({ data: page++ === 0 ? structuredClone(rows) : [], error: null })),
    };
    const rpc = vi.fn(async (name: string) => ({
        data: name === 'match_events_batch' ? [{ query_index: 0, id: rows[1].id, similarity }] : [],
        error: null,
    }));
    return { from: vi.fn(() => query), rpc };
}

describe('historical re-clustering accuracy', () => {
    beforeEach(() => { vi.spyOn(console, 'log').mockImplementation(() => {}); });
    afterEach(() => { vi.restoreAllMocks(); });

    it('uses the production country and incident gates before deleting rows', async () => {
        for (const rows of [
            [event('one', { location_name: 'United States', latitude: 37.09, longitude: -95.71 }),
                event('two', { location_name: 'United States', latitude: 37.09, longitude: -95.71 })],
            [event('one', { title: 'Japan wins football gold at Asian Games' }),
                event('two', { title: 'Japan wins volleyball gold at Asian Games' })],
        ]) {
            const db = database(rows, rows[0].location_name === 'United States' ? 0.8 : 0.95);
            await reClusterHistoricalData(db as never, false);
            expect(db.rpc.mock.calls.map(call => call[0])).not.toContain('apply_recluster_batch');
        }
    });

    it('persists acquired sources from both clusters together with their deletion', async () => {
        const extra = { name: 'Third', url: 'https://third.example/story', source_type: 'rss' as const, discovered_at: '2026-09-19T11:00:00Z' };
        const db = database([event('one'), event('two', { sources: [extra] })], 0.78);
        await reClusterHistoricalData(db as never, false);
        expect(db.rpc).toHaveBeenCalledWith('apply_recluster_batch', {
            p_updates: [expect.objectContaining({
                id: 'one', sources: expect.arrayContaining([extra, expect.objectContaining({ url: 'https://two.example/story' })]),
            })],
            p_delete_ids: ['two'],
        });
    });

    it('runs the same analysis in dry run without a write RPC', async () => {
        const db = database([event('one'), event('two')], 0.95);
        await reClusterHistoricalData(db as never, true);
        expect(db.rpc).toHaveBeenCalledTimes(1);
        expect(db.rpc).toHaveBeenCalledWith('match_events_batch', expect.any(Object));
    });

    it('keeps deletions with their destination when unrelated updates fill an earlier batch', async () => {
        const timestampOnly = Array.from({ length: 101 }, (_, index) => event(`timestamp-${index}`, {
            sources: [{ name: 'Later', url: `https://later.example/${index}`, source_type: 'rss', discovered_at: '2026-09-19T13:00:00Z' }],
        }));
        const db = database([...timestampOnly, event('master'), event('child')], 0.95);
        let matchPage = 0;
        db.rpc.mockImplementation(async name => ({
            data: name === 'match_events_batch' && matchPage++ === 1
                ? [{ query_index: 1, id: 'child', similarity: 0.95 }] : [],
            error: null,
        }));
        await reClusterHistoricalData(db as never, false);
        const writes = db.rpc.mock.calls.filter(call => call[0] === 'apply_recluster_batch') as unknown as Array<[string, { p_updates: Array<{ id: string }>; p_delete_ids: string[] }]>;
        expect(writes).toHaveLength(2);
        expect(writes[0][1].p_delete_ids).toEqual([]);
        expect(writes[1][1].p_updates.map(update => update.id)).toContain('master');
        expect(writes[1][1].p_delete_ids).toEqual(['child']);
    });
});
