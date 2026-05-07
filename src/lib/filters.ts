import { NewsItem } from './types';
import { BBox, isWithinBBox } from './geo';
import { compareNewsItems, latestReportTimestamp, normalizeSortMode, sortNewsItems as sortRanked } from './ranking';

export type SortMode = 'new' | 'hot';

export interface FilterOptions {
    sources: string[];
    categories: string[];
    timeRange: string;
    customStartDate?: string;
    customEndDate?: string;
    mappedOnly: boolean;
    unmappedOnly?: boolean;
    searchQuery: string;
    now: number;
    sortMode?: SortMode;
    bbox?: BBox;
    respectBBox?: boolean;
}

/**
 * Applies all filter criteria to a list of news items.
 * Pure function: no React dependencies, no side effects.
 */
export function applyNewsFilters(items: NewsItem[], options: FilterOptions): NewsItem[] {
    const { sources, categories, timeRange, customStartDate, customEndDate, mappedOnly, unmappedOnly, searchQuery, now, sortMode = 'new', bbox, respectBBox = true } = options;
    const mode = normalizeSortMode(sortMode);

    let filtered = items;
    if (now === 0) return filtered;

    // 0. BBox Viewport filtering (to sync sidebar with map view)
    // BBox filter is bypassed if unmappedOnly is true to allow viewing global unmapped news
    if (bbox && respectBBox && !unmappedOnly) {
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
            // If they have all defaults selected, don't drop unknown social sources
            if (sources.includes('reddit') && sources.includes('x') && sources.includes('telegram')) return true;
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
            const time = latestReportTimestamp(item);
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

        filtered = filtered.filter(item => (now - latestReportTimestamp(item)) <= rangeMs);
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

    // 5. Geographical filter (items with/without coordinates)
    if (unmappedOnly) {
        filtered = filtered.filter(n => n.latitude == null);
    } else if (mappedOnly) {
        filtered = filtered.filter(n => n.latitude != null);
    }

    // 6. Canonical dedupe to prevent duplicate cards/pins when both cluster and original exist.
    const deduped = new Map<string, NewsItem>();
    for (const item of filtered) {
        const key = item.originalId || item.id;
        const existing = deduped.get(key);
        if (!existing) {
            deduped.set(key, item);
            continue;
        }
        if (compareNewsItems(item, existing, mode) < 0) {
            deduped.set(key, item);
        }
    }

    // 7. Sort by mode
    return sortRanked(Array.from(deduped.values()), mode);
}
