import { NextResponse } from 'next/server';
import { fetchGNews, fetchOSINTGNews } from '@/lib/gnews';
import { fetchAllRSSFeeds, fetchAllRedditFeeds } from '@/lib/rss';
import { fetchSocialFeeds } from '@/lib/social-feeds';
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
    const sourcesParam = searchParams.get('sources') || 'news,reddit,x,telegram,extra';
    const sources = sourcesParam.split(',').sort();
    const timeRange = searchParams.get('timeRange') || 'all';
    const forceRefresh = searchParams.get('refresh') === 'true';

    const cacheKey = `${categories}|${sources.join(',')}`; // Time range parsing happens post-cache to reuse the full data fetch logic

    try {
        const cachedEntry = cache.get(cacheKey);

        const filterItemsByTime = (items: NewsItem[]) => {
            if (timeRange === 'all') return items;
            
            const now = Date.now();
            let msCutoff = 0;
            switch(timeRange) {
                case '1d': msCutoff = 24 * 60 * 60 * 1000; break;
                case '3d': msCutoff = 3 * 24 * 60 * 60 * 1000; break;
                case '1w': msCutoff = 7 * 24 * 60 * 60 * 1000; break;
                case '1m': msCutoff = 30 * 24 * 60 * 60 * 1000; break;
                default: return items;
            }
            
            return items.filter(item => (now - new Date(item.publishedAt).getTime()) <= msCutoff);
        };

        const filterItemsBySource = (items: NewsItem[]) => {
            if (sources.length === 0) return items;
            
            return items.filter(item => {
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
        };

        if (!forceRefresh && cachedEntry && Date.now() - cachedEntry.timestamp < CACHE_TTL) {
            let filteredItems = filterItemsBySource(cachedEntry.data);
            filteredItems = filterItemsByTime(filteredItems);

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
                    gnews: sources.includes('extra'),
                    rss: sources.includes('news'),
                    social: sources.includes('reddit') || sources.includes('x') || sources.includes('telegram'),
                },
            };

            return NextResponse.json(response);
        }

        // fetch only the sources the client actually requested
        const wantGNews = sources.includes('extra');
        const wantRSS = sources.includes('news');
        const wantSocial = sources.includes('x') || sources.includes('telegram');
        const wantReddit = sources.includes('reddit');

        const [gnewsItems, rssItems, osintItems, socialItems, redditItems] = await Promise.all([
            wantGNews
                ? fetchGNews(categoriesArray.includes('general') ? 'general' : categoriesArray[0], 20)
                : Promise.resolve([]),
            wantRSS ? fetchAllRSSFeeds() : Promise.resolve([]),
            wantGNews ? fetchOSINTGNews() : Promise.resolve([]),
            wantSocial ? fetchSocialFeeds() : Promise.resolve([]),
            wantReddit ? fetchAllRedditFeeds() : Promise.resolve([]),
        ]);

        const allItems = [...gnewsItems, ...rssItems, ...osintItems, ...socialItems, ...redditItems];

        allItems.sort((a, b) =>
            new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
        );

        // enrich with geolocation
        const enrichedItems = await enrichItemsWithLocation(allItems);

        cache.set(cacheKey, { data: enrichedItems, timestamp: Date.now() });

        // apply filters
        let filteredItems = filterItemsBySource(enrichedItems);
        filteredItems = filterItemsByTime(filteredItems);

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
