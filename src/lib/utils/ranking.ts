/**
 * Ranking and sorting utilities for news items.
 * This module handles the logic for ordering stories based on recency (New) or impact (Hot),
 * and provides robust methods for calculating event counts and timestamps from multiple sources.
 */

import { NewsItem } from '@/lib/core/types';

export type SortMode = 'new' | 'hot';

/**
 * Normalizes a sort mode string to a valid SortMode. Defaults to 'hot'.
 */
export function normalizeSortMode(mode?: string | null): SortMode {
    return mode === 'new' ? 'new' : 'hot';
}

/**
 * Determines the most recent timestamp associated with a story.
 * It checks latestActivityAt, publishedAt, and the discoveredAt time of all individual sources.
 * This ensures that active or updated stories are correctly surfaced.
 */
export function latestReportTimestamp(item: Pick<NewsItem, 'publishedAt' | 'sources' | 'latestActivityAt'>): number {
    const parseDate = (d: string | undefined | null) => {
        if (!d) return 0;
        const ts = new Date(d).getTime();
        return Number.isFinite(ts) ? ts : 0;
    };

    const latestActivityMs = parseDate(item.latestActivityAt);
    const publishedAtMs = parseDate(item.publishedAt);
    let latestSourceMs = 0;

    for (const source of item.sources ?? []) {
        const discoveredAtMs = parseDate(source.discoveredAt);
        if (discoveredAtMs > latestSourceMs) {
            latestSourceMs = discoveredAtMs;
        }
    }

    return Math.max(latestActivityMs, publishedAtMs, latestSourceMs);
}

/**
 * Calculates a robust event count by checking multiple potential source count fields.
 * This is necessary to handle variations in API responses and RPC mismatches.
 * It explicitly ignores map cluster counts (storyCount) to focus on the count of actual sources.
 */
export function canonicalEventCount(item: NewsItem | Pick<NewsItem, 'sourcesCount' | 'sources'>): number {
    const raw = item as unknown as Record<string, unknown>;
    const rawCount = (
        item.sourcesCount ?? 
        raw.sourceCount ?? 
        raw.event_count ?? 
        raw.source_count ?? 
        raw.eventCount ?? 
        0
    );
    const sCount = typeof rawCount === 'number' ? rawCount : Number(rawCount);
    const safeSCount = Number.isFinite(sCount) ? sCount : 0;
    const sourcesLen = item.sources?.length || 0;

    const count = Math.max(safeSCount, sourcesLen);
    return count > 0 ? count : 1;
}

/**
 * Alias for canonicalEventCount representing the reporting strength of a story.
 */
export function eventStrength(item: Pick<NewsItem, 'sourcesCount' | 'sources'>): number {
    return canonicalEventCount(item);
}

/**
 * Extracts the number of stories within a map cluster.
 */
export function clusterStoryCount(item: Pick<NewsItem, 'storyCount'>): number {
    const count = Number(item.storyCount);
    return (Number.isFinite(count) && count > 0) ? count : 1;
}

/**
 * Core comparison logic for sorting news items.
 * Hot Mode: Prioritizes impact score, then actual source count, then recency.
 * New Mode: Prioritizes recency.
 * Tiebreaks are handled by credibility tier and unique ID stability.
 */
export function compareNewsItems(a: NewsItem, b: NewsItem, mode: SortMode): number {
    if (mode === 'hot') {
        // 1. Impact Score (Descending)
        const rawA = a as unknown as Record<string, unknown>;
        const rawB = b as unknown as Record<string, unknown>;
        const scoreA = (a.impactScore ?? rawA.impact_score) as number || 0;
        const scoreB = (b.impactScore ?? rawB.impact_score) as number || 0;
        if (scoreB !== scoreA) return scoreB - scoreA;

        // 2. Source Count (Descending)
        const countA = canonicalEventCount(a);
        const countB = canonicalEventCount(b);
        if (countB !== countA) return countB - countA;
    }

    // 3. Recency (Descending)
    const timeA = latestReportTimestamp(a);
    const timeB = latestReportTimestamp(b);
    if (timeB !== timeA) return timeB - timeA;

    // Stable tiebreaks
    const credA = a.credibilityTier || 3;
    const credB = b.credibilityTier || 3;
    if (credB !== credA) return credA - credB;

    return (a.originalId || a.id).localeCompare(b.originalId || b.id);
}

/**
 * Returns a sorted copy of the provided news items based on the specified sort mode.
 */
export function sortNewsItems(items: NewsItem[], mode: SortMode): NewsItem[] {
    return [...items].sort((a, b) => compareNewsItems(a, b, mode));
}
