import { useState, useEffect, useCallback, useRef } from 'react';
import { NewsItem, NewsResponse } from '@/lib/types';

/*
  Dan Sharan
  
  useNewsData — React hook for fetching and polling news data.
  Handles initial load, manual refresh, and periodic updates.
*/

export function useNewsData({ includeUnmapped }: { includeUnmapped: boolean }) {
    const [news, setNews] = useState<NewsItem[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isLoadingMore, setIsLoadingMore] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [lastUpdated, setLastUpdated] = useState<string | null>(null);
    const [nextCursor, setNextCursor] = useState<string | null>(null);
    const isFirstLoad = useRef(true);

    const fetchNews = useCallback(async (isRefresh = false) => {
        setIsLoading(true);
        setError(null);

        try {
            const params = new URLSearchParams();
            if (isRefresh) params.append('refresh', 'true');
            if (includeUnmapped) params.append('include_unmapped', 'true');
            
            const url = `/api/news?${params.toString()}`;
            const res = await fetch(url);
            if (!res.ok) throw new Error('Failed to fetch news');

            const data: NewsResponse = await res.json();
            setNews(data.items);
            setNextCursor(data.nextCursor || null);
            setLastUpdated(new Date().toISOString());
        } catch (err) {
            setError(err instanceof Error ? err.message : 'An error occurred');
        } finally {
            setIsLoading(false);
            isFirstLoad.current = false;
        }
    }, [includeUnmapped]);

    const loadMore = useCallback(async () => {
        if (!nextCursor || isLoadingMore) return;
        setIsLoadingMore(true);
        setError(null);

        try {
            const params = new URLSearchParams();
            if (includeUnmapped) params.append('include_unmapped', 'true');
            params.append('cursor', nextCursor);

            const url = `/api/news?${params.toString()}`;
            const res = await fetch(url);
            if (!res.ok) throw new Error('Failed to load more news');

            const data: NewsResponse = await res.json();
            setNews(prev => [...prev, ...data.items]);
            setNextCursor(data.nextCursor || null);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'An error occurred');
        } finally {
            setIsLoadingMore(false);
        }
    }, [nextCursor, isLoadingMore, includeUnmapped]);

    // Initial fetch and refetch when includeUnmapped changes
    useEffect(() => {
        fetchNews();
    }, [fetchNews]);

    // Polling interval
    useEffect(() => {
        const interval = setInterval(() => {
            fetchNews();
        }, 15 * 60 * 1000); // 15 minutes
        return () => clearInterval(interval);
    }, [fetchNews]);

    return { 
        news, 
        isLoading, 
        isLoadingMore, 
        hasMore: !!nextCursor, 
        error, 
        lastUpdated, 
        fetchNews, 
        loadMore 
    };
}
