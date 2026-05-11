import { describe, it, expect } from 'vitest';
import { latestReportTimestamp, canonicalEventCount } from '../../src/lib/ranking';
import { NewsItem } from '../../src/lib/types';

describe('Ranking Logic Robustness', () => {
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
