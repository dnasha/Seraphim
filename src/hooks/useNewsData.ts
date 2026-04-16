import { useState, useEffect, useCallback, useRef } from 'react';
import { NewsItem, NewsResponse } from '@/lib/types';

/*
  Dan Sharan
  
  useNewsData — React hook for fetching and polling news data.
  Handles initial load, manual refresh, and periodic updates.
*/

export function useNewsData() {
    const [news, setNews] = useState<NewsItem[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [lastUpdated, setLastUpdated] = useState<string | null>(null);
    const isFirstLoad = useRef(true);

    const fetchNews = useCallback(async (isRefresh = false) => {
        setIsLoading(true);
        setError(null);

        try {
            const url = `/api/news${isRefresh ? '?refresh=true' : ''}`;
            const res = await fetch(url);
            if (!res.ok) throw new Error('Failed to fetch news');

            const data: NewsResponse = await res.json();
            setNews(data.items);
            setLastUpdated(new Date().toISOString());
        } catch (err) {
            setError(err instanceof Error ? err.message : 'An error occurred');
        } finally {
            setIsLoading(false);
            isFirstLoad.current = false;
        }
    }, []);

    useEffect(() => {
        fetchNews();
    }, [fetchNews]);

    useEffect(() => {
        const interval = setInterval(() => {
            fetchNews();
        }, 15 * 60 * 1000); // 15 minutes
        return () => clearInterval(interval);
    }, [fetchNews]);

    return { news, isLoading, error, lastUpdated, fetchNews };
}
