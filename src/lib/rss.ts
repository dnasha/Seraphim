import Parser from 'rss-parser';
import { NewsItem } from './types';

const parser = new Parser({
    headers: {
        'User-Agent': 'Seraphim/1.0 (news aggregator)',
        'Accept': 'application/rss+xml, application/xml, text/xml',
    },
    customFields: {
        item: ['media:content', 'media:thumbnail', 'enclosure'],
    },
});

export interface RSSSource {
    name: string;
    url: string;
    category: string;
    region?: string;
}

// curated high-signal feeds — world news, crisis, national, business, tech, science, health
export const RSS_SOURCES: RSSSource[] = [
    // world news
    { name: 'BBC World', url: 'https://feeds.bbci.co.uk/news/rss.xml', category: 'world', region: 'global' },
    { name: 'Al Jazeera', url: 'https://www.aljazeera.com/xml/rss/all.xml', category: 'world', region: 'global' },
    { name: 'NYT World', url: 'https://rss.nytimes.com/services/xml/rss/nyt/World.xml', category: 'world', region: 'global' },
    { name: 'DW News', url: 'https://rss.dw.com/rdf/rss-en-eu', category: 'world', region: 'europe' },
    { name: 'France 24', url: 'https://www.france24.com/en/europe/rss', category: 'world', region: 'europe' },
    { name: 'SCMP', url: 'https://www.scmp.com/rss/91/feed', category: 'world', region: 'asia' },
    { name: 'BBC Africa', url: 'http://feeds.bbci.co.uk/news/world/africa/rss.xml', category: 'world', region: 'africa' },
    { name: 'BBC Middle East', url: 'http://feeds.bbci.co.uk/news/world/middle_east/rss.xml', category: 'world', region: 'middle_east' },

    // regional gap-fillers (Indo-Pacific, Middle East, Latin America)
    { name: 'CNA Asia', url: 'https://www.channelnewsasia.com/api/v1/rss-outbound-feed?_format=xml&category=6511', category: 'world', region: 'asia' },
    { name: 'Times of Israel', url: 'https://www.timesofisrael.com/feed/', category: 'world', region: 'middle_east' },
    { name: 'Al Arabiya English', url: 'https://news.google.com/rss/search?q=site:english.alarabiya.net&hl=en', category: 'world', region: 'middle_east' },
    { name: 'MercoPress LatAm', url: 'https://en.mercopress.com/rss/', category: 'world', region: 'latin_america' },

    // crisis and humanitarian
    { name: 'USGS Earthquakes', url: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/significant_month.atom', category: 'crisis', region: 'global' },
    { name: 'ReliefWeb', url: 'https://reliefweb.int/updates/rss.xml', category: 'crisis', region: 'global' },

    // geopolitical think tanks
    { name: 'War on the Rocks', url: 'https://warontherocks.com/feed/', category: 'world', region: 'global' },
    { name: 'ISW Daily Updates', url: 'https://news.google.com/rss/search?q=site:understandingwar.org&hl=en', category: 'crisis', region: 'global' },

    // OSINT / investigative
    { name: 'Bellingcat', url: 'https://www.bellingcat.com/feed/', category: 'world', region: 'global' },

    // national / domestic
    { name: 'NPR US', url: 'https://feeds.npr.org/1003/rss.xml', category: 'nation', region: 'north_america' },
    { name: 'CBC Canada', url: 'https://www.cbc.ca/cmlink/rss-topstories', category: 'nation', region: 'north_america' },

    // business
    { name: 'CNBC', url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114', category: 'business', region: 'global' },
    { name: 'MarketWatch', url: 'https://feeds.marketwatch.com/marketwatch/topstories/', category: 'business', region: 'global' },

    // technology + cyber intelligence
    { name: 'Ars Technica', url: 'https://feeds.arstechnica.com/arstechnica/index', category: 'technology', region: 'global' },
    { name: 'The Verge', url: 'https://www.theverge.com/rss/index.xml', category: 'technology', region: 'global' },
    { name: 'BleepingComputer', url: 'https://www.bleepingcomputer.com/feed/', category: 'technology', region: 'global' },
    { name: 'The Hacker News', url: 'https://feeds.feedburner.com/TheHackersNews', category: 'technology', region: 'global' },

    // science
    { name: 'NASA', url: 'https://www.nasa.gov/news-release/feed/', category: 'science', region: 'global' },
    { name: 'Nature', url: 'https://www.nature.com/nature.rss', category: 'science', region: 'global' },

    // health
    { name: 'WHO News', url: 'https://www.who.int/rss-feeds/news-english.xml', category: 'health', region: 'global' },
];

// ── Reddit JSON API (RSS endpoints return 403) ─────────────────────────────

interface RedditSource {
    name: string;
    subreddit: string;
    category: string;
    region: string;
}

const REDDIT_SOURCES: RedditSource[] = [
    { name: 'Reddit CombatFootage', subreddit: 'CombatFootage', category: 'crisis', region: 'global' },
    { name: 'Reddit CredibleDefense', subreddit: 'CredibleDefense', category: 'crisis', region: 'global' },
];

async function fetchRedditFeed(source: RedditSource): Promise<NewsItem[]> {
    try {
        const url = `https://www.reddit.com/r/${source.subreddit}/new.json?limit=5`;
        const res = await fetch(url, {
            headers: { 'User-Agent': 'Seraphim/1.0 (news aggregator)' },
        });
        if (!res.ok) throw new Error(`Status code ${res.status}`);
        const data = await res.json();
        const posts = data?.data?.children || [];

        return posts.map((child: { data: Record<string, string> }, index: number) => {
            const post = child.data;
            return {
                id: `reddit-${source.subreddit.toLowerCase()}-${index}-${Date.now()}`,
                title: post.title || 'No title',
                description: post.selftext || '',
                url: `https://www.reddit.com${post.permalink}`,
                source: source.name,
                sourceType: 'rss' as const,
                category: source.category,
                publishedAt: new Date((Number(post.created_utc) || 0) * 1000).toISOString(),
                imageUrl: post.thumbnail && post.thumbnail !== 'self' && post.thumbnail !== 'default'
                    ? post.thumbnail : undefined,
            };
        });
    } catch (error) {
        console.error(`reddit fetch failed for ${source.name}:`, error);
        return [];
    }
}

async function fetchAllRedditFeeds(): Promise<NewsItem[]> {
    const results = await Promise.allSettled(
        REDDIT_SOURCES.map(source => fetchRedditFeed(source))
    );
    const items: NewsItem[] = [];
    for (const result of results) {
        if (result.status === 'fulfilled') items.push(...result.value);
    }
    return items;
}

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

const FEED_TIMEOUT_MS = 15_000; // 15-second per-feed timeout

async function fetchSingleFeed(source: RSSSource): Promise<NewsItem[]> {
    try {
        // Race the parse against a timeout so one slow feed can't stall the whole response
        const feed = await Promise.race([
            parser.parseURL(source.url),
            new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error(`Feed timeout after ${FEED_TIMEOUT_MS}ms`)), FEED_TIMEOUT_MS)
            ),
        ]);

        return (feed.items || []).slice(0, 5).map((item, index) => ({
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
        console.error(`rss fetch failed for ${source.name}:`, error);
        return [];
    }
}

export async function fetchAllRSSFeeds(): Promise<NewsItem[]> {
    const [rssResults, redditItems] = await Promise.all([
        Promise.allSettled(RSS_SOURCES.map(source => fetchSingleFeed(source))),
        fetchAllRedditFeeds(),
    ]);

    const allItems: NewsItem[] = [...redditItems];
    for (const result of rssResults) {
        if (result.status === 'fulfilled') {
            allItems.push(...result.value);
        }
    }

    return allItems.sort((a, b) =>
        new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
    );
}

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
