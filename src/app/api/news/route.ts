import { NextResponse } from 'next/server';
import { fetchGNews, fetchOSINTGNews } from '@/lib/gnews';
import { fetchAllRSSFeeds, fetchAllRedditFeeds } from '@/lib/rss';
import { fetchSocialFeeds } from '@/lib/social-feeds';
import { enrichItemsWithLocation } from '@/lib/geocode';
import { NewsItem, NewsResponse } from '@/lib/types';

// simple in-memory cache for individual source groups
const sourceCache = new Map<string, { data: NewsItem[]; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000;

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const categoriesArray = (searchParams.get('categories') || 'general').split(',');
    const search = searchParams.get('search');
    const sourcesParam = searchParams.get('sources') || 'news,reddit,x,telegram,extra';
    const sources = sourcesParam.split(',');
    const timeRange = searchParams.get('timeRange') || 'all';
    const forceRefresh = searchParams.get('refresh') === 'true';

    try {
        const now = Date.now();
        
        // Define which sources we need and how to fetch them
        const sourceConfigs = [
            { id: 'extra', fetch: () => Promise.all([fetchGNews('general', 20), fetchOSINTGNews()]).then(res => res.flat()) },
            { id: 'news', fetch: () => fetchAllRSSFeeds() },
            { id: 'social', fetch: () => fetchSocialFeeds() },
            { id: 'reddit', fetch: () => fetchAllRedditFeeds() },
        ];

        // Filter configs to only what's requested (x/telegram are combined in 'social')
        const activeConfigs = sourceConfigs.filter(cfg => {
            if (cfg.id === 'extra' && sources.includes('extra')) return true;
            if (cfg.id === 'news' && sources.includes('news')) return true;
            if (cfg.id === 'reddit' && sources.includes('reddit')) return true;
            if (cfg.id === 'social' && (sources.includes('x') || sources.includes('telegram'))) return true;
            return false;
        });

        // 1. Check cache and identify what needs fetching
        const allItems: NewsItem[] = [];
        const fetchPromises: Promise<void>[] = [];

        for (const cfg of activeConfigs) {
            const cachedValue = sourceCache.get(cfg.id);
            if (!forceRefresh && cachedValue && (now - cachedValue.timestamp) < CACHE_TTL) {
                allItems.push(...cachedValue.data);
            } else {
                fetchPromises.push(
                    cfg.fetch().then(async (fetchedData) => {
                        // Enrich new data with location before caching
                        const enriched = await enrichItemsWithLocation(fetchedData);
                        sourceCache.set(cfg.id, { data: enriched, timestamp: Date.now() });
                        allItems.push(...enriched);
                    })
                );
            }
        }

        if (fetchPromises.length > 0) {
            await Promise.all(fetchPromises);
        }

        // Apply shared filters (redundant if client does it, but useful for API consistency)
        let filteredItems = allItems;

        // Source filter (internal sanity check if we over-fetched)
        filteredItems = filteredItems.filter(item => {
            if (sources.includes('news') && item.sourceType === 'rss') return true;
            if (sources.includes('extra') && item.sourceType === 'gnews') return true;
            if (item.sourceType === 'social') {
                const s = item.source.toLowerCase();
                if (sources.includes('reddit') && s.includes('reddit')) return true;
                if (sources.includes('x') && (s.includes('x') || s.includes('twitter'))) return true;
                if (sources.includes('telegram') && s.includes('telegram')) return true;
            }
            return false;
        });

        // Category filter
        if (!categoriesArray.includes('general')) {
            filteredItems = filteredItems.filter(item =>
                item.category && categoriesArray.includes(item.category)
            );
        }

        // Time range filter
        if (timeRange !== 'all') {
            let msCutoff = 0;
            switch(timeRange) {
                case '1d': msCutoff = 24 * 60 * 60 * 1000; break;
                case '3d': msCutoff = 3 * 24 * 60 * 60 * 1000; break;
                case '1w': msCutoff = 7 * 24 * 60 * 60 * 1000; break;
                case '1m': msCutoff = 30 * 24 * 60 * 60 * 1000; break;
            }
            if (msCutoff > 0) {
                filteredItems = filteredItems.filter(item => (now - new Date(item.publishedAt).getTime()) <= msCutoff);
            }
        }

        // Search filter
        if (search) {
            const searchLower = search.toLowerCase();
            filteredItems = filteredItems.filter(item =>
                item.title.toLowerCase().includes(searchLower) ||
                (item.description && item.description.toLowerCase().includes(searchLower))
            );
        }

        // Sort by date
        filteredItems.sort((a, b) =>
            new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
        );

        const response: NewsResponse = {
            items: filteredItems,
            lastUpdated: new Date().toISOString(),
            sources: {
                gnews: sources.includes('extra'),
                rss: sources.includes('news'),
                social: sources.includes('reddit') || sources.includes('x') || sources.includes('telegram'),
            },
        };

        return NextResponse.json(response);
    } catch (error) {
        console.error('news api error:', error);
        return NextResponse.json(
            { error: 'Failed to fetch news' },
            { status: 500 }
        );
    }
}
