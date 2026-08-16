/*
  Seraphim Ranking Logic Robustness Tests
  Verifies temporal ranking and source counting logic for stories.
  Ensures graceful handling of malformed dates and non-numeric fields.

  Usage: bun run test -- scripts/tests/ranking.test.ts
*/

import { describe, it, expect } from 'vitest';
import { latestReportTimestamp, canonicalEventCount, compareNewsItems } from '@/lib/utils/ranking';
import { NewsItem } from '@/lib/core/types';

describe('Ranking Logic Robustness', () => {
    it('does not use raw same-publisher article volume as a hot-sort tiebreaker', () => {
        const olderTemplate = {
            id: 'template', title: 'Daily brief', url: 'https://example.com/template',
            source: 'Example', sourceType: 'rss', publishedAt: '2026-04-10T10:00:00Z',
            sourcesCount: 50, impactScore: 1.5,
        } as NewsItem;
        const newerReport = {
            id: 'newer', title: 'New report', url: 'https://other.example/report',
            source: 'Other', sourceType: 'rss', publishedAt: '2026-04-10T11:00:00Z',
            sourcesCount: 1, impactScore: 1.5,
        } as NewsItem;

        expect(compareNewsItems(olderTemplate, newerReport, 'hot')).toBeGreaterThan(0);
    });

    /*
      latestReportTimestamp
      Ensures the latest activity or publication date is correctly identified
      even when some input fields are corrupted.
    */
    describe('latestReportTimestamp', () => {
        it('handles malformed publishedAt gracefully', () => {
            const item = {
                publishedAt: 'invalid-date',
                sources: []
            } as unknown as NewsItem;
            
            expect(latestReportTimestamp(item)).toBe(0);
        });

        it('handles malformed latestActivityAt gracefully', () => {
            const item = {
                publishedAt: '2026-04-10T12:00:00Z',
                latestActivityAt: 'totally-broken',
                sources: []
            } as unknown as NewsItem;
            
            const expected = new Date('2026-04-10T12:00:00Z').getTime();
            expect(latestReportTimestamp(item)).toBe(expected);
        });

        it('handles malformed source discovery dates gracefully', () => {
            const item = {
                publishedAt: '2026-04-10T12:00:00Z',
                sources: [
                    { name: 'Source 1', discoveredAt: 'invalid' }
                ]
            } as unknown as NewsItem;
            
            const expected = new Date('2026-04-10T12:00:00Z').getTime();
            expect(latestReportTimestamp(item)).toBe(expected);
        });

        it('handles null/undefined fields gracefully', () => {
            const item = {
                publishedAt: '2026-04-10T12:00:00Z',
                sources: undefined
            } as unknown as NewsItem;
            
            const expected = new Date('2026-04-10T12:00:00Z').getTime();
            expect(latestReportTimestamp(item)).toBe(expected);
        });
    });

    /*
      canonicalEventCount
      Verifies that story source counts are accurately calculated
      from both sourcesCount and individual source lists.
    */
    describe('canonicalEventCount', () => {
        it('handles NaN in sourcesCount gracefully', () => {
            const item = {
                sourcesCount: 'not-a-number' as unknown as number,
                sources: []
            } as unknown as NewsItem;
            
            expect(canonicalEventCount(item)).toBe(1);
        });

        it('handles malformed raw fields gracefully', () => {
            const item = {
                event_count: 'abc'
            } as unknown as NewsItem;
            
            expect(canonicalEventCount(item)).toBe(1);
        });

        it('prioritizes valid numbers', () => {
            const item = {
                sourcesCount: 5,
                sources: [{}, {}]
            } as unknown as NewsItem;
            
            expect(canonicalEventCount(item)).toBe(5);
        });
    });
});

