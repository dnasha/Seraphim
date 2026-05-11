/*
GNews API client library.
Unified implementation for both the Next.js frontend and the background scraper.
Provides functions for fetching top headlines, performing searches, and 
specialized OSINT keyword-driven queries.
*/

import { NewsItem } from '@/lib/core/types';

const GNEWS_API_KEY = process.env.GNEWS_API_KEY;
const GNEWS_BASE_URL = 'https://gnews.io/api/v4';
const DEFAULT_TIMEOUT = 15000;

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

/**
 * Fetches top headlines from GNews by category.
 */
export async function fetchGNews(
    category: string = 'general',
    maxResults: number = 10,
    timeoutMs: number = DEFAULT_TIMEOUT
): Promise<NewsItem[]> {
    if (!GNEWS_API_KEY) {
        console.warn('GNEWS_API_KEY not set, skipping gnews headlines');
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
            signal: AbortSignal.timeout(timeoutMs),
        });

        if (res.status === 403 || res.status === 429) {
            const reason = res.status === 403 ? 'daily quota reached' : 'rate-limited';
            console.warn(`gnews: ${reason} (${res.status}), skipping headlines`);
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

/**
 * Searches GNews articles using a specific query string.
 */
export async function searchGNews(
    query: string, 
    maxResults: number = 10,
    timeoutMs: number = DEFAULT_TIMEOUT
): Promise<NewsItem[]> {
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
            signal: AbortSignal.timeout(timeoutMs),
        });

        if (res.status === 403 || res.status === 429) {
            const reason = res.status === 403 ? 'daily quota reached' : 'rate-limited';
            console.warn(`gnews: ${reason} (${res.status}), skipping search`);
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

/* OSINT-specific keyword search queries */
const OSINT_QUERIES: { query: string; tags: string[] }[] = [
    { query: '"geolocated" OR "satellite imagery"', tags: ['OSINT', 'imagery'] },
    { query: '"confirmed strike" OR "explosion reported"', tags: ['OSINT', 'strike'] },
    { query: '"troop deployment" OR "military convoy"', tags: ['OSINT', 'military'] },
    { query: '"cyber attack" OR "critical infrastructure"', tags: ['OSINT', 'cyber'] },
];

/**
 * Specialized search for OSINT-related content using combined queries to optimize API quota usage.
 */
export async function fetchOSINTGNews(
    maxResults: number = 20,
    timeoutMs: number = DEFAULT_TIMEOUT
): Promise<NewsItem[]> {
    if (!GNEWS_API_KEY) return [];

    // Combine queries to minimize API calls
    const combinedQuery = OSINT_QUERIES.map(q => q.query).join(' OR ');
    
    try {
        const items = await searchGNews(combinedQuery, maxResults, timeoutMs);
        
        return items.map(item => {
            const matchedTags = new Set<string>(['OSINT']);
            const text = (item.title + ' ' + (item.description || '')).toLowerCase();
            
            for (const { query, tags } of OSINT_QUERIES) {
                // Check for keywords within title or description
                const keywords = query.toLowerCase().replace(/"/g, '').split(' or ');
                if (keywords.some(k => text.includes(k.trim()))) {
                    tags.forEach(t => matchedTags.add(t));
                }
            }
            
            return {
                ...item,
                category: 'crisis',
                tags: Array.from(matchedTags),
            };
        });
    } catch (error) {
        console.error('osint gnews combined query failed:', error);
        return [];
    }
}
