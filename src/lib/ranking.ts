import { NewsItem } from '@/lib/types';

export type SortMode = 'new' | 'hot';

export function normalizeSortMode(mode?: string | null): SortMode {
    return mode === 'hot' ? 'hot' : 'new';
}

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

export function canonicalEventCount(item: NewsItem | Pick<NewsItem, 'sourcesCount' | 'sources'>): number {
    // Check all possible count field variations to be extremely robust against API/RPC mismatches
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

    // Reporting strength is strictly based on actual sources (event_count or sources array length)
    // We explicitly IGNORE map cluster count (storyCount) for this metric.
    const count = Math.max(safeSCount, sourcesLen);
    return count > 0 ? count : 1;
}

export function eventStrength(item: Pick<NewsItem, 'sourcesCount' | 'sources'>): number {
    return canonicalEventCount(item);
}

export function clusterStoryCount(item: Pick<NewsItem, 'storyCount'>): number {
    const count = Number(item.storyCount);
    return (Number.isFinite(count) && count > 0) ? count : 1;
}

export function compareNewsItems(a: NewsItem, b: NewsItem, mode: SortMode): number {
    if (mode === 'hot') {
        // 1. Impact Score (DESC)
        const rawA = a as unknown as Record<string, unknown>;
        const rawB = b as unknown as Record<string, unknown>;
        const scoreA = (a.impactScore ?? rawA.impact_score) as number || 0;
        const scoreB = (b.impactScore ?? rawB.impact_score) as number || 0;
        if (scoreB !== scoreA) return scoreB - scoreA;

        // 2. Real Event Count (Sources) (DESC)
        const countA = canonicalEventCount(a);
        const countB = canonicalEventCount(b);
        if (countB !== countA) return countB - countA;
    }

    // 3. Recency (DESC)
    const timeA = latestReportTimestamp(a);
    const timeB = latestReportTimestamp(b);
    if (timeB !== timeA) return timeB - timeA;

    // Final tiebreaks for stable sorting
    const credA = a.credibilityTier || 3;
    const credB = b.credibilityTier || 3;
    if (credB !== credA) return credA - credB;

    return (a.originalId || a.id).localeCompare(b.originalId || b.id);
}

export function sortNewsItems(items: NewsItem[], mode: SortMode): NewsItem[] {
    return [...items].sort((a, b) => compareNewsItems(a, b, mode));
}
