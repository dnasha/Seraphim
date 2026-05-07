import { NewsItem } from '@/lib/types';

export type SortMode = 'new' | 'hot';

export function normalizeSortMode(mode?: string | null): SortMode {
    return mode === 'hot' ? 'hot' : 'new';
}

export function canonicalEventCount(item: Pick<NewsItem, 'sourcesCount' | 'sources' | 'storyCount'>): number {
    const sourcesCount = Number(item.sourcesCount);
    if (Number.isFinite(sourcesCount) && sourcesCount > 0) return sourcesCount;
    
    const fallbackSourcesCount = item.sources?.length ?? 0;
    return fallbackSourcesCount > 0 ? fallbackSourcesCount : 1;
}

export function eventStrength(item: Pick<NewsItem, 'sourcesCount' | 'sources' | 'storyCount'>): number {
    return canonicalEventCount(item);
}

export function clusterStoryCount(item: Pick<NewsItem, 'storyCount'>): number {
    const count = Number(item.storyCount);
    return (Number.isFinite(count) && count > 0) ? count : 1;
}

export function compareNewsItems(a: NewsItem, b: NewsItem, mode: SortMode): number {
    if (mode === 'hot') {
        const scoreA = a.impactScore || 0;
        const scoreB = b.impactScore || 0;
        if (scoreB !== scoreA) return scoreB - scoreA;

        const countA = eventStrength(a);
        const countB = eventStrength(b);
        if (countB !== countA) return countB - countA;
    }

    return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
}

export function sortNewsItems(items: NewsItem[], mode: SortMode): NewsItem[] {
    return [...items].sort((a, b) => compareNewsItems(a, b, mode));
}
