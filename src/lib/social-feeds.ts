import Parser from 'rss-parser';
import * as cheerio from 'cheerio';
import { NewsItem } from './types';

const parser = new Parser({
    customFields: {
        item: ['media:content', 'media:thumbnail', 'enclosure'],
    },
    timeout: 3000,
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    },
});

// ── Source definitions ──────────────────────────────────────────────────────

interface SocialSource {
    name: string;
    url: string;
    platform: 'telegram' | 'x';
    category: string;
}

// Nitter instances to try — user reports these worked previously
const NITTER_INSTANCES = [
    'https://nitter.privacydev.net',
    'https://nitter.poast.org',
    'https://nitter.net',
    'https://xcancel.com',
    'https://nitter.cz',
];

// RSSHub instances as secondary fallback
const RSSHUB_INSTANCES = [
    'https://rsshub.app',
    'https://rsshub.rssforever.com',
    'https://rsshub.moeyy.cn',
];

const TELEGRAM_CHANNELS: SocialSource[] = [
    { name: 'Faytuks (Telegram)', url: 'https://t.me/s/Faytuks', platform: 'telegram', category: 'world' },
    { name: 'LiveUkraine (Telegram)', url: 'https://t.me/s/liveukraine_media', platform: 'telegram', category: 'crisis' },
    { name: 'Astra Press (Telegram)', url: 'https://t.me/s/astrapress', platform: 'telegram', category: 'world' },
];

const X_ACCOUNTS: SocialSource[] = [
    { name: 'GeoConfirmed (X)', url: 'GeoConfirmed', platform: 'x', category: 'crisis' },
    { name: 'OSINTtechnical (X)', url: 'OSINTtechnical', platform: 'x', category: 'crisis' },
    { name: 'Liveuamap (X)', url: 'Liveuamap', platform: 'x', category: 'crisis' },
    { name: 'The Intel Crab (X)', url: 'IntelCrab', platform: 'x', category: 'crisis' },
    { name: 'Aurora Intel (X)', url: 'AuroraIntel', platform: 'x', category: 'crisis' },
];

// ── Telegram scraper (Cheerio-based) ────────────────────────────────────────

interface TelegramPost {
    text: string;
    date: string;
    url: string;
    links: string[];
}

async function scrapeTelegramChannel(source: SocialSource): Promise<NewsItem[]> {
    try {
        const res = await fetch(source.url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html',
                'Accept-Language': 'en-US,en;q=0.9',
            },
            signal: AbortSignal.timeout(10000),
        });

        if (!res.ok) {
            console.warn(`telegram ${source.name}: HTTP ${res.status}`);
            return [];
        }

        const html = await res.text();
        const $ = cheerio.load(html);
        const posts: TelegramPost[] = [];

        // Each message is a .tgme_widget_message element
        $('.tgme_widget_message').each((_i, el) => {
            const $msg = $(el);
            const postId = $msg.attr('data-post') || '';

            // Extract text, preserving links
            const $text = $msg.find('.tgme_widget_message_text');
            if (!$text.length) return;

            // Get plain text for display
            const plainText = $text.text().trim();
            if (!plainText || plainText.length < 10) return;

            // Extract href links from the message (critical for OSINT sources)
            const links: string[] = [];
            $text.find('a[href]').each((_j, linkEl) => {
                const href = $(linkEl).attr('href');
                if (href && !href.startsWith('tg://')) links.push(href);
            });

            // Get datetime
            const $time = $msg.find('time[datetime]');
            const datetime = $time.attr('datetime') || new Date().toISOString();

            posts.push({
                text: plainText.slice(0, 500),
                date: datetime,
                url: postId ? `https://t.me/${postId}` : source.url,
                links,
            });
        });

        return posts.slice(0, 10).map((post, i) => ({
            id: `social-tg-${source.name.replace(/\s+/g, '-').toLowerCase()}-${i}-${Date.now()}`,
            title: post.text.slice(0, 140) + (post.text.length > 140 ? '…' : ''),
            description: post.text + (post.links.length > 0 ? '\n\nLinks: ' + post.links.join(', ') : ''),
            url: post.url,
            source: source.name,
            sourceType: 'social' as const,
            category: source.category,
            publishedAt: post.date,
            tags: ['OSINT', 'telegram'],
        }));
    } catch (error) {
        console.warn(`telegram scrape failed for ${source.name}:`, error instanceof Error ? error.message : error);
        return [];
    }
}

// ── X/Twitter RSS — multi-strategy fallback ─────────────────────────────────

// Fetch wrapper that races a parser call against a strict timeout
async function fetchInstanceTimeout(url: string, timeoutMs = 3000): Promise<ReturnType<typeof parser.parseURL>> {
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
    return feed;
}

// Strategy 1: Nitter RSS (Query all known healthy instances at once and take the first success)
async function tryNitterFeed(username: string): Promise<ReturnType<typeof parser.parseURL> | null> {
    try {
        const promises = NITTER_INSTANCES.map(instance =>
            fetchInstanceTimeout(`${instance}/${username}/rss`)
        );
        return await Promise.any(promises);
    } catch {
        return null; // All promises rejected
    }
}

// Strategy 2: RSSHub RSS (Concurrent query across all instances)
async function tryRSSHubFeed(username: string): Promise<ReturnType<typeof parser.parseURL> | null> {
    try {
        const promises = RSSHUB_INSTANCES.map(instance =>
            fetchInstanceTimeout(`${instance}/twitter/user/${username}`)
        );
        return await Promise.any(promises);
    } catch {
        return null; 
    }
}

// Strategy 3: Google News RSS as last resort
async function tryGoogleNewsFeed(username: string): Promise<ReturnType<typeof parser.parseURL> | null> {
    try {
        const url = `https://news.google.com/rss/search?q=${encodeURIComponent(`@${username} OR from:${username}`)}&hl=en`;
        return await fetchInstanceTimeout(url);
    } catch {
        return null;
    }
}

async function fetchXFeed(source: SocialSource): Promise<NewsItem[]> {
    const username = source.url; // just the username

    // try strategies in order, but each strategy races its internal mirrors concurrently
    const feed = await tryNitterFeed(username)
        || await tryRSSHubFeed(username)
        || await tryGoogleNewsFeed(username);

    if (!feed || !feed.items || feed.items.length === 0) {
        console.warn(`all X feed strategies failed for ${source.name} (@${username})`);
        return [];
    }

    return (feed.items || []).slice(0, 10).map((item, index) => ({
        id: `social-x-${source.name.replace(/\s+/g, '-').toLowerCase()}-${index}-${Date.now()}`,
        title: (item.title || item.contentSnippet || 'No title').slice(0, 200),
        description: item.contentSnippet || item.content || '',
        url: item.link || '',
        source: source.name,
        sourceType: 'social' as const,
        category: source.category,
        publishedAt: item.pubDate || item.isoDate || new Date().toISOString(),
        tags: ['OSINT', 'x'],
    }));
}

// ── Main entry point ────────────────────────────────────────────────────────

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
