import { describe, expect, it, vi } from 'vitest';
import {
  backfillArticleCandidates,
  runImageBackfill,
  type ImageBackfillRow,
} from '@/scraper/imageBackfill';

const clustered: ImageBackfillRow = {
  id: '11111111-1111-4111-8111-111111111111',
  url: 'https://primary.example/story',
  published_at: '2026-07-27T00:00:00.000Z',
  credibility_tier: 1,
  event_count: 4,
  sources: [
    {
      name: 'Older',
      url: 'https://older.example/story',
      source_type: 'rss',
      discovered_at: '2026-07-25T00:00:00.000Z',
    },
    {
      name: 'Newest',
      url: 'https://newest.example/story',
      source_type: 'rss',
      discovered_at: '2026-07-26T00:00:00.000Z',
    },
    {
      name: 'Middle',
      url: 'https://middle.example/story',
      source_type: 'rss',
      discovered_at: '2026-07-25T12:00:00.000Z',
    },
  ],
};

describe('image backfill', () => {
  it('tries the primary and only the two newest corroborators', () => {
    expect(backfillArticleCandidates(clustered).map((entry) => entry.url)).toEqual([
      'https://primary.example/story',
      'https://newest.example/story',
      'https://middle.example/story',
    ]);
  });

  it('is a seven-day dry run by default and records misses in memory', async () => {
    const query = {
      select: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      or: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      then: (resolve: (value: unknown) => void) =>
        Promise.resolve({ data: [clustered], error: null }).then(resolve),
    };
    const db = {
      from: vi.fn(() => query),
      rpc: vi.fn(),
    };
    const result = await runImageBackfill(db as never, {
      lookup: vi.fn(async () => null) as never,
      now: () => Date.parse('2026-07-27T01:00:00.000Z'),
    });

    expect(query.gte).toHaveBeenCalledWith(
      'published_at',
      '2026-07-20T01:00:00.000Z',
    );
    expect(result).toMatchObject({
      days: 7,
      selected: 1,
      hits: 0,
      misses: 1,
      written: 0,
      dryRun: true,
    });
    expect(result.updates[0]).toMatchObject({
      id: clustered.id,
      image_last_checked_at: '2026-07-27T01:00:00.000Z',
    });
    expect(db.rpc).not.toHaveBeenCalled();
  });
});
