'use client';

/*
useNewsFilter hook handles client-side filtering of news events.
Maintains state for active sources and categories, and provides a memoized
filtered list based on user preferences and search queries.
*/

import { useState, useEffect, useMemo } from 'react';
import { NewsItem } from '@/lib/types';
import { applyNewsFilters } from '@/lib/filters';

export function useNewsFilter(news: NewsItem[], mappedOnly: boolean, timeRange: string, debouncedSearch: string, customStartDate?: string, customEndDate?: string) {
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

    const filteredNews = useMemo(() => {
        return applyNewsFilters(news, {
            sources,
            categories,
            timeRange,
            customStartDate,
            customEndDate,
            mappedOnly,
            searchQuery: debouncedSearch,
            now,
        });
    }, [news, sources, debouncedSearch, categories, timeRange, mappedOnly, now, customStartDate, customEndDate]); /* Re-filter whenever state or source data changes. */

    return {
        sources, setSources,
        categories, setCategories,
        filteredNews
    };
}
