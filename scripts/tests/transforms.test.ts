/*
  Seraphim Data Transformation Tests

  This suite verifies the bi-directional mapping between NewsItem objects
  (used in the frontend) and DbEvent objects (used in the database). It
  also tests string cleaning logic for handling invalid characters and
  orphaned surrogates.
*/

import { describe, it, expect } from 'vitest';
import { cleanString, newsItemToDbEvent } from '../../src/scraper/utils/transforms';
import { dbEventToNewsItem } from '../../src/types';
import type { NewsItem } from '../../src/lib/types';
import type { DbEvent } from '../../src/types';

/*
  makeNewsItem
  Helper factory for creating minimal valid NewsItem objects for tests.
*/
function makeNewsItem(overrides: Partial<NewsItem> = {}): NewsItem {
    return {
        id: 'test-1',
        title: 'Test headline',
        description: 'Test description',
        url: 'https://example.com/article',
        source: 'BBC News',
        sourceType: 'rss',
        category: 'world',
        publishedAt: '2026-04-10T12:00:00Z',
        ...overrides,
    };
}

/*
  cleanString
  Validates the sanitization of strings, specifically ensuring that
  orphaned UTF-16 surrogates are removed to prevent database errors.
*/
describe('cleanString', () => {
    it('returns empty string for null/undefined', () => {
        expect(cleanString(null)).toBe('');
        expect(cleanString(undefined)).toBe('');
    });

    it('passes through normal ASCII text', () => {
        expect(cleanString('Hello world')).toBe('Hello world');
    });

    it('preserves valid emoji/surrogate pairs', () => {
        // Valid surrogate pair: 😀 is \uD83D\uDE00
        const validEmoji = '😀 Test';
        expect(cleanString(validEmoji)).toBe(validEmoji);
    });

    it('strips orphaned high surrogate', () => {
        const withOrphaned = 'Test\uD800 text';
        const result = cleanString(withOrphaned);
        expect(result).toBe('Test text');
        expect(result).not.toContain('\uD800');
    });

    it('strips orphaned low surrogate', () => {
        const withOrphaned = 'Test\uDC00 text';
        const result = cleanString(withOrphaned);
        expect(result).toBe('Test text');
    });
});

/*
  newsItemToDbEvent
  Verifies the transformation of frontend-ready news items into
  database-compatible event records. Includes validation for URLs,
  tags, and coordinate normalization.
*/
describe('newsItemToDbEvent', () => {
    it('converts a valid NewsItem to DbEvent', () => {
        const item = makeNewsItem();
        const event = newsItemToDbEvent(item);
        expect(event).not.toBeNull();
        expect(event!.title).toBe('Test headline');
        expect(event!.url).toBe('https://example.com/article');
        expect(event!.source).toBe('BBC News');
        expect(event!.source_type).toBe('rss');
        expect(event!.category).toBe('world');
    });

    it('returns null for items without a URL', () => {
        const item = makeNewsItem({ url: '' });
        expect(newsItemToDbEvent(item)).toBeNull();
    });

    it('rejects javascript: protocol URLs', () => {
        const item = makeNewsItem({ url: 'javascript:alert(1)' });
        expect(newsItemToDbEvent(item)).toBeNull();
    });

    it('rejects ftp: protocol URLs', () => {
        const item = makeNewsItem({ url: 'ftp://evil.com/file' });
        expect(newsItemToDbEvent(item)).toBeNull();
    });

    it('rejects data: protocol URLs', () => {
        const item = makeNewsItem({ url: 'data:text/html,<script>alert(1)</script>' });
        expect(newsItemToDbEvent(item)).toBeNull();
    });

    it('allows http:// URLs', () => {
        const item = makeNewsItem({ url: 'http://example.com/article' });
        const event = newsItemToDbEvent(item);
        expect(event).not.toBeNull();
        expect(event!.url).toBe('http://example.com/article');
    });

    it('normalizes tags: filters empty/whitespace-only strings', () => {
        const item = makeNewsItem({ tags: ['valid', '', '  ', 'also-valid'] });
        const event = newsItemToDbEvent(item);
        expect(event!.tags).toEqual(['valid', 'also-valid']);
    });

    it('sets tags to null when array is empty after filtering', () => {
        const item = makeNewsItem({ tags: ['', '  '] });
        const event = newsItemToDbEvent(item);
        expect(event!.tags).toBeNull();
    });

    it('sets tags to null when undefined', () => {
        const item = makeNewsItem({ tags: undefined });
        const event = newsItemToDbEvent(item);
        expect(event!.tags).toBeNull();
    });

    it('cleans surrogate pairs in title and description', () => {
        const item = makeNewsItem({
            title: 'Test\uD800title',
            description: 'Desc\uDC00text',
        });
        const event = newsItemToDbEvent(item);
        expect(event!.title).toBe('Testtitle');
        expect(event!.description).toBe('Desctext');
    });

    it('sets NaN latitude to null', () => {
        const item = makeNewsItem({ latitude: NaN });
        const event = newsItemToDbEvent(item);
        expect(event!.latitude).toBeNull();
    });

    it('sets Infinity latitude to null', () => {
        const item = makeNewsItem({ latitude: Infinity });
        const event = newsItemToDbEvent(item);
        expect(event!.latitude).toBeNull();
    });

    it('preserves valid coordinates', () => {
        const item = makeNewsItem({ latitude: 50.45, longitude: 30.52 });
        const event = newsItemToDbEvent(item);
        expect(event!.latitude).toBe(50.45);
        expect(event!.longitude).toBe(30.52);
    });

    it('normalizes published_at via ensureIsoDate', () => {
        const item = makeNewsItem({ publishedAt: 'Friday, April 10, 2026 - 16:35' });
        const event = newsItemToDbEvent(item);
        expect(new Date(event!.published_at).getTime()).not.toBeNaN();
    });
});

/*
  dbEventToNewsItem
  Verifies the conversion of database event records back into
  NewsItem objects for use in the frontend UI.
*/
describe('dbEventToNewsItem', () => {
    function makeDbEvent(overrides: Partial<DbEvent> = {}): DbEvent {
        return {
            id: 'uuid-123',
            title: 'DB headline',
            description: 'DB description',
            url: 'https://example.com/db-article',
            source: 'Reuters',
            source_type: 'rss',
            category: 'crisis',
            published_at: '2026-04-10T12:00:00Z',
            latitude: 50.45,
            longitude: 30.52,
            location_name: 'Kyiv',
            tags: ['conflict', 'ukraine'],
            ...overrides,
        };
    }

    it('maps all fields correctly', () => {
        const event = makeDbEvent();
        const item = dbEventToNewsItem(event);
        expect(item.id).toBe('uuid-123');
        expect(item.title).toBe('DB headline');
        expect(item.url).toBe('https://example.com/db-article');
        expect(item.source).toBe('Reuters');
        expect(item.sourceType).toBe('rss');
        expect(item.category).toBe('crisis');
        expect(item.latitude).toBe(50.45);
        expect(item.longitude).toBe(30.52);
        expect(item.locationName).toBe('Kyiv');
        expect(item.tags).toEqual(['conflict', 'ukraine']);
    });

    it('converts null lat/lon to undefined', () => {
        const event = makeDbEvent({ latitude: null, longitude: null });
        const item = dbEventToNewsItem(event);
        expect(item.latitude).toBeUndefined();
        expect(item.longitude).toBeUndefined();
    });

    it('falls back id to url when id is missing', () => {
        const event = makeDbEvent({ id: undefined });
        const item = dbEventToNewsItem(event);
        expect(item.id).toBe('https://example.com/db-article');
    });

    it('converts null tags to undefined', () => {
        const event = makeDbEvent({ tags: null });
        const item = dbEventToNewsItem(event);
        expect(item.tags).toBeUndefined();
    });

    it('converts null location_name to undefined', () => {
        const event = makeDbEvent({ location_name: null });
        const item = dbEventToNewsItem(event);
        expect(item.locationName).toBeUndefined();
    });
});

