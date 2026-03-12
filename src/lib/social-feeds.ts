import Parser from 'rss-parser';
import * as cheerio from 'cheerio';
import { NewsItem } from './types';

/*
Dan Sharan

social feeds integration
*/

const parser = new Parser({
    customFields: {
        item: ['media:content', 'media:thumbnail', 'enclosure'],
    },
    timeout: 3000,
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    },
});

// Source definitions

interface SocialSource {
    name: string;
    url: string;
    platform: 'telegram' | 'x';
    category: string;
}

// nitter instances to try — user reports these worked previously
const NITTER_INSTANCES = [
    'https://nitter.privacydev.net',
    'https://nitter.poast.org',
    'https://nitter.net',
    'https://xcancel.com',
    'https://nitter.cz',
];

// rSSHub instances as secondary fallback
const RSSHUB_INSTANCES = [
    'https://rsshub.app',
    'https://rsshub.rssforever.com',
    'https://rsshub.moeyy.cn',
];

export const TELEGRAM_CHANNELS: SocialSource[] = [
    { name: 'LiveUkraine (Telegram)', url: 'https://t.me/s/liveukraine_media', platform: 'telegram', category: 'crisis' },
    { name: 'bloomberg (Telegram)', url: 'https://t.me/s/bloomberg', platform: 'telegram', category: 'business' },
];

export const X_ACCOUNTS: SocialSource[] = [
    { name: 'GeoConfirmed (X)', url: 'GeoConfirmed', platform: 'x', category: 'crisis' },
    { name: 'OSINTtechnical (X)', url: 'OSINTtechnical', platform: 'x', category: 'crisis' },
    { name: 'Liveuamap (X)', url: 'Liveuamap', platform: 'x', category: 'crisis' },
    { name: 'The Intel Crab (X)', url: 'IntelCrab', platform: 'x', category: 'crisis' },
    { name: 'Aurora Intel (X)', url: 'AuroraIntel', platform: 'x', category: 'crisis' },
    { name: 'ELINT News (X)', url: 'ELINTNews', platform: 'x', category: 'crisis' },
    { name: 'Def Mon (X)', url: 'DefMon3', platform: 'x', category: 'crisis' },
    { name: 'Rob Lee (X)', url: 'RALee85', platform: 'x', category: 'crisis' },
    { name: 'Clash Report (X)', url: 'clashreport', platform: 'x', category: 'crisis' },
    { name: 'Oliver Alexander (X)', url: 'OAlexanderDK', platform: 'x', category: 'crisis' },
    { name: 'Michael Kofman (X)', url: 'KofmanMichael', platform: 'x', category: 'crisis' },
    //{ name: 'Jakub Janovsky / Oryx (X)', url: 'Rebel44CZ', platform: 'x', category: 'crisis' }
];

// Telegram scraper (Cheerio-based)

interface TelegramPost {
    text: string;
    date: string;
    url: string;
    links: string[];
}

export async function scrapeTelegramChannel(source: SocialSource): Promise<NewsItem[]> {
    try {
        const res = await fetch(source.url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html',
                'Accept-Language': 'en-US,en;q=0.9',
            },
            signal: AbortSignal.timeout(5000), // reduced from 10s
        });

        if (!res.ok) {
            console.warn(`telegram ${source.name}: HTTP ${res.status}`);
            return [];
        }

        const html = await res.text();
        const $ = cheerio.load(html);
        const posts: TelegramPost[] = [];

        // each message is a .tgme_widget_message element
        $('.tgme_widget_message').each((_i, el) => {
            const $msg = $(el);
            const postId = $msg.attr('data-post') || '';

            // extract text, preserving links
            const $text = $msg.find('.tgme_widget_message_text');
            if (!$text.length) return;

            // get plain text for display
            const plainText = $text.text().trim();
            if (!plainText || plainText.length < 10) return;

            // extract href links from the message (critical for OSINT sources)
            const links: string[] = [];
            $text.find('a[href]').each((_j, linkEl) => {
                const href = $(linkEl).attr('href');
                if (href && !href.startsWith('tg://')) links.push(href);
            });

            // get datetime
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

// fetch wrapper that races a parser call against a strict timeout
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

    // reject fake successful feeds from xcancel that are actually whitelist errors
    if (feed.items[0]?.title?.includes('RSS reader not yet whitelist') || feed.items[0]?.contentSnippet?.includes('RSS reader not yet whitelist')) {
        throw new Error('Nitter instance blocked RSS reader');
    }

    return feed;
}

// strategy 1: Native Twitter Syndication (Fastest, clearest, no API key needed)
async function trySyndicationFeed(username: string): Promise<ReturnType<typeof parser.parseURL> | null> {
    try {
        const res = await fetch(`https://syndication.twitter.com/srv/timeline-profile/screen-name/${username}`, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            },
            signal: AbortSignal.timeout(5000)
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

        // sort by newest first, then take top 10
        items.sort((a, b) => new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime());
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return { items: items.slice(0, 10) } as any;
    } catch {
        return null; // fallback on error
    }
}

// strategy 2: Nitter RSS (Query all known healthy instances at once and take the first success)
// using a cached "best instance" once found to speed up subsequent requests in a batch.
let bestNitterInstance: string | null = null;
async function tryNitterFeed(username: string): Promise<ReturnType<typeof parser.parseURL> | null> {
    try {
        if (bestNitterInstance) {
            try {
                return await fetchInstanceTimeout(`${bestNitterInstance}/${username}/rss`);
            } catch {
                bestNitterInstance = null; // reset on failure
            }
        }
        
        const promises = NITTER_INSTANCES.map(async (instance) => {
            const res = await fetchInstanceTimeout(`${instance}/${username}/rss`);
            bestNitterInstance = instance; // keep the winner
            return res;
        });
        return await Promise.any(promises);
    } catch {
        return null; // all promises rejected
    }
}

// strategy 3: RSSHub RSS (Concurrent query across all instances)
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

// strategy 3: Google News RSS as last resort
async function tryGoogleNewsFeed(username: string): Promise<ReturnType<typeof parser.parseURL> | null> {
    try {
        const url = `https://news.google.com/rss/search?q=${encodeURIComponent(`@${username} OR from:${username}`)}&hl=en`;
        return await fetchInstanceTimeout(url);
    } catch {
        return null;
    }
}

export async function fetchXFeed(source: SocialSource): Promise<NewsItem[]> {
    const username = source.url; // just the username
    // try strategies concurrently to avoid massive sequential timeout penalties
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
