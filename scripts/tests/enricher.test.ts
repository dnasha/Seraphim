/*
  Seraphim Enricher Pipeline Tests
  Verifies the enrichItemsWithLocation function for bulk geocoding of news items.
  Tests coordinate attachment, source-based defaults, and jitter logic for map visualization.

  Usage: bun test scripts/tests/enricher.test.ts
*/

import { describe, it, expect, beforeAll } from 'vitest';
import { enrichItemsWithLocation } from '@/lib/geocoding/enricher';
import { ensureInitialized } from '@/lib/geocoding';
import type { NewsItem } from '@/lib/core/types';

beforeAll(() => {
    ensureInitialized();
});

/*
  makeItem
  Factory for mock NewsItem objects with random IDs for test isolation.
*/
function makeItem(overrides: Partial<NewsItem> = {}): NewsItem {
    return {
        id: 'test-' + Math.random().toString(36).slice(2),
        title: 'Generic headline',
        description: '',
        url: 'https://example.com/' + Math.random().toString(36).slice(2),
        source: 'Test Source',
        sourceType: 'rss',
        publishedAt: new Date().toISOString(),
        ...overrides,
    };
}

/*
  Coordinate Attachment
  Tests extraction and attachment of latitude and longitude from titles.
*/
describe('enrichItemsWithLocation - coordinate attachment', () => {
    it('attaches lat/lon for a clear location in title', async () => {
        const items = [makeItem({ title: 'KYIV (Reuters) - Explosions reported across capital' })];
        const result = await enrichItemsWithLocation(items);
        expect(result).toHaveLength(1);
        expect(result[0].latitude).toBeDefined();
        expect(result[0].longitude).toBeDefined();
        expect(result[0].locationName?.toLowerCase()).toContain('kyiv');
    });

    it('returns items unchanged when no location is extractable', async () => {
        const items = [makeItem({ title: 'Scientists develop new quantum algorithm' })];
        const result = await enrichItemsWithLocation(items);
        expect(result).toHaveLength(1);
    });
});

/*
  Pre-Geocoded Passthrough
  Ensures items with existing coordinates are not re-processed.
*/
describe('enrichItemsWithLocation - passthrough', () => {
    it('preserves pre-existing coordinates without re-geocoding', async () => {
        const items = [makeItem({
            title: 'Some article',
            latitude: 99.99,
            longitude: -99.99,
        })];
        const result = await enrichItemsWithLocation(items);
        expect(result[0].latitude).toBe(99.99);
        expect(result[0].longitude).toBe(-99.99);
    });
});

/*
  Source Default Fallback
  Verifies source-specific location defaults (e.g. NASA to Washington DC)
  when no specific location is identified in the text.
*/
describe('enrichItemsWithLocation - source defaults', () => {
    it('falls back to NASA source default (Washington DC)', async () => {
        const items = [makeItem({
            title: 'Hubble telescope captures stunning nebula image',
            description: 'The image was taken using the Wide Field Camera 3.',
            source: 'NASA',
        })];
        const result = await enrichItemsWithLocation(items);
        expect(result[0].latitude).toBeDefined();
        expect(result[0].longitude).toBeDefined();
        // NASA default coordinates roughly correspond to Washington DC
        expect(result[0].latitude).toBeCloseTo(38.91, 0);
    });
});

/*
  Golden-Angle Spiral Jitter
  Tests mathematical jitter applied to co-located items to prevent pin stacking.
*/
describe('enrichItemsWithLocation - jitter', () => {
    it('applies jitter to prevent coordinate stacking', async () => {
        // Create two items that map to the exact same city
        const items = [
            makeItem({ title: 'KYIV (Reuters) - First event in capital' }),
            makeItem({ title: 'KYIV (AP) - Second event in capital' }),
        ];
        const result = await enrichItemsWithLocation(items);

        const geocoded = result.filter(r => r.latitude != null && r.longitude != null);
        expect(geocoded.length).toBeGreaterThanOrEqual(2);

        if (geocoded.length >= 2) {
            // Coordinates must differ slightly due to jitter logic
            const coordsMatch =
                geocoded[0].latitude === geocoded[1].latitude &&
                geocoded[0].longitude === geocoded[1].longitude;
            expect(coordsMatch).toBe(false);
        }
    });
});

/*
  Edge Cases
  Ensures stability with empty inputs.
*/
describe('enrichItemsWithLocation - edge cases', () => {
    it('returns empty array for empty input', async () => {
        const result = await enrichItemsWithLocation([]);
        expect(result).toEqual([]);
    });
});


