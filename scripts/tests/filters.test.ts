/*
  Seraphim News Filtering Tests

  This suite verifies the applyNewsFilters function, which is responsible
  for client-side filtering of news items based on source, category,
  time range, and search queries.
*/

import { describe, it, expect } from 'vitest';
import { applyNewsFilters, FilterOptions } from '@/lib/utils/filters';
import type { NewsItem } from '@/lib/core/types';

/*
  Test Data Factory
  Provides a consistent way to generate mock news items for testing
  various filter combinations.
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
        mappedOnly: false,
        searchQuery: '',
        now: NOW,
        ...overrides,
    };
}

/*
  Source Filtering
  Validates that items are correctly filtered based on their source
  type (RSS, GNews, Social Media).
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
  Verifies that items are correctly categorized and filtered based
  on their assigned category or lack thereof.
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
  Tests the temporal filtering of items, ensuring only news within
  the specified window (1d, 3d, 1w) is displayed.
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
});

/*
  Search Query Filtering
  Validates the text-based search functionality across titles,
  descriptions, and location names.
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

/*
  Mapped Only Filter
  Ensures that users can toggle the visibility of items that lack
  geographic coordinates.
*/
describe('applyNewsFilters - mapped only', () => {
    const mappedItem = makeItem({ latitude: 50.45, longitude: 30.52 });
    const unmappedItem = makeItem({ latitude: undefined, longitude: undefined });

    it('hides unmapped items when true', () => {
        const result = applyNewsFilters([mappedItem, unmappedItem], defaultOpts({ mappedOnly: true }));
        expect(result).toEqual([mappedItem]);
    });

    it('shows all items when false', () => {
        const result = applyNewsFilters([mappedItem, unmappedItem], defaultOpts({ mappedOnly: false }));
        expect(result).toHaveLength(2);
    });
});

/*
  Combined Filters
  Tests the intersection logic when multiple filters are applied
  simultaneously.
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
  Verifies robustness against empty inputs and pre-hydration states.
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
});

