/*
  Seraphim News Filtering Tests
  Verifies the applyNewsFilters function for client-side filtering.
  Tests source, category, time range, search query, and map-event filtering.

  Usage: bun run test -- scripts/tests/filters.test.ts
*/

import { describe, it, expect } from 'vitest';
import { applyNewsFilters, FilterOptions } from '@/lib/utils/filters';
import { canonicalNewsId, matchesNewsId } from '@/lib/utils/ranking';
import type { NewsItem } from '@/lib/core/types';

/*
  Test Data Factory
  Generates mock news items for filter validation.
*/
const NOW = new Date('2026-04-15T12:00:00Z').getTime();

function makeItem(overrides: Partial<NewsItem> = {}): NewsItem {
    return {
        id: 'test-' + Math.random().toString(36).slice(2),
        title: 'Test headline',
        description: 'Test description',
        url: 'https://example.com/test',
        source: 'BBC News',
        sourceType: 'rss',
        publishedAt: new Date(NOW - 1000 * 60 * 60).toISOString(), // 1 hour ago
        latitude: 50.45,
        longitude: 30.52,
        locationName: 'Kyiv',
        ...overrides,
    };
}

function defaultOpts(overrides: Partial<FilterOptions> = {}): FilterOptions {
    return {
        sources: ['news', 'reddit', 'x', 'telegram'],
        categories: ['all'],
        timeRange: '1d',
        searchQuery: '',
        now: NOW,
        ...overrides,
    };
}

/*
  Source Filtering
  Validates filtering based on sourceType (RSS, GNews, Social Media).
*/
describe('applyNewsFilters - source filtering', () => {
    const rssItem = makeItem({ sourceType: 'rss' });
    const gnewsItem = makeItem({ sourceType: 'gnews' });
    const redditItem = makeItem({ sourceType: 'social', source: 'Reddit - CombatFootage' });
    const xItem = makeItem({ sourceType: 'social', source: 'OSINTdefender (X)' });
    const telegramItem = makeItem({ sourceType: 'social', source: 'Telegram - NEXTA' });
    const allItems = [rssItem, gnewsItem, redditItem, xItem, telegramItem];

    it('shows RSS items when "news" source active', () => {
        const result = applyNewsFilters(allItems, defaultOpts({ sources: ['news'] }));
        expect(result).toContain(rssItem);
        expect(result).not.toContain(gnewsItem);
    });

    it('shows GNews items when "extra" source active', () => {
        const result = applyNewsFilters(allItems, defaultOpts({ sources: ['extra'] }));
        expect(result).toContain(gnewsItem);
        expect(result).not.toContain(rssItem);
    });

    it('shows Reddit items when "reddit" source active', () => {
        const result = applyNewsFilters(allItems, defaultOpts({ sources: ['reddit'] }));
        expect(result).toContain(redditItem);
        expect(result).not.toContain(xItem);
    });

    it('shows X/Twitter items when "x" source active', () => {
        const result = applyNewsFilters(allItems, defaultOpts({ sources: ['x'] }));
        expect(result).toContain(xItem);
        expect(result).not.toContain(telegramItem);
    });

    it('shows Telegram items when "telegram" source active', () => {
        const result = applyNewsFilters(allItems, defaultOpts({ sources: ['telegram'] }));
        expect(result).toContain(telegramItem);
        expect(result).not.toContain(xItem);
    });

    it('shows nothing when no sources active', () => {
        const result = applyNewsFilters(allItems, defaultOpts({ sources: [] }));
        expect(result).toEqual([]);
    });

    it('also matches Twitter string for X source', () => {
        const twitterItem = makeItem({ sourceType: 'social', source: 'SomeUser Twitter' });
        const result = applyNewsFilters([twitterItem], defaultOpts({ sources: ['x'] }));
        expect(result).toContain(twitterItem);
    });
});

/*
  Category Filtering
  Validates classification-based filtering.
*/
describe('applyNewsFilters - category filtering', () => {
    const crisisItem = makeItem({ category: 'crisis' });
    const worldItem = makeItem({ category: 'world' });
    const noCatItem = makeItem({ category: undefined });

    it('"all" shows everything', () => {
        const result = applyNewsFilters([crisisItem, worldItem, noCatItem], defaultOpts({ categories: ['all'] }));
        expect(result).toHaveLength(3);
    });

    it('specific category filters correctly', () => {
        const result = applyNewsFilters([crisisItem, worldItem], defaultOpts({ categories: ['crisis'] }));
        expect(result).toEqual([crisisItem]);
    });

    it('items with no category treated as "general"', () => {
        const result = applyNewsFilters([noCatItem], defaultOpts({ categories: ['general'] }));
        expect(result).toEqual([noCatItem]);
    });

    it('items with no category excluded when filtering specific category', () => {
        const result = applyNewsFilters([noCatItem], defaultOpts({ categories: ['crisis'] }));
        expect(result).toEqual([]);
    });
});

/*
  Time Range Filtering
  Validates temporal filtering for various windows (1d, 3d, 1w).
*/
describe('applyNewsFilters - time range filtering', () => {
    const recentItem = makeItem({ publishedAt: new Date(NOW - 1000 * 60 * 60).toISOString() }); // 1h ago
    const oldItem = makeItem({ publishedAt: new Date(NOW - 1000 * 60 * 60 * 48).toISOString() }); // 48h ago
    const ancientItem = makeItem({ publishedAt: new Date(NOW - 1000 * 60 * 60 * 24 * 14).toISOString() }); // 14d ago

    it('"1d" hides items older than 24h', () => {
        const result = applyNewsFilters([recentItem, oldItem], defaultOpts({ timeRange: '1d' }));
        expect(result).toContain(recentItem);
        expect(result).not.toContain(oldItem);
    });

    it('"3d" shows items within 3 days', () => {
        const result = applyNewsFilters([recentItem, oldItem, ancientItem], defaultOpts({ timeRange: '3d' }));
        expect(result).toContain(recentItem);
        expect(result).toContain(oldItem);
        expect(result).not.toContain(ancientItem);
    });

    it('"1w" shows items within 7 days', () => {
        const result = applyNewsFilters([recentItem, oldItem, ancientItem], defaultOpts({ timeRange: '1w' }));
        expect(result).toContain(recentItem);
        expect(result).toContain(oldItem);
        expect(result).not.toContain(ancientItem);
    });

    it('"all" shows everything', () => {
        const result = applyNewsFilters([recentItem, oldItem, ancientItem], defaultOpts({ timeRange: 'all' }));
        expect(result).toHaveLength(3);
    });

    it('uses latest source discovery time when publishedAt is stale', () => {
        const stalePublished = makeItem({
            id: 'stale-published',
            publishedAt: new Date(NOW - 1000 * 60 * 60 * 48).toISOString(), // 48h old
            sources: [
                {
                    name: 'Source A',
                    url: 'https://example.com/a',
                    sourceType: 'rss',
                    discoveredAt: new Date(NOW - 1000 * 60 * 30).toISOString(), // 30m ago
                },
            ],
        });

        const result = applyNewsFilters([stalePublished], defaultOpts({ timeRange: '1d' }));
        expect(result).toHaveLength(1);
        expect(result[0].id).toBe('stale-published');
    });

    it('uses latestActivityAt when sources are not present in list payload', () => {
        const stalePublished = makeItem({
            id: 'latest-activity-override',
            publishedAt: new Date(NOW - 1000 * 60 * 60 * 48).toISOString(), // 48h old
            latestActivityAt: new Date(NOW - 1000 * 60 * 15).toISOString(), // 15m ago
            sources: undefined,
        });

        const result = applyNewsFilters([stalePublished], defaultOpts({ timeRange: '1d' }));
        expect(result).toHaveLength(1);
        expect(result[0].id).toBe('latest-activity-override');
    });

    it('includes items inside a custom start/end range', () => {
        const inside = makeItem({
            id: 'inside-custom-range',
            publishedAt: '2026-04-15T10:30:00.000Z',
        });

        const result = applyNewsFilters([inside], defaultOpts({
            timeRange: 'custom',
            customStartDate: '2026-04-15T10:00:00.000Z',
            customEndDate: '2026-04-15T11:00:00.000Z',
        }));

        expect(result).toEqual([inside]);
    });

    it('excludes items before the custom start timestamp', () => {
        const beforeStart = makeItem({
            id: 'before-custom-start',
            publishedAt: '2026-04-15T09:59:59.000Z',
        });

        const result = applyNewsFilters([beforeStart], defaultOpts({
            timeRange: 'custom',
            customStartDate: '2026-04-15T10:00:00.000Z',
            customEndDate: '2026-04-15T11:00:00.000Z',
        }));

        expect(result).toEqual([]);
    });

    it('excludes items after the exact custom end timestamp', () => {
        const atEnd = makeItem({
            id: 'at-custom-end',
            publishedAt: '2026-04-15T11:00:00.000Z',
        });
        const afterEnd = makeItem({
            id: 'after-custom-end',
            publishedAt: '2026-04-15T11:00:01.000Z',
        });

        const result = applyNewsFilters([atEnd, afterEnd], defaultOpts({
            timeRange: 'custom',
            customStartDate: '2026-04-15T10:00:00.000Z',
            customEndDate: '2026-04-15T11:00:00.000Z',
        }));

        expect(result).toEqual([atEnd]);
    });
});

/*
  Search Query Filtering
  Validates text-based search across titles, descriptions, and locations.
*/
describe('applyNewsFilters - search query', () => {
    const item1 = makeItem({ title: 'Ukraine war update: Kyiv defenses hold' });
    const item2 = makeItem({ title: 'Stock market crashes', description: 'Nasdaq drops 5%' });
    const item3 = makeItem({ title: 'Generic news', locationName: 'Damascus' });

    it('matches in title', () => {
        const result = applyNewsFilters([item1, item2], defaultOpts({ searchQuery: 'ukraine' }));
        expect(result).toEqual([item1]);
    });

    it('matches in description', () => {
        const result = applyNewsFilters([item1, item2], defaultOpts({ searchQuery: 'nasdaq' }));
        expect(result).toEqual([item2]);
    });

    it('matches in locationName', () => {
        const result = applyNewsFilters([item1, item3], defaultOpts({ searchQuery: 'damascus' }));
        expect(result).toEqual([item3]);
    });

    it('is case insensitive', () => {
        const result = applyNewsFilters([item1], defaultOpts({ searchQuery: 'UKRAINE' }));
        expect(result).toEqual([item1]);
    });

    it('empty search shows all', () => {
        const result = applyNewsFilters([item1, item2, item3], defaultOpts({ searchQuery: '' }));
        expect(result).toHaveLength(3);
    });
});

describe('applyNewsFilters - map events', () => {
    const mappedItem = makeItem({ latitude: 50.45, longitude: 30.52 });
    const unmappedItem = makeItem({ latitude: undefined, longitude: undefined });

    it('excludes items without a complete coordinate pair', () => {
        const result = applyNewsFilters([mappedItem, unmappedItem], defaultOpts());
        expect(result).toEqual([mappedItem]);
    });
});

/*
  Volume ("Hotness") Filtering
  Validates filtering based on story report count (sources list length or eventCount).
*/
describe('applyNewsFilters - minVolume filtering', () => {
    const thinItem = makeItem({
        id: 'thin',
        sources: [
            { name: 'Source A', url: 'https://example.com/a', sourceType: 'rss', discoveredAt: new Date(NOW - 1000 * 60).toISOString() }
        ]
    }); // 1 source
    const fatItem = makeItem({
        id: 'fat',
        sources: [
            { name: 'Source A', url: 'https://example.com/a', sourceType: 'rss', discoveredAt: new Date(NOW - 1000 * 60).toISOString() },
            { name: 'Source B', url: 'https://example.com/b', sourceType: 'rss', discoveredAt: new Date(NOW - 1000 * 60).toISOString() }
        ]
    }); // 2 sources
    const megaItem = makeItem({
        id: 'mega',
        sourcesCount: 6,
        sources: []
    }); // sourcesCount 6 override
    const allItems = [thinItem, fatItem, megaItem];

    it('shows everything when minVolume=1', () => {
        const result = applyNewsFilters(allItems, defaultOpts({ minVolume: 1 }));
        expect(result).toHaveLength(3);
    });

    it('shows only items with 2+ sources when minVolume=2', () => {
        const result = applyNewsFilters(allItems, defaultOpts({ minVolume: 2 }));
        expect(result).toContain(fatItem);
        expect(result).toContain(megaItem);
        expect(result).not.toContain(thinItem);
    });

    it('shows only items with 5+ sources when minVolume=5', () => {
        const result = applyNewsFilters(allItems, defaultOpts({ minVolume: 5 }));
        expect(result).toEqual([megaItem]);
    });
});

/*
  Credibility Tiers Filtering
  Validates filtering based on the credibility Tier (1, 2, or 3).
*/
describe('applyNewsFilters - credibilityTiers filtering', () => {
    const verifiedItem = makeItem({ credibilityTier: 1 });
    const credibleItem = makeItem({ credibilityTier: 2 });
    const unverifiedItem = makeItem({ credibilityTier: 3 });
    const noTierItem = makeItem({ credibilityTier: undefined }); // defaults to 3
    const allItems = [verifiedItem, credibleItem, unverifiedItem, noTierItem];

    it('shows everything when credibilityTiers is empty or all-inclusive', () => {
        const result1 = applyNewsFilters(allItems, defaultOpts({ credibilityTiers: [] }));
        expect(result1).toHaveLength(4);

        const result2 = applyNewsFilters(allItems, defaultOpts({ credibilityTiers: [1, 2, 3] }));
        expect(result2).toHaveLength(4);
    });

    it('shows only verified when credibilityTiers=[1]', () => {
        const result = applyNewsFilters(allItems, defaultOpts({ credibilityTiers: [1] }));
        expect(result).toEqual([verifiedItem]);
    });

    it('shows verified and credible when credibilityTiers=[1, 2]', () => {
        const result = applyNewsFilters(allItems, defaultOpts({ credibilityTiers: [1, 2] }));
        expect(result).toContain(verifiedItem);
        expect(result).toContain(credibleItem);
        expect(result).not.toContain(unverifiedItem);
    });

    it('includes undefined credibility tier in Tier 3 (Unverified) results', () => {
        const result = applyNewsFilters(allItems, defaultOpts({ credibilityTiers: [3] }));
        expect(result).toContain(unverifiedItem);
        expect(result).toContain(noTierItem);
        expect(result).not.toContain(verifiedItem);
    });
});

/*
  Combined Filters
  Validates intersection logic when multiple filters are active.
*/
describe('applyNewsFilters - combined', () => {
    it('applies multiple filters as intersection', () => {
        const items = [
            makeItem({ sourceType: 'rss', category: 'crisis', title: 'Ukraine crisis deepens' }),
            makeItem({ sourceType: 'rss', category: 'world', title: 'Trade agreement signed' }),
            makeItem({ sourceType: 'social', source: 'Reddit - test', category: 'crisis', title: 'Reddit crisis post' }),
        ];
        const result = applyNewsFilters(items, defaultOpts({
            sources: ['news'],
            categories: ['crisis'],
            searchQuery: 'ukraine',
        }));
        expect(result).toHaveLength(1);
        expect(result[0].title).toContain('Ukraine');
    });
});

/*
  Edge Cases
  Handles pre-hydration and empty input states.
*/
describe('applyNewsFilters - edge cases', () => {
    it('returns unfiltered items when now=0 (pre-hydration)', () => {
        const items = [makeItem(), makeItem()];
        const result = applyNewsFilters(items, defaultOpts({ now: 0 }));
        expect(result).toEqual(items);
    });

    it('handles empty input array', () => {
        const result = applyNewsFilters([], defaultOpts());
        expect(result).toEqual([]);
    });
});

describe('applyNewsFilters - dedupe and bbox scope', () => {
    it('dedupes cluster + original cards by canonical id', () => {
        const base = makeItem({
            id: 'story-1',
            title: 'Latest event',
            publishedAt: new Date(NOW - 1000 * 60).toISOString(),
            impactScore: 10,
            sourcesCount: 4,
        });
        const cluster = makeItem({
            id: 'cluster-z4-12.0000-13.0000-4',
            originalId: 'story-1',
            title: 'Cluster event',
            publishedAt: new Date(NOW - 1000 * 60 * 5).toISOString(),
            impactScore: 8,
            sourcesCount: 4,
        });

        const result = applyNewsFilters([cluster, base], defaultOpts({ sortMode: 'hot' }));
        expect(result).toHaveLength(1);
        expect(result[0].id).toBe('story-1');
    });

    it('can skip bbox filtering for global zoomed-out sidebar mode', () => {
        const inView = makeItem({ id: 'in-view', latitude: 10, longitude: 10 });
        const outOfView = makeItem({ id: 'out-of-view', latitude: 70, longitude: 70 });
        const bbox = { minLat: 0, maxLat: 20, minLng: 0, maxLng: 20 };

        const viewportResult = applyNewsFilters([inView, outOfView], defaultOpts({ bbox, respectBBox: true }));
        expect(viewportResult.map((i) => i.id)).toEqual(['in-view']);

        const globalResult = applyNewsFilters([inView, outOfView], defaultOpts({ bbox, respectBBox: false }));
        expect(globalResult.map((i) => i.id).sort()).toEqual(['in-view', 'out-of-view']);
    });

    it('preserves the pinned selected item through bbox filtering only', () => {
        const inView = makeItem({ id: 'in-view', latitude: 10, longitude: 10 });
        const selectedOutOfView = makeItem({ id: 'selected-story', latitude: 70, longitude: 70 });
        const unselectedOutOfView = makeItem({ id: 'unselected-story', latitude: 75, longitude: 75 });
        const bbox = { minLat: 0, maxLat: 20, minLng: 0, maxLng: 20 };

        const result = applyNewsFilters(
            [inView, selectedOutOfView, unselectedOutOfView],
            defaultOpts({ bbox, respectBBox: true, pinnedItemId: 'selected-story' }),
        );

        expect(result).toContain(inView);
        expect(result).toContain(selectedOutOfView);
        expect(result).not.toContain(unselectedOutOfView);
    });

    it('matches clustered and raw ids by canonical event id', () => {
        const clustered = makeItem({
            id: 'cluster-z4-12.0000-13.0000-4',
            originalId: 'story-1',
            latitude: 70,
            longitude: 70,
        });
        const bbox = { minLat: 0, maxLat: 20, minLng: 0, maxLng: 20 };

        expect(canonicalNewsId(clustered)).toBe('story-1');
        expect(matchesNewsId(clustered, 'story-1')).toBe(true);
        expect(matchesNewsId(clustered, 'cluster-z4-12.0000-13.0000-4')).toBe(true);

        const result = applyNewsFilters(
            [clustered],
            defaultOpts({ bbox, respectBBox: true, pinnedItemId: 'story-1' }),
        );
        expect(result).toEqual([clustered]);
    });

    it('does not let pinned selection bypass non-viewport filters', () => {
        const selectedOutOfView = makeItem({
            id: 'selected-story',
            category: 'health',
            latitude: 70,
            longitude: 70,
        });
        const bbox = { minLat: 0, maxLat: 20, minLng: 0, maxLng: 20 };

        const result = applyNewsFilters(
            [selectedOutOfView],
            defaultOpts({
                bbox,
                respectBBox: true,
                pinnedItemId: 'selected-story',
                categories: ['crisis'],
            }),
        );

        expect(result).toEqual([]);
    });
});


