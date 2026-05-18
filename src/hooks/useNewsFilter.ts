'use client';

/**
 * useNewsFilter hook provides client-side filtering and sorting capabilities 
 * for the news dataset. It manages user preferences for sources and categories 
 * and computes a filtered subset of news items for both the map and sidebar views.
 */

import { useState, useEffect, useMemo } from 'react';
import { NewsItem, BBox } from '@/lib/core/types';
import { SortMode, applyNewsFilters } from '@/lib/utils/filters';

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
    const [minVolume, setMinVolume] = useState<number>(1);
    const [credibilityTiers, setCredibilityTiers] = useState<number[]>([1, 2, 3]);
    
    /**
     * track time in state to avoid impurity in useMemo while allowing 
     * for relative time filtering (e.g., "last 24 hours").
     */
    const [now, setNow] = useState(0);

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

    /**
     * effectiveSortMode ensures that the local filter logic respects the 
     * sort mode actually applied by the server during the last fetch, 
     * preventing UI state mismatches.
     */
    const effectiveSortMode = (appliedSortMode as SortMode) || sortMode;

    const filteredNews = useMemo(() => {
        return applyNewsFilters(news, {
            sources,
            categories,
            minVolume,
            credibilityTiers,
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
    }, [news, sources, debouncedSearch, categories, minVolume, credibilityTiers, timeRange, mappedOnly, unmappedOnly, now, customStartDate, customEndDate, effectiveSortMode, currentBBox, sidebarRespectBBox]);

    const mapNews = useMemo(() => {
        return applyNewsFilters(news, {
            sources,
            categories,
            minVolume,
            credibilityTiers,
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
    }, [news, sources, debouncedSearch, categories, minVolume, credibilityTiers, timeRange, mappedOnly, unmappedOnly, now, customStartDate, customEndDate, effectiveSortMode, currentBBox]);

    return {
        sources, setSources,
        categories, setCategories,
        minVolume, setMinVolume,
        credibilityTiers, setCredibilityTiers,
        filteredNews,
        mapNews,
    };
}
