/*
  Seraphim Enricher Pipeline Tests
  Verifies the enrichItemsWithLocation function for bulk geocoding of news items.
  Tests coordinate attachment and canonical coordinate persistence.

  Usage: bun run test -- scripts/tests/enricher.test.ts
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
  Source-default suppression
  A publisher's headquarters is not evidence that an event occurred there.
*/
describe('enrichItemsWithLocation - source-default suppression', () => {
    it('does not pin a locationless NASA story to Washington DC', async () => {
        const items = [makeItem({
            title: 'Hubble telescope captures stunning nebula image',
            description: 'The image was taken using the Wide Field Camera 3.',
            source: 'NASA',
        })];
        const result = await enrichItemsWithLocation(items);
        expect(result[0].latitude).toBeUndefined();
        expect(result[0].longitude).toBeUndefined();
    });

    it('uses a configured domestic feed scope to disambiguate a named place', async () => {
        const [result] = await enrichItemsWithLocation([makeItem({
            title: 'Tax relief or public danger? Florida voters weigh tax cuts against firefighter funding',
            description: 'Florida voters will decide whether to cut property taxes that support local firefighters.',
            source: 'NPR US',
            sourceCountryCode: 'US',
        })]);
        expect(result.latitude).toBeGreaterThan(24);
        expect(result.latitude).toBeLessThan(31);
        expect(result.longitude).toBeGreaterThan(-88);
        expect(result.longitude).toBeLessThan(-80);
    });

    it('never overrides an explicit foreign parent with the feed country', async () => {
        const [result] = await enrichItemsWithLocation([makeItem({
            title: 'Flooding damages homes in Florida, Uruguay',
            description: 'Emergency crews in Uruguay evacuated homes after the river flooded.',
            source: 'NPR US',
            sourceCountryCode: 'US',
        })]);
        expect(result.latitude).toBeGreaterThan(-36);
        expect(result.latitude).toBeLessThan(-30);
        expect(result.longitude).toBeGreaterThan(-59);
        expect(result.longitude).toBeLessThan(-52);
    });

    it('does not invent a location from a domestic feed scope', async () => {
        const [result] = await enrichItemsWithLocation([makeItem({
            title: 'Scientists develop new quantum algorithm',
            description: 'The method could speed up future computing tasks.',
            source: 'NPR US',
            sourceCountryCode: 'US',
        })]);
        expect(result.latitude).toBeUndefined();
        expect(result.longitude).toBeUndefined();
    });

    it('removes publisher attribution without moving a maritime incident to its country', async () => {
        const [result] = await enrichItemsWithLocation([makeItem({
            title: 'US says it killed four people in strike on vessel in Caribbean - The Times of Israel',
            description: 'US says it killed four people in strike on vessel in Caribbean The Times of Israel',
            source: 'Times of Israel',
        })]);
        expect(result.latitude).toBeGreaterThan(8);
        expect(result.latitude).toBeLessThan(25);
        expect(result.longitude).toBeGreaterThan(-90);
        expect(result.longitude).toBeLessThan(-60);
    });
});

/*
  Canonical Coordinates
  The enricher must persist the geocoder output unchanged; display offsets are client-only.
*/
describe('enrichItemsWithLocation - canonical coordinates', () => {
    it('does not jitter co-located events', async () => {
        // Create two items that map to the exact same city
        const items = [
            makeItem({ title: 'KYIV (Reuters) - First event in capital' }),
            makeItem({ title: 'KYIV (AP) - Second event in capital' }),
        ];
        const result = await enrichItemsWithLocation(items);

        const geocoded = result.filter(r => r.latitude != null && r.longitude != null);
        expect(geocoded.length).toBeGreaterThanOrEqual(2);

        if (geocoded.length >= 2) {
            // Both persisted locations must be the canonical geocoder coordinate.
            const coordsMatch =
                geocoded[0].latitude === geocoded[1].latitude &&
                geocoded[0].longitude === geocoded[1].longitude;
            expect(coordsMatch).toBe(true);
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


