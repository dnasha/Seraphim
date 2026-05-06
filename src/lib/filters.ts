/*
  Pure filtering logic for news items.
  Extracted from useNewsFilter hook for testability.
  Handles source, category, time range, search query filtering, and sort mode.
*/

import { NewsItem } from './types';

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
}

/**
 * Applies all filter criteria to a list of news items.
 * Pure function: no React dependencies, no side effects.
 */
export function applyNewsFilters(items: NewsItem[], options: FilterOptions): NewsItem[] {
    const { sources, categories, timeRange, customStartDate, customEndDate, mappedOnly, searchQuery, now, sortMode = 'new' } = options;

    let filtered = items;
    if (now === 0) return filtered;

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

    const getLatestTime = (item: NewsItem) => {
        if (!item.sources || item.sources.length === 0) return new Date(item.publishedAt).getTime();
        let latest = new Date(item.publishedAt).getTime();
        for (const s of item.sources) {
            const t = new Date(s.discoveredAt).getTime();
            if (t > latest) latest = t;
        }
        return latest;
    };

    // 6. Sort by mode
    if (sortMode === 'hot') {
        // "Hot" prioritizes stories with the most corroborating sources or clustered events, then recency
        filtered.sort((a, b) => {
            const countA = a.eventCount && a.eventCount > 1 ? Number(a.eventCount) : (a.sources?.length ?? 1);
            const countB = b.eventCount && b.eventCount > 1 ? Number(b.eventCount) : (b.sources?.length ?? 1);
            if (countB !== countA) return countB - countA;
            const timeA = getLatestTime(a);
            const timeB = getLatestTime(b);
            return (isNaN(timeB) ? 0 : timeB) - (isNaN(timeA) ? 0 : timeA);
        });
    } else {
        // "New" sorts by latest first (default)
        filtered.sort((a, b) => {
            const timeA = getLatestTime(a);
            const timeB = getLatestTime(b);
            return (isNaN(timeB) ? 0 : timeB) - (isNaN(timeA) ? 0 : timeA);
        });
    }

    return filtered;
}
