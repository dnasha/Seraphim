/**
 * RSS Feed Integration
 * 
 * Provides unified fetching and parsing for standard news RSS feeds and Reddit subreddits.
 * Supports both Next.js frontend and background ingestion workers.
 */

import Parser from 'rss-parser';
import { Agent } from 'undici';
import { NewsItem } from '@/lib/core/types';
import { RSSSource, RedditSource, RSS_SOURCES, REDDIT_SOURCES } from '@/data/sources';
import { ensureIsoDate } from '@/lib/utils/date';

const DEFAULT_TIMEOUT = 15000;
const RSS_CONCURRENCY = 16;
const REDDIT_CONCURRENCY = 3;
const rssDispatcher = new Agent({ connect: { rejectUnauthorized: false } });

async function mapWithConcurrency<T, R>(
    items: readonly T[],
    concurrency: number,
    worker: (item: T) => Promise<R>,
): Promise<R[]> {
    const results = new Array<R>(items.length);
    let nextIndex = 0;
    const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
        while (true) {
            const index = nextIndex++;
            if (index >= items.length) return;
            results[index] = await worker(items[index]);
        }
    });
    await Promise.all(runners);
    return results;
}

/**
 * Headers optimized for standard news feeds to minimize bot detection.
 */
const RSS_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Accept': 'application/rss+xml, application/xml, text/xml, */*',
    'Accept-Language': 'en-US,en;q=0.9',
};

const parser = new Parser({
    timeout: DEFAULT_TIMEOUT,
    headers: {
        'User-Agent': 'Seraphim/1.0 (news aggregator)',
        'Accept': 'application/rss+xml, application/xml, text/xml',
    },
    customFields: {
        item: ['media:content', 'media:thumbnail', 'enclosure'],
    },
});

/**
 * Extracts the first available image URL from varied feed formats.
 * Checks MediaRSS fields (media:content, media:thumbnail) and standard enclosures.
 * This ensures compatibility across different CMS implementations.
 */
function extractImageUrl(item: Record<string, unknown>): string | undefined {
    if (item['media:content'] && typeof item['media:content'] === 'object') {
        const media = item['media:content'] as Record<string, unknown>;
        if (media.$ && typeof media.$ === 'object' && 'url' in (media.$ as object)) {
            return (media.$ as { url: string }).url;
        }
    }

    if (item['media:thumbnail'] && typeof item['media:thumbnail'] === 'object') {
        const thumb = item['media:thumbnail'] as Record<string, unknown>;
        if (thumb.$ && typeof thumb.$ === 'object' && 'url' in (thumb.$ as object)) {
            return (thumb.$ as { url: string }).url;
        }
    }

    if (item.enclosure && typeof item.enclosure === 'object') {
        const enc = item.enclosure as Record<string, unknown>;
        if (enc.url && typeof enc.url === 'string') return enc.url;
    }

    return undefined;
}

/**
 * Fetches and parses a single standard RSS feed.
 * Utilizes an undici Agent with rejected unauthorized certs to support legacy 
 * news sources with misconfigured or expired SSL certificates.
 */
export async function fetchSingleFeed(
    source: RSSSource, 
    timeoutMs: number = DEFAULT_TIMEOUT
): Promise<NewsItem[]> {
    try {
        const res = await fetch(source.url, {
            headers: RSS_HEADERS,
            signal: AbortSignal.timeout(timeoutMs),
            // @ts-expect-error - dispatcher is not in standard fetch types but works in Node's undici
            dispatcher: rssDispatcher
        });

        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        
        const text = (await res.text()).trim();
        if (!text.startsWith('<')) {
            throw new Error(`Invalid XML response (starts with "${text.slice(0, 20)}...")`);
        }

        const feed = await parser.parseString(text);

        // Map feed items to internal NewsItem format. IDs are generated using a 
        // combination of source name, index, and timestamp to ensure uniqueness 
        // during high-frequency ingestion.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (feed.items || []).slice(0, 20).map((item: any, index: number) => ({
            id: `rss-${source.name.replace(/\s+/g, '-').toLowerCase()}-${index}-${Date.now()}`,
            title: item.title || 'No title',
            description: item.contentSnippet || item.content || '',
            url: item.link || '',
            source: source.name,
            sourceType: 'rss' as const,
            category: source.category,
            publishedAt: ensureIsoDate(item.pubDate || item.isoDate),
            imageUrl: extractImageUrl(item as unknown as Record<string, unknown>),
        }));
    } catch (error) {
        if (error instanceof Error && error.message.includes('timeout')) {
            console.warn(`[RSS] Feed timeout for ${source.name} (${timeoutMs}ms)`);
        } else {
            console.error(`[RSS] fetch failed for ${source.name}:`, error instanceof Error ? error.message : error);
        }
        return [];
    }
}

/**
 * Fetches and parses a Reddit subreddit RSS feed.
 * Targeted at OSINT subreddits where standard API access may be restricted.
 */
export async function fetchRedditFeed(
    source: RedditSource, 
    timeoutMs: number = DEFAULT_TIMEOUT
): Promise<NewsItem[]> {
    try {
        const url = `https://www.reddit.com/r/${source.subreddit}/.rss`;
        const res = await fetch(url, {
            headers: {
                'User-Agent': 'Seraphim/1.0 (news aggregator)',
                'Accept': 'application/rss+xml, application/xml, text/xml',
            },
            signal: AbortSignal.timeout(timeoutMs),
        });
        
        if (!res.ok) throw new Error(`Status code ${res.status}`);

        const text = await res.text();
        const feed = await parser.parseString(text);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (feed.items || []).slice(0, 10).map((item: any, index: number) => ({
            id: `reddit-${source.subreddit.toLowerCase()}-${index}-${Date.now()}`,
            title: item.title || 'No title',
            description: item.contentSnippet || item.content || '',
            url: item.link || `https://www.reddit.com/r/${source.subreddit}`,
            source: source.name,
            sourceType: 'social' as const,
            category: source.category,
            publishedAt: ensureIsoDate(item.pubDate || item.isoDate),
            imageUrl: extractImageUrl(item as unknown as Record<string, unknown>),
        }));
    } catch (error) {
        console.error(`reddit fetch failed for ${source.name}:`, error instanceof Error ? error.message : error);
        return [];
    }
}

/**
 * Fetches all configured RSS feeds concurrently and returns them sorted by date.
 */
export async function fetchAllRSSFeeds(): Promise<NewsItem[]> {
    const rssResults = await mapWithConcurrency(RSS_SOURCES, RSS_CONCURRENCY, fetchSingleFeed);
    const allItems = rssResults.flat();

    return allItems.sort((a, b) =>
        new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
    );
}

/**
 * Fetches all configured Reddit feeds concurrently.
 */
export async function fetchAllRedditFeeds(): Promise<NewsItem[]> {
    const results = await mapWithConcurrency(REDDIT_SOURCES, REDDIT_CONCURRENCY, fetchRedditFeed);
    return results.flat();
}

/**
 * Fetches RSS feeds for a specific category with date sorting.
 */
export async function fetchRSSByCategory(category: string): Promise<NewsItem[]> {
    const sources = RSS_SOURCES.filter(s => s.category === category);

    const results = await mapWithConcurrency(sources, RSS_CONCURRENCY, fetchSingleFeed);
    const allItems = results.flat();

    return allItems.sort((a, b) =>
        new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
    );
}
