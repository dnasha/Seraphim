import { describe, expect, it, vi } from 'vitest';
import type { DbEvent } from '@/types';
import type { StoryMerge } from '@/scraper/merger';
import {
  enrichResolvedStoryImages,
  mapWithHostLimit,
  ONLINE_PAGE_LOOKUP_LIMIT,
} from '@/scraper/imageEnrichment';

const event = (url: string): DbEvent => ({
  title: 'Report',
  url,
  source: 'Source',
  source_type: 'rss',
  published_at: '2026-07-27T00:00:00.000Z',
  credibility_tier: 2,
});

describe('resolved image enrichment', () => {
  it('prioritizes an existing blank story ahead of a new blank event', async () => {
    const newEvents = [event('https://new.example/story')];
    const merges = new Map<string, StoryMerge>([['event-1', { sources: [] }]]);
    const lookup = vi.fn(async ({ articleUrl }: { articleUrl: string }) => ({
      url: `${articleUrl}/image.jpg`,
      sourceUrl: articleUrl,
      sourcePublishedAt: '2026-07-27T00:00:00.000Z',
      sourceTier: 2,
      origin: 'page-og' as const,
      width: 1200,
      height: 675,
    }));

    const stats = await enrichResolvedStoryImages({
      newEvents,
      merges,
      imageTargets: [{
        targetType: 'merge',
        targetId: 'event-1',
        articleUrl: 'https://existing.example/update',
        sourcePublishedAt: '2026-07-27T00:00:00.000Z',
        sourceTier: 2,
        priority: 0,
        currentPublishedAt: '2026-07-26T00:00:00.000Z',
      }],
    }, {
      enabled: true,
      pageLookupLimit: 1,
      lookup: lookup as never,
      now: () => Date.parse('2026-07-27T01:00:00.000Z'),
    });

    expect(lookup).toHaveBeenCalledOnce();
    expect(lookup.mock.calls[0][0]).toMatchObject({
      articleUrl: 'https://existing.example/update',
    });
    expect(merges.get('event-1')).toMatchObject({
      image_url: 'https://existing.example/update/image.jpg',
    });
    expect(newEvents[0].image_url).toBeUndefined();
    expect(stats).toMatchObject({ pageLookups: 1, fills: 1, refreshes: 0 });
  });

  it('enforces the online page budget', async () => {
    const newEvents = Array.from({ length: 20 }, (_, index) =>
      event(`https://host-${index}.example/story`)
    );
    const lookup = vi.fn(async ({ articleUrl }: { articleUrl: string }) => ({
      url: `${articleUrl}/image.jpg`,
      sourceUrl: articleUrl,
      sourcePublishedAt: '2026-07-27T00:00:00.000Z',
      sourceTier: 2,
      origin: 'page-og' as const,
    }));

    const stats = await enrichResolvedStoryImages({
      newEvents,
      merges: new Map(),
      imageTargets: [],
    }, { enabled: true, lookup: lookup as never });

    expect(lookup).toHaveBeenCalledTimes(ONLINE_PAGE_LOOKUP_LIMIT);
    expect(stats.pageLookups).toBe(ONLINE_PAGE_LOOKUP_LIMIT);
  });

  it('limits same-host work to one concurrent lookup', async () => {
    let active = 0;
    let maxActive = 0;
    await mapWithHostLimit(
      [1, 2, 3, 4],
      3,
      () => 'same.example',
      async (value) => {
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active--;
        return value;
      },
    );
    expect(maxActive).toBe(1);
  });
});
