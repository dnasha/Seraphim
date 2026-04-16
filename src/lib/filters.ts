/*
  Dan Sharan

  Pure filtering logic for news items.
  Extracted from useNewsFilter hook for testability.
*/

import { NewsItem } from './types';

export interface FilterOptions {
    sources: string[];
    categories: string[];
    timeRange: string;
    mappedOnly: boolean;
    searchQuery: string;
    now: number;
}

/**
 * Applies all filter criteria to a list of news items.
 * Pure function — no React dependencies, no side effects.
 */
export function applyNewsFilters(items: NewsItem[], options: FilterOptions): NewsItem[] {
    const { sources, categories, timeRange, mappedOnly, searchQuery, now } = options;

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
    const rangeMs = {
        '1d': 24 * 60 * 60 * 1000,
        '3d': 3 * 24 * 60 * 60 * 1000,
        '1w': 7 * 24 * 60 * 60 * 1000,
        '1m': 30 * 24 * 60 * 60 * 1000,
        'all': Infinity,
    }[timeRange] || Infinity;

    filtered = filtered.filter(item => (now - new Date(item.publishedAt).getTime()) <= rangeMs);

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

    return filtered;
}
