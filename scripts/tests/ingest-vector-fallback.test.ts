import { describe, expect, it, vi } from 'vitest';
import { ingestSequentially } from '@/scraper/dbIngest';
import type { DbEvent } from '@/types';

const event = { title: 'Story', url: 'https://example.com/story', embedding: '[1]' } as DbEvent;

describe('sequential vector fallback', () => {
  it('omits vectors from merges and inserts when vector support is known to be missing', async () => {
    const update = vi.fn((payload: Record<string, unknown>) => ({ eq: async () => ({ error: null, payload }) }));
    const insert = vi.fn(async (payload: Record<string, unknown>) => ({ error: null, payload }));
    const db = { from: () => ({ update, insert }) };
    const result = await ingestSequentially(db as never, [event, event], [{ id: 'existing', title: 'Updated', embedding: '[1]' }], false, true);
    expect(update.mock.calls[0]).toEqual([{ title: 'Updated' }]);
    expect(insert.mock.calls.every(([payload]) => !('embedding' in payload))).toBe(true);
    expect(result).toMatchObject({ upserted_count: 2, merged_count: 1 });
  });
  it('retries the first unsupported merge and omits vectors from every later write', async () => {
    const writes: Record<string, unknown>[] = [];
    const write = async (payload: Record<string, unknown>) => {
      writes.push(payload);
      return { error: 'embedding' in payload ? { message: 'type "vector" does not exist' } : null };
    };
    const db = { from: () => ({ update: (payload: Record<string, unknown>) => ({ eq: () => write(payload) }), insert: write }) };
    const result = await ingestSequentially(db as never, [event, event], [{ id: 'existing', title: 'Updated', embedding: '[1]' }], false, false);
    expect(writes.map(payload => 'embedding' in payload)).toEqual([true, false, false, false]);
    expect(result.vectorTypeUnavailable).toBe(true);
  });
  it('does not turn unrelated database failures into apparent success', async () => {
    const db = { from: () => ({ insert: async () => ({ error: { message: 'permission denied' } }) }) };
    await expect(ingestSequentially(db as never, [event], [], false, false)).rejects.toThrow('permission denied');
  });
});
