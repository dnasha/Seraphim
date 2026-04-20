import { useState, useEffect, useMemo } from 'react';
import { NewsItem } from '@/lib/types';
import { applyNewsFilters } from '@/lib/filters';

/*
  Dan Sharan
  
  useNewsFilter — React hook for client-side news filtering.
  Delegates pure filtering logic to applyNewsFilters() for testability.
*/

export function useNewsFilter(news: NewsItem[], mappedOnly: boolean) {
    const [sources, setSources] = useState<string[]>(['news', 'reddit', 'x', 'telegram', 'extra']);
    const [categories, setCategories] = useState<string[]>(['all']);
    const [timeRange, setTimeRange] = useState<string>('1d');
    const [searchQuery, setSearchQuery] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    
    // track time in state to avoid impurity in useMemo
    const [now, setNow] = useState(0);

    useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedSearch(searchQuery);
        }, 300);
        return () => clearTimeout(timer);
    }, [searchQuery]);

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
        timeRange, setTimeRange,
        searchQuery, setSearchQuery,
        filteredNews
    };
}
