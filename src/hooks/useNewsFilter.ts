import { useState, useEffect, useMemo } from 'react';
import { NewsItem } from '@/lib/types';
import { applyNewsFilters } from '@/lib/filters';

/*
  Dan Sharan
  
  useNewsFilter — React hook for client-side news filtering.
  Delegates pure filtering logic to applyNewsFilters() for testability.

  timeRange is now owned by the parent (page.tsx) so it can be shared with
  useNewsData, which forwards it to the API for server-side time filtering
  during clustering queries.
*/

export function useNewsFilter(news: NewsItem[], mappedOnly: boolean, timeRange: string, debouncedSearch: string) {
    const [sources, setSources] = useState<string[]>(['news', 'reddit', 'x', 'telegram', 'extra']);
    const [categories, setCategories] = useState<string[]>(['all']);
    
    // track time in state to avoid impurity in useMemo
    const [now, setNow] = useState(0);

    // initialize time on mount and update every 5 minutes
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
            mappedOnly,
            searchQuery: debouncedSearch,
            now,
        });
    }, [news, sources, debouncedSearch, categories, timeRange, mappedOnly, now]);

    return {
        sources, setSources,
        categories, setCategories,
        filteredNews
    };
}
