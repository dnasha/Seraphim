/**
 * GNews API Integration
 * 
 * Provides functions for fetching top headlines and performing targeted keyword searches.
 * Implements specialized OSINT discovery logic using advanced search operators.
 */

import { NewsItem } from '@/lib/core/types';
import { latestItemAt, recordSourceAttempt, safeSourceErrorCode } from './sourceHealth';

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
 * Fetches top headlines from GNews filtered by category.
 */
export async function fetchGNews(
    category: string = 'general',
    maxResults: number = 10,
    timeoutMs: number = DEFAULT_TIMEOUT
): Promise<NewsItem[]> {
    const startedAt = Date.now();
    if (!GNEWS_API_KEY) {
        recordSourceAttempt({ source_name: `GNews headlines:${category}`, source_type: 'gnews', poll_tier: null, outcome: 'disabled', fetched_count: 0, accepted_count: 0, rejected_count: 0, duration_ms: 0, error_code: 'missing_api_key' });
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
            recordSourceAttempt({ source_name: `GNews headlines:${category}`, source_type: 'gnews', poll_tier: null, outcome: 'rate_limited', fetched_count: 0, accepted_count: 0, rejected_count: 0, duration_ms: Date.now() - startedAt, error_code: `http_${res.status}` });
            const reason = res.status === 403 ? 'daily quota reached' : 'rate-limited';
            console.warn(`gnews: ${reason} (${res.status}), skipping headlines`);
            return [];
        }
        if (!res.ok) throw new Error(`gnews responded ${res.status}`);

        const data: GNewsResponse = await res.json();

        const items = data.articles.map((article, i) => ({
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
        recordSourceAttempt({ source_name: `GNews headlines:${category}`, source_type: 'gnews', poll_tier: null, outcome: items.length ? 'healthy' : 'empty', fetched_count: data.articles.length, accepted_count: items.length, rejected_count: 0, latest_usable_item_at: latestItemAt(items), duration_ms: Date.now() - startedAt, error_code: null });
        return items;
    } catch (error) {
        recordSourceAttempt({ source_name: `GNews headlines:${category}`, source_type: 'gnews', poll_tier: null, outcome: 'provider_error', fetched_count: 0, accepted_count: 0, rejected_count: 0, duration_ms: Date.now() - startedAt, error_code: safeSourceErrorCode(error) });
        console.error('gnews fetch error:', error);
        return [];
    }
}

/**
 * Executes a text-based search against the GNews index.
 */
export async function searchGNews(
    query: string, 
    maxResults: number = 10,
    timeoutMs: number = DEFAULT_TIMEOUT
): Promise<NewsItem[]> {
    const startedAt = Date.now();
    const sourceName = query === HEALTH_EVENT_QUERY ? 'GNews health events' : 'GNews search';
    if (!GNEWS_API_KEY) {
        recordSourceAttempt({ source_name: sourceName, source_type: 'gnews', poll_tier: null, outcome: 'disabled', fetched_count: 0, accepted_count: 0, rejected_count: 0, duration_ms: 0, error_code: 'missing_api_key' });
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
            recordSourceAttempt({ source_name: sourceName, source_type: 'gnews', poll_tier: null, outcome: 'rate_limited', fetched_count: 0, accepted_count: 0, rejected_count: 0, duration_ms: Date.now() - startedAt, error_code: `http_${res.status}` });
            const reason = res.status === 403 ? 'daily quota reached' : 'rate-limited';
            console.warn(`gnews: ${reason} (${res.status}), skipping search`);
            return [];
        }
        if (!res.ok) throw new Error(`gnews search responded ${res.status}`);

        const data: GNewsResponse = await res.json();

        const items = data.articles.map((article, i) => ({
            id: `gnews-search-${i}-${Date.now()}`,
            title: article.title,
            description: article.description || '',
            url: article.url,
            source: article.source.name,
            sourceType: 'gnews' as const,
            publishedAt: article.publishedAt,
            imageUrl: article.image,
        }));
        recordSourceAttempt({ source_name: sourceName, source_type: 'gnews', poll_tier: null, outcome: items.length ? 'healthy' : 'empty', fetched_count: data.articles.length, accepted_count: items.length, rejected_count: 0, latest_usable_item_at: latestItemAt(items), duration_ms: Date.now() - startedAt, error_code: null });
        return items;
    } catch (error) {
        recordSourceAttempt({ source_name: sourceName, source_type: 'gnews', poll_tier: null, outcome: 'provider_error', fetched_count: 0, accepted_count: 0, rejected_count: 0, duration_ms: Date.now() - startedAt, error_code: safeSourceErrorCode(error) });
        console.error('gnews search error:', error);
        return [];
    }
}

/**
 * Targeted OSINT search queries.
 */
const OSINT_QUERIES: { query: string; tags: string[] }[] = [
    { query: '"geolocated" OR "satellite imagery"', tags: ['OSINT', 'imagery'] },
    { query: '"confirmed strike" OR "explosion reported"', tags: ['OSINT', 'strike'] },
    { query: '"troop deployment" OR "military convoy"', tags: ['OSINT', 'military'] },
    { query: '"cyber attack" OR "critical infrastructure"', tags: ['OSINT', 'cyber'] },
];

/**
 * Specialized OSINT content discovery.
 * Aggregates multiple high-signal queries into a single API call to optimize quota 
 * consumption. Results are then post-processed to assign granular tags based 
 * on keyword matches within the returned text.
 */
export async function fetchOSINTGNews(
    maxResults: number = 20,
    timeoutMs: number = DEFAULT_TIMEOUT
): Promise<NewsItem[]> {
    if (!GNEWS_API_KEY) return [];

    // Combine distinct OSINT queries with OR operators to minimize billing events
    const combinedQuery = OSINT_QUERIES.map(q => q.query).join(' OR ');
    
    try {
        const items = await searchGNews(combinedQuery, maxResults, timeoutMs);
        
        return items.map(item => {
            const matchedTags = new Set<string>(['OSINT']);
            const text = (item.title + ' ' + (item.description || '')).toLowerCase();
            
            // Re-apply tag logic locally since GNews does not return source query mapping
            for (const { query, tags } of OSINT_QUERIES) {
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

const HEALTH_EVENT_QUERY = [
    '"public health emergency"',
    '"disease outbreak"',
    '"outbreak reported"',
    '"epidemic declared"',
    '"mass poisoning"',
    '"hospital evacuation"',
].join(' OR ');

/**
 * Fills Seraphim's weakest category without reintroducing a broad headline
 * firehose. The query is deliberately about place-bound health occurrences,
 * not wellness, medicine reviews, or general health advice.
 */
export async function fetchHealthEventGNews(
    maxResults: number = 20,
    timeoutMs: number = DEFAULT_TIMEOUT,
): Promise<NewsItem[]> {
    const items = await searchGNews(HEALTH_EVENT_QUERY, maxResults, timeoutMs);
    return items.map((item) => ({
        ...item,
        category: 'health',
        tags: ['health-event'],
    }));
}
