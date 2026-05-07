'use client';

/*
useNewsFilter hook handles client-side filtering of news events.
Maintains state for active sources, categories, and sort mode, and provides
a memoized filtered list based on user preferences and search queries.
*/

import { useState, useEffect, useMemo } from 'react';
import { NewsItem } from '@/lib/types';
import { applyNewsFilters, SortMode } from '@/lib/filters';
import { BBox } from '@/lib/geo';

export function useNewsFilter(
    news: NewsItem[],
    mappedOnly: boolean,
    timeRange: string,
    debouncedSearch: string,
    customStartDate?: string,
    customEndDate?: string,
    sortMode: SortMode = 'new',
    currentBBox?: BBox | null,
    sidebarRespectBBox = true,
    unmappedOnly = false,
    appliedSortMode?: string
) {
    const [sources, setSources] = useState<string[]>(['news', 'reddit', 'x', 'telegram', 'extra']);
    const [categories, setCategories] = useState<string[]>(['all']);
    
    /* track time in state to avoid impurity in useMemo */
    const [now, setNow] = useState(0);

    /* initialize time on mount and update every 5 minutes */
    useEffect(() => {
        const timer = setTimeout(() => setNow(Date.now()), 0);
        const interval = setInterval(() => {
            setNow(Date.now());
        }, 5 * 60 * 1000);
        return () => {
            clearTimeout(timer);
            clearInterval(interval);
        };
    }, []);

    // Use appliedSortMode if provided to ensure filters match the current data state
    const effectiveSortMode = (appliedSortMode as SortMode) || sortMode;

    const filteredNews = useMemo(() => {
        return applyNewsFilters(news, {
            sources,
            categories,
            timeRange,
            customStartDate,
            customEndDate,
            mappedOnly,
            unmappedOnly,
            searchQuery: debouncedSearch,
            now,
            sortMode: effectiveSortMode,
            bbox: currentBBox || undefined,
            respectBBox: sidebarRespectBBox,
        });
    }, [news, sources, debouncedSearch, categories, timeRange, mappedOnly, unmappedOnly, now, customStartDate, customEndDate, effectiveSortMode, currentBBox, sidebarRespectBBox]); /* Re-filter whenever state or source data changes. */

    const mapNews = useMemo(() => {
        return applyNewsFilters(news, {
            sources,
            categories,
            timeRange,
            customStartDate,
            customEndDate,
            mappedOnly,
            unmappedOnly,
            searchQuery: debouncedSearch,
            now,
            sortMode: effectiveSortMode,
            bbox: currentBBox || undefined,
            respectBBox: true,
        });
    }, [news, sources, debouncedSearch, categories, timeRange, mappedOnly, unmappedOnly, now, customStartDate, customEndDate, effectiveSortMode, currentBBox]);

    return {
        sources, setSources,
        categories, setCategories,
        filteredNews,
        mapNews,
    };
}
