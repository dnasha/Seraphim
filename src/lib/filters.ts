import { NewsItem } from './types';
import { BBox, isWithinBBox } from '@/hooks/useNewsData';

export type SortMode = 'new' | 'hot';

export interface FilterOptions {
    sources: string[];
    categories: string[];
    timeRange: string;
    customStartDate?: string;
    customEndDate?: string;
    mappedOnly: boolean;
    searchQuery: string;
    now: number;
    sortMode?: SortMode;
    bbox?: BBox;
}

/**
 * Applies all filter criteria to a list of news items.
 * Pure function: no React dependencies, no side effects.
 */
export function applyNewsFilters(items: NewsItem[], options: FilterOptions): NewsItem[] {
    const { sources, categories, timeRange, customStartDate, customEndDate, mappedOnly, searchQuery, now, sortMode = 'new', bbox } = options;

    let filtered = items;
    if (now === 0) return filtered;

    // 0. BBox Viewport filtering (to sync sidebar with map view)
    if (bbox) {
        filtered = filtered.filter(item => isWithinBBox(item, bbox));
    }

    // 1. Source filtering (RSS, GNews, Social)
    filtered = filtered.filter(item => {
        if (sources.includes('news') && item.sourceType === 'rss') return true;
        if (sources.includes('extra') && item.sourceType === 'gnews') return true;
        if (item.sourceType === 'social') {
            const s = item.source.toLowerCase();
            if (sources.includes('reddit') && s.includes('reddit')) return true;
            if (sources.includes('x') && (s.includes('(x)') || s.includes('twitter'))) return true;
            if (sources.includes('telegram') && s.includes('telegram')) return true;
        }
        return false;
    });

    // 2. Category filtering
    if (categories.length > 0 && !categories.includes('all')) {
        filtered = filtered.filter(item =>
            item.category ? categories.includes(item.category) : categories.includes('general')
        );
    }

    // 3. Time range filtering
    if (timeRange === 'custom') {
        const sinceTime = customStartDate ? new Date(customStartDate).getTime() : -Infinity;
        // End date should include the full day
        const untilDate = customEndDate ? new Date(customEndDate) : null;
        if (untilDate) {
            untilDate.setUTCHours(23, 59, 59, 999);
        }
        const untilTime = untilDate ? untilDate.getTime() : Infinity;
        
        filtered = filtered.filter(item => {
            const time = new Date(item.publishedAt).getTime();
            return time >= sinceTime && time <= untilTime;
        });
    } else {
        const rangeMs = {
            '1d': 24 * 60 * 60 * 1000,
            '3d': 3 * 24 * 60 * 60 * 1000,
            '1w': 7 * 24 * 60 * 60 * 1000,
            '1m': 30 * 24 * 60 * 60 * 1000,
            'all': Infinity,
        }[timeRange] || Infinity;

        filtered = filtered.filter(item => (now - new Date(item.publishedAt).getTime()) <= rangeMs);
    }

    // 4. Search query filtering (title, description, location)
    if (searchQuery) {
        const q = searchQuery.toLowerCase();
        filtered = filtered.filter(item =>
            item.title.toLowerCase().includes(q) ||
            (item.description || '').toLowerCase().includes(q) ||
            (item.locationName || '').toLowerCase().includes(q)
        );
    }

    // 5. Geographical filter (items with coordinates)
    if (mappedOnly) {
        filtered = filtered.filter(n => n.latitude != null);
    }

    // 6. Sort by mode
    if (sortMode === 'hot') {
        // "Hot" prioritizes impact score (backfilled), then corroborating sources, then recency
        filtered.sort((a, b) => {
            // Primary: Impact Score
            const scoreA = a.impactScore || 0;
            const scoreB = b.impactScore || 0;
            if (scoreB !== scoreA) return scoreB - scoreA;

            // Secondary: Event Count
            const countA = Math.max(Number(a.eventCount) || 0, a.sources?.length || 0, 1);
            const countB = Math.max(Number(b.eventCount) || 0, b.sources?.length || 0, 1);
            if (countB !== countA) return countB - countA;

            // Tertiary: Recency
            return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
        });
    } else {
        // "New" sorts by latest first (default)
        filtered.sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());
    }

    return filtered;
}
