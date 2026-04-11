import { useState, useEffect, useMemo } from 'react';
import { NewsItem } from '@/lib/types';

/*
Dan Sharan

news filter hook

filters news by source, category, time range, and search query

*/

export function useNewsFilter(news: NewsItem[]) {
    const [sources, setSources] = useState<string[]>(['news', 'reddit', 'x', 'telegram']);
    const [categories, setCategories] = useState<string[]>(['all']);
    const [timeRange, setTimeRange] = useState<string>('1d');
    const [mappedOnly, setMappedOnly] = useState<boolean>(true);
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
        let filtered = news;
        if (now === 0) return filtered; // skip filtering until client provides current time

        // source filter
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

        // category filter
        if (categories.length > 0 && !categories.includes('all')) {
            filtered = filtered.filter(item =>
                item.category ? categories.includes(item.category) : categories.includes('general')
            );
        }

        // time filter
        const rangeMs = {
            '1d': 24 * 60 * 60 * 1000,
            '3d': 3 * 24 * 60 * 60 * 1000,
            '1w': 7 * 24 * 60 * 60 * 1000,
            '1m': 30 * 24 * 60 * 60 * 1000,
            'all': Infinity,
        }[timeRange] || Infinity;

        filtered = filtered.filter(item => (now - new Date(item.publishedAt).getTime()) <= rangeMs);

        // search filter
        if (debouncedSearch) {
            const q = debouncedSearch.toLowerCase();
            filtered = filtered.filter(item =>
                item.title.toLowerCase().includes(q) ||
                (item.description || '').toLowerCase().includes(q) ||
                (item.locationName || '').toLowerCase().includes(q)
            );
        }

        // mapped only filter
        if (mappedOnly) {
            filtered = filtered.filter(n => n.latitude != null);
        }

        return filtered;
    }, [news, sources, debouncedSearch, categories, timeRange, mappedOnly, now]);

    return {
        sources, setSources,
        categories, setCategories,
        timeRange, setTimeRange,
        mappedOnly, setMappedOnly,
        searchQuery, setSearchQuery,
        filteredNews
    };
}
