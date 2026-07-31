/**
 * Social Media Feed Integration
 * 
 * Aggregates content from Telegram and X (Twitter) using a multi-strategy approach.
 * Implements fallback mechanisms to bypass platform restrictions and ensure high 
 * availability for OSINT data.
 */

import Parser from 'rss-parser';
import { fetchBoundedFeedText } from '@/lib/security/feedFetch';
import * as cheerio from 'cheerio';
import { NewsItem } from '@/lib/core/types';
import { SocialSource, TELEGRAM_CHANNELS, X_ACCOUNTS } from '@/data/sources';
import { ensureIsoDate } from '@/lib/utils/date';
import { selectDueSources, selectRecentFeedItems, socialPollTier } from './sourcePolling';
import { latestItemAt, recordSourceAttempt, safeSourceErrorCode } from './sourceHealth';
import { applyImageCandidate, extractFeedImageCandidate } from './imageCandidates';

const DEFAULT_TIMEOUT = 15000;
const X_MAX_ITEM_AGE_MS = 72 * 60 * 60 * 1000;
const X_MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;

const parser = new Parser({
    customFields: {
        item: ['media:content', 'media:thumbnail', 'enclosure'],
    },
    timeout: DEFAULT_TIMEOUT,
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    },
});
type XFeed = Awaited<ReturnType<typeof parser.parseURL>>;

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
    imageUrl?: string;
}

function telegramMediaUrl(
    $msg: { find: (selector: string) => { attr: (name: string) => string | undefined } },
    baseUrl: string,
) {
    const styleSelectors = [
        '.tgme_widget_message_photo_wrap',
        '.tgme_widget_message_video_thumb',
    ];
    for (const selector of styleSelectors) {
        const style = $msg.find(selector).attr('style') || '';
        const match = style.match(/background-image\s*:\s*url\(['"]?([^'")]+)['"]?\)/i);
        if (match?.[1]) {
            try {
                return new URL(match[1], baseUrl).toString();
            } catch {
                // Continue to other media shapes.
            }
        }
    }
    const poster = $msg.find('video[poster]').attr('poster');
    if (poster) {
        try {
            return new URL(poster, baseUrl).toString();
        } catch {
            return undefined;
        }
    }
    return undefined;
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

function cleanTelegramText(sourceName: string, text: string): string {
    if (sourceName !== 'Bellum Acta News (Telegram)') return text;
    return text.replace(/[➖━─-]{4,}[\s\S]{0,160}?rainbet\.com[\s\S]*$/i, '').trim();
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
    const startedAt = Date.now();
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
            recordSourceAttempt({ source_name: source.name, source_type: 'telegram', poll_tier: String(socialPollTier(source)), outcome: res.status === 429 ? 'rate_limited' : 'provider_error', fetched_count: 0, accepted_count: 0, rejected_count: 0, duration_ms: Date.now() - startedAt, error_code: `http_${res.status}` });
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

            const plainText = cleanTelegramText(source.name, $text.text().trim());
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
                imageUrl: telegramMediaUrl($msg, source.url),
            });
        });

        const recentPosts = selectRecentFeedItems(posts, (post) => post.date, {
            limit: 10,
            maxAgeMs: 72 * 60 * 60 * 1000,
        });
        const items = recentPosts.map((post, i) => ({
            id: `social-tg-${source.name.replace(/\s+/g, '-').toLowerCase()}-${i}-${Date.now()}`,
            title: safeSlice(post.text, 140) + (post.text.length > 140 ? '…' : ''),
            description: safeSlice(post.text, 500) + (post.links.length > 0 ? '\n\nLinks: ' + post.links.join(', ') : ''),
            url: post.url,
            source: source.name,
            sourceType: 'social' as const,
            category: source.category,
            publishedAt: ensureIsoDate(post.date),
            imageUrl: post.imageUrl,
            imageSourceUrl: post.imageUrl ? post.url : undefined,
            imageSourcePublishedAt: post.imageUrl ? ensureIsoDate(post.date) : undefined,
            imageOrigin: post.imageUrl ? 'telegram' : undefined,
            tags: ['OSINT', 'telegram'],
        }));
        recordSourceAttempt({ source_name: source.name, source_type: 'telegram', poll_tier: String(socialPollTier(source)), outcome: items.length ? 'healthy' : 'empty', fetched_count: posts.length, accepted_count: items.length, rejected_count: Math.max(0, posts.length - items.length), latest_usable_item_at: latestItemAt(items), duration_ms: Date.now() - startedAt, error_code: null });
        return items;
    } catch (error) {
        recordSourceAttempt({ source_name: source.name, source_type: 'telegram', poll_tier: String(socialPollTier(source)), outcome: 'provider_error', fetched_count: 0, accepted_count: 0, rejected_count: 0, duration_ms: Date.now() - startedAt, error_code: safeSourceErrorCode(error) });
        console.warn(`telegram scrape failed for ${source.name}:`, error instanceof Error ? error.message : error);
        return [];
    }
}

/**
 * Fetches feed with timeout and instance validation.
 * Includes a check for whitelist-only instances that block anonymous RSS readers.
 */
async function fetchInstanceTimeout(
    url: string,
    timeoutMs = DEFAULT_TIMEOUT,
    signal?: AbortSignal,
): Promise<ReturnType<typeof parser.parseURL>> {
    const text = await fetchBoundedFeedText(url, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
        timeoutMs,
        signal,
    });
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
                const mediaUrl =
                    t.mediaDetails?.find((media: { type?: string }) => media.type === 'photo')?.media_url_https ||
                    t.entities?.media?.[0]?.media_url_https ||
                    t.photos?.[0]?.url;
                items.push({
                    title: t.full_text || t.text || 'No title',
                    link: `https://x.com${t.permalink}`,
                    pubDate: new Date(t.created_at).toISOString(),
                    contentSnippet: t.full_text || t.text || '',
                    ...(mediaUrl ? { 'media:content': { $: { url: mediaUrl } } } : {}),
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
type InstanceDiscovery = { instance: string; username: string; feed: XFeed };
let nitterDiscovery: Promise<InstanceDiscovery | null> | null = null;
function feedHasRecentItems(feed: XFeed, now = Date.now()): boolean {
    return (feed.items ?? []).some((item) => {
        const value = item.pubDate || item.isoDate;
        const publishedMs = value ? new Date(value).getTime() : Number.NaN;
        return Number.isFinite(publishedMs) &&
            publishedMs >= now - X_MAX_ITEM_AGE_MS &&
            publishedMs <= now + X_MAX_FUTURE_SKEW_MS;
    });
}

async function tryNitterFeed(username: string): Promise<ReturnType<typeof parser.parseURL> | null> {
    try {
        if (bestNitterInstance) {
            const preferred = bestNitterInstance;
            try {
                const feed = await fetchInstanceTimeout(`${preferred}/${username}/rss`);
                if (!feedHasRecentItems(feed)) throw new Error('Stale Nitter feed');
                return feed;
            } catch {
                if (bestNitterInstance === preferred) bestNitterInstance = null;
            }
        }

        if (!nitterDiscovery) {
            const controller = new AbortController();
            nitterDiscovery = Promise.any(NITTER_INSTANCES.map(async (instance) => {
                const feed = await fetchInstanceTimeout(
                    `${instance}/${username}/rss`,
                    DEFAULT_TIMEOUT,
                    controller.signal,
                );
                if (!feedHasRecentItems(feed)) throw new Error('Stale Nitter feed');
                return { instance, username, feed };
            }))
                .then((result) => {
                    bestNitterInstance = result.instance;
                    controller.abort();
                    return result;
                })
                .catch(() => null)
                .finally(() => controller.abort());
        }
        const discovered = await nitterDiscovery;
        nitterDiscovery = null;
        if (!discovered) return null;
        if (discovered.username === username) return discovered.feed;
        const feed = await fetchInstanceTimeout(`${discovered.instance}/${username}/rss`);
        return feedHasRecentItems(feed) ? feed : null;
    } catch {
        return null;
    }
}

/**
 * Strategy 3: RSSHub
 * Similar to Nitter, utilizes community-hosted RSSHub instances as a secondary fallback.
 */
let bestRSSHubInstance: string | null = null;
let rssHubDiscovery: Promise<InstanceDiscovery | null> | null = null;
async function tryRSSHubFeed(username: string): Promise<ReturnType<typeof parser.parseURL> | null> {
    try {
        if (bestRSSHubInstance) {
            const preferred = bestRSSHubInstance;
            try {
                const feed = await fetchInstanceTimeout(`${preferred}/twitter/user/${username}`);
                if (!feedHasRecentItems(feed)) throw new Error('Stale RSSHub feed');
                return feed;
            } catch {
                if (bestRSSHubInstance === preferred) bestRSSHubInstance = null;
            }
        }

        if (!rssHubDiscovery) {
            const controller = new AbortController();
            rssHubDiscovery = Promise.any(RSSHUB_INSTANCES.map(async (instance) => {
                const feed = await fetchInstanceTimeout(
                    `${instance}/twitter/user/${username}`,
                    DEFAULT_TIMEOUT,
                    controller.signal,
                );
                if (!feedHasRecentItems(feed)) throw new Error('Stale RSSHub feed');
                return { instance, username, feed };
            }))
                .then((result) => {
                    bestRSSHubInstance = result.instance;
                    controller.abort();
                    return result;
                })
                .catch(() => null)
                .finally(() => controller.abort());
        }
        const discovered = await rssHubDiscovery;
        rssHubDiscovery = null;
        if (!discovered) return null;
        if (discovered.username === username) return discovered.feed;
        const feed = await fetchInstanceTimeout(`${discovered.instance}/twitter/user/${username}`);
        return feedHasRecentItems(feed) ? feed : null;
    } catch {
        return null;
    }
}

/** Normalizes candidate timelines and rejects stale or content-free posts. */
function meaningfulXText(value: unknown): string | null {
    const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
    if (text.length < 20) return null;
    if (/^(gif|image|video|photo)$/i.test(text)) return null;
    if (/^R to @[^:]+:\s*(?:read more|full (?:interview|story)|geolocation)?\s*(?:https?:\/\/\S+)?$/i.test(text)) return null;
    if (/^R to @[^:]+:\s*(?:related|sources?|thread|map|location|geolocation)?:?\s*(?:https?:\/\/\S+)?$/i.test(text)) return null;
    return text;
}

function normalizeXFeed(source: SocialSource, feed: XFeed, now = Date.now()): NewsItem[] {
    const seen = new Set<string>();
    const items: NewsItem[] = [];

    for (const item of feed.items ?? []) {
        const rawPublishedAt = item.pubDate || item.isoDate;
        const publishedMs = rawPublishedAt ? new Date(rawPublishedAt).getTime() : Number.NaN;
        if (!Number.isFinite(publishedMs)) continue;
        if (publishedMs < now - X_MAX_ITEM_AGE_MS || publishedMs > now + X_MAX_FUTURE_SKEW_MS) continue;
        const publishedAt = new Date(publishedMs).toISOString();

        const description = meaningfulXText(item.contentSnippet || item.content || item.title);
        const title = meaningfulXText(item.title || description);
        const url = typeof item.link === 'string' ? item.link : '';
        if (!title || !description || !url) continue;

        const statusId = url.match(/\/status\/(\d+)/)?.[1];
        const dedupeKey = statusId ?? url;
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);

        const newsItem: NewsItem = {
            id: `social-x-${source.name.replace(/\s+/g, '-').toLowerCase()}-${dedupeKey}-${Date.now()}`,
            title: safeSlice(title, 200),
            description: safeSlice(description, 1000),
            url,
            source: source.name,
            sourceType: 'social' as const,
            category: source.category,
            publishedAt,
            tags: ['OSINT', 'x'],
        };
        items.push(applyImageCandidate(newsItem, extractFeedImageCandidate(
            item as unknown as Record<string, unknown>,
            {
                articleUrl: url,
                sourcePublishedAt: publishedAt,
                sourceTier: source.credibility_tier,
                origin: 'x',
            },
        )));
    }

    return items.sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()).slice(0, 10);
}

function bestXCandidate(candidates: Array<{ strategy: string; items: NewsItem[] }>): { strategy: string; items: NewsItem[] } | null {
    return candidates.filter(({ items }) => items.length > 0).sort((a, b) => {
        const freshness = new Date(b.items[0].publishedAt).getTime() - new Date(a.items[0].publishedAt).getTime();
        return freshness || b.items.length - a.items.length;
    })[0] ?? null;
}

/**
 * Multi-strategy X/Twitter feed fetcher.
 * Compares credential-free direct account timelines by freshness. RSSHub is a
 * last resort. Google News is not an account timeline and is intentionally
 * excluded to prevent false/stale attribution.
 */
export async function fetchXFeed(source: SocialSource): Promise<NewsItem[]> {
    const startedAt = Date.now();
    const username = source.url;
    const [syndication, nitter] = await Promise.all([
        trySyndicationFeed(username),
        tryNitterFeed(username),
    ]);
    const directCandidate = bestXCandidate([
        { strategy: 'syndication', items: syndication ? normalizeXFeed(source, syndication) : [] },
        { strategy: 'nitter', items: nitter ? normalizeXFeed(source, nitter) : [] },
    ]);
    if (directCandidate) {
        recordSourceAttempt({ source_name: source.name, source_type: 'x', poll_tier: String(socialPollTier(source)), outcome: 'healthy', fetched_count: directCandidate.items.length, accepted_count: directCandidate.items.length, rejected_count: 0, latest_usable_item_at: latestItemAt(directCandidate.items), duration_ms: Date.now() - startedAt, error_code: null });
        console.log(`[X] ${source.name}: ${directCandidate.strategy} (${directCandidate.items.length} fresh items)`);
        return directCandidate.items;
    }

    const rssHub = await tryRSSHubFeed(username);
    const fallbackItems = rssHub ? normalizeXFeed(source, rssHub) : [];
    if (fallbackItems.length === 0) {
        recordSourceAttempt({ source_name: source.name, source_type: 'x', poll_tier: String(socialPollTier(source)), outcome: 'provider_error', fetched_count: 0, accepted_count: 0, rejected_count: 0, duration_ms: Date.now() - startedAt, error_code: 'all_strategies_failed' });
        console.warn(`all X feed strategies failed for ${source.name} (@${username})`);
        return [];
    }
    recordSourceAttempt({ source_name: source.name, source_type: 'x', poll_tier: String(socialPollTier(source)), outcome: 'healthy', fetched_count: fallbackItems.length, accepted_count: fallbackItems.length, rejected_count: 0, latest_usable_item_at: latestItemAt(fallbackItems), duration_ms: Date.now() - startedAt, error_code: null });
    console.log(`[X] ${source.name}: rsshub (${fallbackItems.length} fresh items)`);
    return fallbackItems;
}

/**
 * Orchestrates social media feed ingestion from all configured channels.
 */
export async function fetchSocialFeeds(now = Date.now()): Promise<NewsItem[]> {
    const dueTelegram = selectDueSources(TELEGRAM_CHANNELS, socialPollTier, now);
    const dueX = selectDueSources(X_ACCOUNTS, socialPollTier, now);
    console.log(`[polling] Social: ${dueTelegram.length}/${TELEGRAM_CHANNELS.length} Telegram and ${dueX.length}/${X_ACCOUNTS.length} X sources due`);
    const telegramPromises = dueTelegram.map(source => scrapeTelegramChannel(source));
    const xPromises = dueX.map(source => fetchXFeed(source));

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
