import { NextResponse } from 'next/server';
import { fetchGNews } from '@/lib/gnews';
import { fetchAllRSSFeeds } from '@/lib/rss';
import { enrichItemsWithLocation } from '@/lib/geocode';
import { NewsItem, NewsResponse } from '@/lib/types';

// simple in-memory cache
const cache = new Map<string, { data: NewsItem[]; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000;

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const categoriesArray = (searchParams.get('categories') || 'general').split(',');
    const categories = categoriesArray.slice().sort().join(',');
    const search = searchParams.get('search');
    const sourcesParam = searchParams.get('sources') || 'gnews,rss';
    const sources = sourcesParam.split(',').sort();
    const forceRefresh = searchParams.get('refresh') === 'true';

    const cacheKey = `${categories}|${sources.join(',')}`;

    try {
        const cachedEntry = cache.get(cacheKey);

        if (!forceRefresh && cachedEntry && Date.now() - cachedEntry.timestamp < CACHE_TTL) {
            let filteredItems = cachedEntry.data;

            if (sources.length > 0) {
                filteredItems = filteredItems.filter(item => sources.includes(item.sourceType));
            }

            if (!categories.includes('general')) {
                filteredItems = filteredItems.filter(item =>
                    item.category && categories.includes(item.category)
                );
            }

            if (search) {
                const searchLower = search.toLowerCase();
                filteredItems = filteredItems.filter(item =>
                    item.title.toLowerCase().includes(searchLower) ||
                    item.description.toLowerCase().includes(searchLower)
                );
            }

            const response: NewsResponse = {
                items: filteredItems,
                lastUpdated: new Date(cachedEntry.timestamp).toISOString(),
                sources: {
                    gnews: sources.includes('gnews'),
                    rss: sources.includes('rss'),
                },
            };

            return NextResponse.json(response);
        }

        // fetch fresh data from all sources
        const [gnewsItems, rssItems] = await Promise.all([
            fetchGNews(categoriesArray.includes('general') ? 'general' : categoriesArray[0], 20),
            fetchAllRSSFeeds(),
        ]);

        const allItems = [...gnewsItems, ...rssItems];

        allItems.sort((a, b) =>
            new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
        );

        // enrich with geolocation
        const enrichedItems = await enrichItemsWithLocation(allItems);

        cache.set(cacheKey, { data: enrichedItems, timestamp: Date.now() });

        // apply filters
        let filteredItems = enrichedItems;

        if (sources.length > 0) {
            filteredItems = filteredItems.filter(item => sources.includes(item.sourceType));
        }

        if (categoriesArray.length > 0 && !categoriesArray.includes('general')) {
            filteredItems = filteredItems.filter(item =>
                item.category && categoriesArray.includes(item.category)
            );
        }

        if (search) {
            const searchLower = search.toLowerCase();
            filteredItems = filteredItems.filter(item =>
                item.title.toLowerCase().includes(searchLower) ||
                item.description.toLowerCase().includes(searchLower)
            );
        }

        const response: NewsResponse = {
            items: filteredItems,
            lastUpdated: new Date().toISOString(),
            sources: {
                gnews: sources.includes('gnews'),
                rss: sources.includes('rss'),
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
