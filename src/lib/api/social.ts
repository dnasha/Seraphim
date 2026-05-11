/**
 * Social Media Feed Integration
 * 
 * Aggregates content from Telegram and X (Twitter) using a multi-strategy approach.
 * Implements fallback mechanisms to bypass platform restrictions and ensure high 
 * availability for OSINT data.
 */

import Parser from 'rss-parser';
import * as cheerio from 'cheerio';
import { NewsItem } from '@/lib/core/types';
import { SocialSource, TELEGRAM_CHANNELS, X_ACCOUNTS } from '@/data/sources';
import { ensureIsoDate } from '@/lib/utils/date';

const DEFAULT_TIMEOUT = 15000;

const parser = new Parser({
    customFields: {
        item: ['media:content', 'media:thumbnail', 'enclosure'],
    },
    timeout: DEFAULT_TIMEOUT,
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    },
});

/**
 * Verified Nitter instances for X/Twitter fallback.
 */
const NITTER_INSTANCES = [
    'https://nitter.privacydev.net',
    'https://nitter.poast.org',
    'https://nitter.net',
    'https://xcancel.com',
    'https://nitter.cz',
];

/**
 * RSSHub instances as secondary fallback for structured social data.
 */
const RSSHUB_INSTANCES = [
    'https://rsshub.app',
    'https://rsshub.rssforever.com',
    'https://rsshub.moeyy.cn',
];

interface TelegramPost {
    text: string;
    date: string;
    url: string;
    links: string[];
}

/**
 * Safe string slicing that respects multi-byte characters and prevents 
 * character fragmentation.
 */
function safeSlice(str: string, limit: number): string {
    if (!str) return '';
    const chars = Array.from(str);
    if (chars.length <= limit) return str;
    return chars.slice(0, limit).join('');
}

/**
 * Scrapes Telegram channels by parsing the static HTML preview page.
 * Relies on Cheerio for DOM traversal. This method avoids the need for 
 * Telegram API credentials and is highly resilient to bot detection.
 */
export async function scrapeTelegramChannel(
    source: SocialSource, 
    timeoutMs: number = DEFAULT_TIMEOUT
): Promise<NewsItem[]> {
    try {
        const res = await fetch(source.url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html',
                'Accept-Language': 'en-US,en;q=0.9',
            },
            signal: AbortSignal.timeout(timeoutMs),
        });

        if (!res.ok) {
            console.warn(`telegram ${source.name}: HTTP ${res.status}`);
            return [];
        }

        const html = await res.text();
        const $ = cheerio.load(html);
        const posts: TelegramPost[] = [];

        // Traverse the Telegram widget message container
        $('.tgme_widget_message').each((_i, el) => {
            const $msg = $(el);
            const postId = $msg.attr('data-post') || '';

            const $text = $msg.find('.tgme_widget_message_text');
            if (!$text.length) return;

            const plainText = $text.text().trim();
            if (!plainText || plainText.length < 10) return;

            const links: string[] = [];
            $text.find('a[href]').each((_j, linkEl) => {
                const href = $(linkEl).attr('href');
                if (href && !href.startsWith('tg://')) links.push(href);
            });

            const $time = $msg.find('time[datetime]');
            const datetime = $time.attr('datetime') || new Date().toISOString();

            posts.push({
                text: plainText.slice(0, 500),
                date: datetime,
                url: postId ? `https://t.me/${postId}` : source.url,
                links,
            });
        });

        return posts.slice(0, 20).map((post, i) => ({
            id: `social-tg-${source.name.replace(/\s+/g, '-').toLowerCase()}-${i}-${Date.now()}`,
            title: safeSlice(post.text, 140) + (post.text.length > 140 ? '…' : ''),
            description: safeSlice(post.text, 500) + (post.links.length > 0 ? '\n\nLinks: ' + post.links.join(', ') : ''),
            url: post.url,
            source: source.name,
            sourceType: 'social' as const,
            category: source.category,
            publishedAt: ensureIsoDate(post.date),
            tags: ['OSINT', 'telegram'],
        }));
    } catch (error) {
        console.warn(`telegram scrape failed for ${source.name}:`, error instanceof Error ? error.message : error);
        return [];
    }
}

/**
 * Fetches feed with timeout and instance validation.
 * Includes a check for whitelist-only instances that block anonymous RSS readers.
 */
async function fetchInstanceTimeout(url: string, timeoutMs = DEFAULT_TIMEOUT): Promise<ReturnType<typeof parser.parseURL>> {
    const res = await fetch(url, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
        signal: AbortSignal.timeout(timeoutMs)
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const feed = await parser.parseString(text) as any;

    if (!feed.items || feed.items.length === 0) {
        throw new Error('Empty feed');
    }

    if (feed.items[0]?.title?.includes('RSS reader not yet whitelist') || feed.items[0]?.contentSnippet?.includes('RSS reader not yet whitelist')) {
        throw new Error('Nitter instance blocked RSS reader');
    }

    return feed;
}

/**
 * Strategy 1: Native Twitter Syndication
 * Attempts to extract JSON data from the official Twitter syndication script tag.
 */
async function trySyndicationFeed(username: string): Promise<ReturnType<typeof parser.parseURL> | null> {
    try {
        const res = await fetch(`https://syndication.twitter.com/srv/timeline-profile/screen-name/${username}`, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
            signal: AbortSignal.timeout(10000)
        });
        if (!res.ok) return null;
        const html = await res.text();
        const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([^<]+)<\/script>/);
        if (!match) return null;

        const data = JSON.parse(match[1]);
        const entries = data?.props?.pageProps?.timeline?.entries || [];

        const items = [];
        for (const entry of entries) {
            if (entry.type === 'tweet') {
                const t = entry.content.tweet;
                if (!t) continue;
                items.push({
                    title: t.full_text || t.text || 'No title',
                    link: `https://x.com${t.permalink}`,
                    pubDate: new Date(t.created_at).toISOString(),
                    contentSnippet: t.full_text || t.text || '',
                });
            }
        }

        if (items.length === 0) return null;
        items.sort((a, b) => new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime());
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return { items: items.slice(0, 20) } as any;
    } catch {
        return null;
    }
}

/**
 * Strategy 2: Nitter RSS
 * Cycles through a list of Nitter instances to find an available and unblocked feed.
 * Remembers the 'best' instance to optimize subsequent requests.
 */
let bestNitterInstance: string | null = null;
async function tryNitterFeed(username: string): Promise<ReturnType<typeof parser.parseURL> | null> {
    try {
        if (bestNitterInstance) {
            try {
                return await fetchInstanceTimeout(`${bestNitterInstance}/${username}/rss`);
            } catch {
                bestNitterInstance = null;
            }
        }

        const promises = NITTER_INSTANCES.map(async (instance) => {
            const res = await fetchInstanceTimeout(`${instance}/${username}/rss`);
            bestNitterInstance = instance;
            return res;
        });
        return await Promise.any(promises);
    } catch {
        return null;
    }
}

/**
 * Strategy 3: RSSHub
 * Similar to Nitter, utilizes community-hosted RSSHub instances as a secondary fallback.
 */
let bestRSSHubInstance: string | null = null;
async function tryRSSHubFeed(username: string): Promise<ReturnType<typeof parser.parseURL> | null> {
    try {
        if (bestRSSHubInstance) {
            try {
                return await fetchInstanceTimeout(`${bestRSSHubInstance}/twitter/user/${username}`);
            } catch {
                bestRSSHubInstance = null;
            }
        }

        const promises = RSSHUB_INSTANCES.map(async (instance) => {
            const res = await fetchInstanceTimeout(`${instance}/twitter/user/${username}`);
            bestRSSHubInstance = instance;
            return res;
        });
        return await Promise.any(promises);
    } catch {
        return null;
    }
}

/**
 * Strategy 4: Google News RSS
 * Final resort using Google News' indexed view of specific social accounts.
 */
async function tryGoogleNewsFeed(username: string): Promise<ReturnType<typeof parser.parseURL> | null> {
    try {
        const url = `https://news.google.com/rss/search?q=${encodeURIComponent(`@${username} OR from:${username}`)}&hl=en`;
        return await fetchInstanceTimeout(url);
    } catch {
        return null;
    }
}

/**
 * Multi-strategy X/Twitter feed fetcher.
 * Executes multiple discovery strategies in parallel and returns the fastest 
 * successful response.
 */
export async function fetchXFeed(source: SocialSource): Promise<NewsItem[]> {
    const username = source.url;
    const feed = await Promise.any([
        trySyndicationFeed(username).then(res => res ? res : Promise.reject('syndication failed')),
        tryNitterFeed(username).then(res => res ? res : Promise.reject('nitter failed')),
        tryRSSHubFeed(username).then(res => res ? res : Promise.reject('rsshub failed')),
        tryGoogleNewsFeed(username).then(res => res ? res : Promise.reject('gnews failed'))
    ]).catch(() => null);

    if (!feed || !feed.items || feed.items.length === 0) {
        console.warn(`all X feed strategies failed for ${source.name} (@${username})`);
        return [];
    }

    return (feed.items || []).slice(0, 20).map((item, index) => ({
        id: `social-x-${source.name.replace(/\s+/g, '-').toLowerCase()}-${index}-${Date.now()}`,
        title: safeSlice(item.title || item.contentSnippet || 'No title', 200),
        description: safeSlice(item.contentSnippet || item.content || '', 1000),
        url: item.link || '',
        source: source.name,
        sourceType: 'social' as const,
        category: source.category,
        publishedAt: ensureIsoDate(item.pubDate || item.isoDate),
        tags: ['OSINT', 'x'],
    }));
}

/**
 * Orchestrates social media feed ingestion from all configured channels.
 */
export async function fetchSocialFeeds(): Promise<NewsItem[]> {
    const telegramPromises = TELEGRAM_CHANNELS.map(source => scrapeTelegramChannel(source));
    const xPromises = X_ACCOUNTS.map(source => fetchXFeed(source));

    const results = await Promise.allSettled([...telegramPromises, ...xPromises]);

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
