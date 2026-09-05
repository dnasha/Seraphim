/**
 * RSS Feed Integration
 * 
 * Provides unified fetching and parsing for standard news RSS feeds and Reddit subreddits.
 * Supports both Next.js frontend and background ingestion workers.
 */

import Parser from 'rss-parser';
import { NewsItem } from '@/lib/core/types';
import { RSSSource, RedditSource, RSS_SOURCES, REDDIT_SOURCES } from '@/data/sources';
import { ensureIsoDate } from '@/lib/utils/date';
import {
    expandedItemLimit,
    itemLimitForTier,
    rssPollTier,
    selectDueSources,
    selectRecentFeedItems,
    TIER_MAX_AGE_MS,
} from './sourcePolling';
import { latestItemAt, recordSourceAttempt, safeSourceErrorCode } from './sourceHealth';
import { applyImageCandidate, extractFeedImageCandidate } from './imageCandidates';
import {
    fetchBoundedFeed,
    type FeedValidator,
} from '@/lib/security/feedFetch';
import { scheduleOutboundSource, sourceHost } from './outboundScheduler';
import { isSourceCircuitOpen } from './sourceCircuit';

const DEFAULT_TIMEOUT = 15000;
const RSS_CONCURRENCY = 10;
const REDDIT_CONCURRENCY = 1;
let redditRetryAt = 0;

interface ParsedFeedItem {
    title?: string;
    contentSnippet?: string;
    content?: string;
    link?: string;
    pubDate?: string;
    isoDate?: string;
}

export interface RSSFetchOptions {
    validators?: ReadonlyMap<string, FeedValidator>;
    onValidator?: (sourceUrl: string, validator: FeedValidator) => void;
    emergency?: boolean;
    openCircuits?: ReadonlySet<string>;
}

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
    'User-Agent': process.env.FEED_USER_AGENT || 'server:seraphim:v1.0 (feed reader; contact: https://github.com/dnasha/Seraphim)',
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
 * Fetches and parses a single standard RSS feed.
 * Fetches through the shared bounded, TLS-verified public-resource transport.
 */
export async function fetchSingleFeed(
    source: RSSSource,
    timeoutMs: number = DEFAULT_TIMEOUT,
    options: RSSFetchOptions = {},
): Promise<NewsItem[]> {
    const startedAt = Date.now();
    const tier = rssPollTier(source);
    const urls = [source.url, ...(source.fallbackUrls ?? [])];
    let lastError: unknown;
    let primaryErrorCode: string | null = null;

    for (let urlIndex = 0; urlIndex < urls.length; urlIndex++) {
      const sourceUrl = urls[urlIndex];
      try {
        const fetched = await fetchBoundedFeed(sourceUrl, {
          headers: RSS_HEADERS,
          timeoutMs,
          validator: options.validators?.get(sourceUrl),
          maxAttempts: 2,
        });
        if (fetched.notModified) {
          const watermark = options.validators?.get(sourceUrl)?.latestItemAt ?? null;
          const knownFresh = watermark && Number.isFinite(Date.parse(watermark))
            && startedAt - Date.parse(watermark) <= TIER_MAX_AGE_MS[tier];
          recordSourceAttempt({
            source_name: source.name, source_type: 'rss', poll_tier: String(tier),
            outcome: knownFresh ? 'healthy' : watermark ? 'stale' : 'empty',
            fetched_count: 0, accepted_count: 0, rejected_count: 0,
            latest_usable_item_at: watermark,
            duration_ms: Date.now() - startedAt, error_code: watermark ? null : 'freshness_unknown',
          });
          return [];
        }
        const feed = await parser.parseString(fetched.text!);

        // Map feed items to internal NewsItem format. IDs are generated using a 
        // combination of source name, index, and timestamp to ensure uniqueness 
        // during high-frequency ingestion.
        const feedItems = (feed.items || []) as ParsedFeedItem[];
        const recentItems = selectRecentFeedItems(feedItems, (item) => item.pubDate || item.isoDate, {
            tier,
            limit: itemLimitForTier(tier, options.emergency),
        });
        const items = recentItems.map((item, index) => {
            const articleUrl = item.link || '';
            const publishedAt = ensureIsoDate(item.pubDate || item.isoDate);
            const newsItem: NewsItem = {
                id: `rss-${source.name.replace(/\s+/g, '-').toLowerCase()}-${index}-${Date.now()}`,
                title: item.title || 'No title',
                description: item.contentSnippet || item.content || '',
                url: articleUrl,
                source: source.name,
                sourceType: 'rss',
                category: source.category,
                publishedAt,
            };
            return applyImageCandidate(newsItem, extractFeedImageCandidate(
                item as unknown as Record<string, unknown>,
                {
                    articleUrl,
                    sourcePublishedAt: publishedAt,
                    sourceTier: source.credibility_tier,
                },
            ));
        });
        recordSourceAttempt({
            source_name: source.name, source_type: 'rss', poll_tier: String(tier),
            outcome: items.length ? 'healthy' : 'empty', fetched_count: feedItems.length,
            accepted_count: items.length, rejected_count: Math.max(0, feedItems.length - items.length),
            latest_usable_item_at: latestItemAt(items), duration_ms: Date.now() - startedAt,
            error_code: urlIndex > 0 && primaryErrorCode ? `fallback_${primaryErrorCode}`.slice(0, 64) : null,
        });
        if (urlIndex > 0) {
          console.log(`[RSS] ${source.name}: fallback feed responded (${items.length} recent item(s))`);
        }
        // Stage validators only after the whole feed has parsed successfully.
        // The ingestion coordinator commits them after durable processing.
        options.onValidator?.(sourceUrl, {
          etag: fetched.etag ?? null,
          lastModified: fetched.lastModified ?? null,
          latestItemAt: latestItemAt(items) ?? options.validators?.get(sourceUrl)?.latestItemAt ?? null,
        });
        return items;
      } catch (error) {
        lastError = error;
        const errorCode = safeSourceErrorCode(error);
        if (urlIndex === 0) primaryErrorCode = errorCode;
        if (urlIndex + 1 < urls.length) {
          console.warn(`[RSS] ${source.name}: primary failed (${errorCode}); trying configured fallback`);
        }
      }
    }

    const errorCode = safeSourceErrorCode(lastError);
    recordSourceAttempt({
      source_name: source.name, source_type: 'rss', poll_tier: String(tier),
      outcome: errorCode === 'parse' || errorCode === 'invalid_xml' ? 'parse_error' : 'provider_error', fetched_count: 0,
      accepted_count: 0, rejected_count: 0, duration_ms: Date.now() - startedAt, error_code: errorCode,
    });
    console.error(`[RSS] fetch failed for ${source.name} (${errorCode}):`, lastError instanceof Error ? lastError.message : lastError);
    return [];
}

/**
 * Fetches and parses a Reddit subreddit RSS feed.
 * Targeted at OSINT subreddits where standard API access may be restricted.
 */
export async function fetchRedditFeed(
    source: RedditSource, 
    timeoutMs: number = DEFAULT_TIMEOUT,
    emergency = false,
): Promise<NewsItem[]> {
    const startedAt = Date.now();
    if (startedAt < redditRetryAt) {
        recordSourceAttempt({ source_name: source.name, source_type: 'reddit', poll_tier: 'normal',
            outcome: 'rate_limited', fetched_count: 0, accepted_count: 0, rejected_count: 0,
            duration_ms: 0, error_code: 'host_retry_after' });
        return [];
    }
    try {
        const url = `https://www.reddit.com/r/${source.subreddit}/new/.rss?limit=25`;
        const fetched = await fetchBoundedFeed(url, {
            headers: {
                'User-Agent': process.env.FEED_USER_AGENT || 'server:seraphim:v1.0 (feed reader; contact: https://github.com/dnasha/Seraphim)',
                'Accept': 'application/atom+xml, application/rss+xml, application/xml, text/xml',
            },
            timeoutMs,
            maxAttempts: 1,
        });
        const feed = await parser.parseString(fetched.text!);

        const feedItems = (feed.items || []) as ParsedFeedItem[];
        const recentItems = selectRecentFeedItems(feedItems, (item) => item.pubDate || item.isoDate, {
            limit: expandedItemLimit(5, emergency),
            maxAgeMs: 48 * 60 * 60 * 1000,
        });
        const items = recentItems.map((item, index) => {
            const articleUrl = item.link || `https://www.reddit.com/r/${source.subreddit}`;
            const publishedAt = ensureIsoDate(item.pubDate || item.isoDate);
            const newsItem: NewsItem = {
                id: `reddit-${source.subreddit.toLowerCase()}-${index}-${Date.now()}`,
                title: item.title || 'No title',
                description: item.contentSnippet || item.content || '',
                url: articleUrl,
                source: source.name,
                sourceType: 'social',
                category: source.category,
                publishedAt,
            };
            return applyImageCandidate(newsItem, extractFeedImageCandidate(
                item as unknown as Record<string, unknown>,
                {
                    articleUrl,
                    sourcePublishedAt: publishedAt,
                    sourceTier: source.credibility_tier,
                    origin: 'feed',
                },
            ));
        });
        recordSourceAttempt({
            source_name: source.name, source_type: 'reddit', poll_tier: null,
            outcome: items.length ? 'healthy' : 'empty', fetched_count: feedItems.length,
            accepted_count: items.length, rejected_count: Math.max(0, feedItems.length - items.length),
            latest_usable_item_at: latestItemAt(items), duration_ms: Date.now() - startedAt, error_code: null,
        });
        return items;
    } catch (error) {
        const errorCode = safeSourceErrorCode(error);
        if (errorCode === 'http_429') {
            const retryAfterMs = error && typeof error === 'object' && 'retryAfterMs' in error ? Number(error.retryAfterMs) : 0;
            redditRetryAt = Date.now() + Math.max(15 * 60_000, Number.isFinite(retryAfterMs) ? retryAfterMs : 0);
        }
        recordSourceAttempt({
            source_name: source.name, source_type: 'reddit', poll_tier: null,
            outcome: errorCode === 'http_429' ? 'rate_limited' : 'provider_error', fetched_count: 0, accepted_count: 0, rejected_count: 0,
            duration_ms: Date.now() - startedAt, error_code: errorCode,
        });
        console.error(`reddit fetch failed for ${source.name} (${errorCode}):`, error instanceof Error ? error.message : error);
        return [];
    }
}

/**
 * Fetches all configured RSS feeds concurrently and returns them sorted by date.
 */
export async function fetchAllRSSFeeds(
    now = Date.now(),
    options: RSSFetchOptions = {},
): Promise<NewsItem[]> {
    const scheduledSources = selectDueSources(RSS_SOURCES, rssPollTier, now, options.emergency);
    const dueSources = scheduledSources.filter((source) =>
      !isSourceCircuitOpen(options.openCircuits, 'rss', source.name)
    );
    const suppressed = scheduledSources.length - dueSources.length;
    console.log(`[polling] RSS: ${dueSources.length}/${RSS_SOURCES.length} sources due${suppressed ? ` (${suppressed} circuit-open)` : ''}`);
    const rssResults = await mapWithConcurrency(
        dueSources,
        RSS_CONCURRENCY,
        (source) => scheduleOutboundSource(
          sourceHost(source.url, `rss:${source.name}`),
          () => fetchSingleFeed(source, DEFAULT_TIMEOUT, options),
        ),
    );
    const allItems = rssResults.flat();

    return allItems.sort((a, b) =>
        new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
    );
}

/**
 * Fetches all configured Reddit feeds concurrently.
 */
export async function fetchAllRedditFeeds(
    now = Date.now(),
    emergency = false,
    openCircuits?: ReadonlySet<string>,
): Promise<NewsItem[]> {
    const scheduledSources = selectDueSources(REDDIT_SOURCES, () => 'normal', now, emergency);
    const dueSources = scheduledSources.filter((source) =>
      !isSourceCircuitOpen(openCircuits, 'reddit', source.name)
    );
    const suppressed = scheduledSources.length - dueSources.length;
    console.log(`[polling] Reddit: ${dueSources.length}/${REDDIT_SOURCES.length} sources due${suppressed ? ` (${suppressed} circuit-open)` : ''}`);
    const results = await mapWithConcurrency(
        dueSources,
        REDDIT_CONCURRENCY,
        (source) => scheduleOutboundSource(
          'www.reddit.com',
          () => fetchRedditFeed(source, DEFAULT_TIMEOUT, emergency),
        ),
    );
    return results.flat();
}

/**
 * Fetches RSS feeds for a specific category with date sorting.
 */
export async function fetchRSSByCategory(category: string): Promise<NewsItem[]> {
    const sources = RSS_SOURCES.filter(s => s.category === category);

    const results = await mapWithConcurrency(sources, RSS_CONCURRENCY, (source) =>
      scheduleOutboundSource(sourceHost(source.url, `rss:${source.name}`), () => fetchSingleFeed(source))
    );
    const allItems = results.flat();

    return allItems.sort((a, b) =>
        new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
    );
}
