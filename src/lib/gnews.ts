import { NewsItem } from './types';

/*
Dan Sharan

gnews API integration
*/

const GNEWS_API_KEY = process.env.GNEWS_API_KEY;
const GNEWS_BASE_URL = 'https://gnews.io/api/v4';

interface GNewsArticle {
    title: string;
    description: string;
    content: string;
    url: string;
    image: string;
    publishedAt: string;
    source: { name: string; url: string };
}

interface GNewsResponse {
    totalArticles: number;
    articles: GNewsArticle[];
}

export async function fetchGNews(
    category: string = 'general',
    maxResults: number = 10
): Promise<NewsItem[]> {
    if (!GNEWS_API_KEY) {
        console.warn('GNEWS_API_KEY not set, skipping gnews');
        return [];
    }

    try {
        const params = new URLSearchParams({
            category,
            lang: 'en',
            max: String(maxResults),
            apikey: GNEWS_API_KEY,
        });

        const res = await fetch(`${GNEWS_BASE_URL}/top-headlines?${params}`, {
            signal: AbortSignal.timeout(5000),
        });
        if (res.status === 429) {
            console.warn('gnews: rate-limited (429), skipping headlines');
            return [];
        }
        if (!res.ok) throw new Error(`gnews responded ${res.status}`);

        const data: GNewsResponse = await res.json();

        return data.articles.map((article, i) => ({
            id: `gnews-${category}-${i}-${Date.now()}`,
            title: article.title,
            description: article.description || '',
            url: article.url,
            source: article.source.name,
            sourceType: 'gnews' as const,
            category,
            publishedAt: article.publishedAt,
            imageUrl: article.image,
        }));
    } catch (error) {
        console.error('gnews fetch error:', error);
        return [];
    }
}

export async function searchGNews(query: string, maxResults: number = 10): Promise<NewsItem[]> {
    if (!GNEWS_API_KEY) {
        console.warn('GNEWS_API_KEY not set, skipping gnews search');
        return [];
    }

    try {
        const params = new URLSearchParams({
            q: query,
            lang: 'en',
            max: String(maxResults),
            apikey: GNEWS_API_KEY,
        });

        const res = await fetch(`${GNEWS_BASE_URL}/search?${params}`, {
            signal: AbortSignal.timeout(5000),
        });
        if (res.status === 429) {
            console.warn('gnews: rate-limited (429), skipping search');
            return [];
        }
        if (!res.ok) throw new Error(`gnews search responded ${res.status}`);

        const data: GNewsResponse = await res.json();

        return data.articles.map((article, i) => ({
            id: `gnews-search-${i}-${Date.now()}`,
            title: article.title,
            description: article.description || '',
            url: article.url,
            source: article.source.name,
            sourceType: 'gnews' as const,
            publishedAt: article.publishedAt,
            imageUrl: article.image,
        }));
    } catch (error) {
        console.error('gnews search error:', error);
        return [];
    }
}

// OSINT keyword-driven search
const OSINT_QUERIES: { query: string; tags: string[] }[] = [
    { query: '"geolocated" OR "satellite imagery"', tags: ['OSINT', 'imagery'] },
    { query: '"confirmed strike" OR "explosion reported"', tags: ['OSINT', 'strike'] },
    { query: '"troop deployment" OR "military convoy"', tags: ['OSINT', 'military'] },
    { query: '"cyber attack" OR "critical infrastructure"', tags: ['OSINT', 'cyber'] },
];

export async function fetchOSINTGNews(maxPerQuery: number = 5): Promise<NewsItem[]> {
    if (!GNEWS_API_KEY) return [];

    const seen = new Set<string>();
    const allItems: NewsItem[] = [];

    for (const { query, tags } of OSINT_QUERIES) {
        try {
            const items = await searchGNews(query, maxPerQuery);
            if (items.length === 0 && allItems.length === 0) {
                // rate-limited, no point trying more queries
                break;
            }
            for (const item of items) {
                if (seen.has(item.url)) continue;
                seen.add(item.url);
                allItems.push({
                    ...item,
                    category: 'crisis',
                    tags,
                });
            }
        } catch (error) {
            console.error(`osint gnews query failed for "${query}":`, error);
        }
    }

    return allItems;
}
