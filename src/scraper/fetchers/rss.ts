/*
RSS feed integration for the scraper worker.
Supports standard RSS feeds and Reddit RSS endpoints, providing 
robust parsing and image extraction capabilities.
*/

import Parser from 'rss-parser';
import { NewsItem } from '@/lib/types';
import { RSSSource, RedditSource, RSS_SOURCES, REDDIT_SOURCES } from '@/data/sources';
import { ensureIsoDate } from '../utils/date';

// Headers optimized for standard RSS feeds to bypass bot detection
const RSS_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Accept': 'application/rss+xml, application/xml, text/xml, */*',
    'Accept-Language': 'en-US,en;q=0.9',
};

// Headers optimized for Reddit RSS (conservative to avoid breaking their strict filtering)
const REDDIT_HEADERS = {
    'User-Agent': 'Seraphim/1.0 (news aggregator)',
    'Accept': 'application/rss+xml, application/xml, text/xml',
};

const FEED_TIMEOUT_MS = 15000;

// Global parser with robust browser-like headers
const parser = new Parser({
    timeout: 15000,
    headers: RSS_HEADERS,
    customFields: {
        item: ['media:content', 'media:thumbnail', 'enclosure'],
    },
});

/* Fetches and parses a Reddit subreddit RSS feed */
export async function fetchRedditFeed(source: RedditSource): Promise<NewsItem[]> {
    try {
        const url = `https://www.reddit.com/r/${source.subreddit}/.rss`;
        const res = await fetch(url, {
            headers: REDDIT_HEADERS,
            signal: AbortSignal.timeout(15000),
        });
        
        if (!res.ok) throw new Error(`Status code ${res.status}`);

        const text = await res.text();
        const feed = await parser.parseString(text);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (feed.items || []).slice(0, 25).map((item: any, index: number) => ({
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

/* Fetches all configured Reddit feeds concurrently */
export async function fetchAllRedditFeeds(): Promise<NewsItem[]> {
    // Concurrent fetch with Promise.allSettled to handle individual failures gracefully
    const results = await Promise.allSettled(
        REDDIT_SOURCES.map(source => fetchRedditFeed(source))
    );
    const items: NewsItem[] = [];
    for (const result of results) {
        if (result.status === 'fulfilled') items.push(...result.value);
    }
    return items;
}

/*
Extracts the first available image URL from various standard RSS media fields
including MediaRSS content, thumbnails, and enclosures.
*/
function extractImageUrl(item: Record<string, unknown>): string | undefined {
    // Check MediaRSS content tags
    if (item['media:content'] && typeof item['media:content'] === 'object') {
        const media = item['media:content'] as Record<string, unknown>;
        if (media.$ && typeof media.$ === 'object' && 'url' in (media.$ as object)) {
            return (media.$ as { url: string }).url;
        }
    }

    // Check MediaRSS thumbnail tags
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

// (Moved constants up for visibility)

/* Fetches and parses a single standard RSS feed */
export async function fetchSingleFeed(source: RSSSource): Promise<NewsItem[]> {
    try {
        const res = await fetch(source.url, {
            headers: RSS_HEADERS,
            signal: AbortSignal.timeout(FEED_TIMEOUT_MS)
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = (await res.text()).trim();
        if (!text.startsWith('<')) {
            throw new Error(`Invalid XML response (starts with "${text.slice(0, 20)}...")`);
        }
        const feed = await parser.parseString(text);

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
            console.warn(`[RSS] Feed timeout for ${source.name} (${FEED_TIMEOUT_MS}ms)`);
        } else {
            console.error(`[RSS] fetch failed for ${source.name}:`, error instanceof Error ? error.message : error);
        }
        return [];
    }
}

/* Fetches all configured RSS feeds concurrently */
export async function fetchAllRSSFeeds(): Promise<NewsItem[]> {
    const rssResults = await Promise.allSettled(RSS_SOURCES.map(source => fetchSingleFeed(source)));

    const allItems: NewsItem[] = [];
    for (const result of rssResults) {
        if (result.status === 'fulfilled') {
            allItems.push(...result.value);
        }
    }

    return allItems.sort((a, b) =>
        new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
    );
}
