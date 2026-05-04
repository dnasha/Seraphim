/*
RSS feed integration for news sources and Reddit subreddits.
Provides concurrent fetching and parsing of feeds with robust
image extraction and SSL tolerance for legacy sources.
*/

import Parser from 'rss-parser';
import { Agent } from 'undici';
import { NewsItem } from './types';

const parser = new Parser({
    timeout: 5000,
    headers: {
        'User-Agent': 'Seraphim/1.0 (news aggregator)',
        'Accept': 'application/rss+xml, application/xml, text/xml',
    },
    customFields: {
        item: ['media:content', 'media:thumbnail', 'enclosure'],
    },
});

import { RSSSource, RedditSource, RSS_SOURCES, REDDIT_SOURCES } from '@/data/sources';

/* Fetches and parses a Reddit subreddit RSS feed */
export async function fetchRedditFeed(source: RedditSource): Promise<NewsItem[]> {
    try {
        const url = `https://www.reddit.com/r/${source.subreddit}/.rss`;
        const res = await fetch(url, {
            headers: {
                'User-Agent': 'Seraphim/1.0 (news aggregator)',
                'Accept': 'application/rss+xml, application/xml, text/xml',
            },
            signal: AbortSignal.timeout(5000),
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
            publishedAt: item.pubDate || item.isoDate || new Date().toISOString(),
            imageUrl: extractImageUrl(item as unknown as Record<string, unknown>),
        }));
    } catch (error) {
        console.error(`reddit fetch failed for ${source.name}:`, error);
        return [];
    }
}

/* Fetches all configured Reddit feeds concurrently */
export async function fetchAllRedditFeeds(): Promise<NewsItem[]> {
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
Extracts the first available image URL from various common RSS/MediaRSS fields
including content, thumbnails, and enclosures.
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

const FEED_TIMEOUT_MS = 2500;

/*
Fetches and parses a single standard RSS feed.
Uses a custom dispatcher to allow insecure connections for legacy news sources.
*/
export async function fetchSingleFeed(source: RSSSource): Promise<NewsItem[]> {
    try {
        const res = await fetch(source.url, {
            headers: {
                'User-Agent': 'Seraphim/1.0 (news aggregator)',
                'Accept': 'application/rss+xml, application/xml, text/xml',
            },
            signal: AbortSignal.timeout(FEED_TIMEOUT_MS),
            // @ts-expect-error - dispatcher is not in standard fetch types but works in Node's undici
            dispatcher: new Agent({ connect: { rejectUnauthorized: false } })
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        const feed = await parser.parseString(text);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (feed.items || []).slice(0, 5).map((item: any, index: number) => ({
            id: `rss-${source.name.replace(/\s+/g, '-').toLowerCase()}-${index}-${Date.now()}`,
            title: item.title || 'No title',
            description: item.contentSnippet || item.content || '',
            url: item.link || '',
            source: source.name,
            sourceType: 'rss' as const,
            category: source.category,
            publishedAt: item.pubDate || item.isoDate || new Date().toISOString(),
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

/* Fetches RSS feeds for a specific category */
export async function fetchRSSByCategory(category: string): Promise<NewsItem[]> {
    const sources = RSS_SOURCES.filter(s => s.category === category);

    const results = await Promise.allSettled(
        sources.map(source => fetchSingleFeed(source))
    );

    const allItems: NewsItem[] = [];
    for (const result of results) {
        if (result.status === 'fulfilled') {
            allItems.push(...result.value);
        }
    }

    return allItems.sort((a, b) =>
        new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
    );
}

