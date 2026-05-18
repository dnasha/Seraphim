/**
 * UI filtering logic for news items.
 * This module provides a pure function to apply various filter criteria (sources, categories, 
 * time range, search query, and geography) to a list of news items.
 */

import { NewsItem, BBox } from '@/lib/core/types';
import { isWithinBBox } from './geo';
import { compareNewsItems, latestReportTimestamp, normalizeSortMode, sortNewsItems as sortRanked, canonicalEventCount } from './ranking';

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
    minVolume?: number;
    credibilityTiers?: number[];
}

/**
 * Applies all filter criteria to a list of news items.
 * This is a pure function with no React dependencies or side effects.
 */
export function applyNewsFilters(items: NewsItem[], options: FilterOptions): NewsItem[] {
    const { sources, categories, timeRange, customStartDate, customEndDate, mappedOnly, unmappedOnly, searchQuery, now, sortMode = 'new', bbox, respectBBox = true, minVolume, credibilityTiers } = options;
    const mode = normalizeSortMode(sortMode);

    let filtered = items;
    if (now === 0) return filtered;

    /**
     * 0. Viewport Filtering
     * Synchronizes the sidebar list with the current map bounding box.
     * This filter is bypassed when viewing global unmapped news.
     */
    if (bbox && respectBBox && !unmappedOnly) {
        filtered = filtered.filter(item => isWithinBBox(item, bbox));
    }

    /**
     * 1. Source Filtering
     * Filters by source type (RSS, GNews, Social) and specific social platforms.
     */
    filtered = filtered.filter(item => {
        if (sources.includes('news') && item.sourceType === 'rss') return true;
        if (sources.includes('extra') && item.sourceType === 'gnews') return true;
        if (item.sourceType === 'social') {
            const s = item.source.toLowerCase();
            if (sources.includes('reddit') && s.includes('reddit')) return true;
            if (sources.includes('x') && (s.includes('(x)') || s.includes('twitter'))) return true;
            if (sources.includes('telegram') && s.includes('telegram')) return true;
            if (sources.includes('reddit') && sources.includes('x') && sources.includes('telegram')) return true;
        }
        return false;
    });

    /**
     * 2. Category Filtering
     */
    if (categories.length > 0 && !categories.includes('all')) {
        filtered = filtered.filter(item =>
            item.category ? categories.includes(item.category) : categories.includes('general')
        );
    }

    /**
     * 3. Time Range Filtering
     * Handles both relative (e.g., 1d, 1w) and custom date range filters.
     */
    if (timeRange === 'custom') {
        const sinceTime = customStartDate ? new Date(customStartDate).getTime() : -Infinity;
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

    /**
     * 4. Search Query Filtering
     * Performs a case-insensitive search across title, description, and location name.
     */
    if (searchQuery) {
        const q = searchQuery.toLowerCase();
        filtered = filtered.filter(item =>
            item.title.toLowerCase().includes(q) ||
            (item.description || '').toLowerCase().includes(q) ||
            (item.locationName || '').toLowerCase().includes(q)
        );
    }

    /**
     * 5. Geographical Visibility Filter
     */
    if (unmappedOnly) {
        filtered = filtered.filter(n => n.latitude == null);
    } else if (mappedOnly) {
        filtered = filtered.filter(n => n.latitude != null);
    }

    /**
     * 5b. Volume ("Hotness") Filtering
     */
    if (minVolume !== undefined && minVolume > 1) {
        filtered = filtered.filter(item => canonicalEventCount(item) >= minVolume);
    }

    /**
     * 5c. Credibility Badge Filtering
     */
    if (credibilityTiers && credibilityTiers.length > 0) {
        filtered = filtered.filter(item => {
            const tier = item.credibilityTier ?? 3;
            return credibilityTiers.includes(tier);
        });
    }

    /**
     * 6. Canonical Deduplication
     * Prevents duplicate cards or pins when both a cluster and its original stories exist 
     * in the same result set. It uses the originalId (or id as fallback) to keep only 
     * the most relevant version of a story based on the current sort mode.
     */
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

    /**
     * 7. Final Sorting
     */
    return sortRanked(Array.from(deduped.values()), mode);
}
