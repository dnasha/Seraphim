/*
  Data sources configuration for news aggregation.
  Contains definitions for RSS feeds, Reddit subreddits, Telegram channels, and X accounts.
*/

export interface RSSSource {
    name: string;
    url: string;
    category: string;
    credibility_tier: 1 | 2 | 3;
    region?: string;
}

export interface RedditSource {
    name: string;
    subreddit: string;
    category: string;
    credibility_tier: 1 | 2 | 3;
    region: string;
}

// curated feeds for world news, crisis, national, business, tech, science, health
export const RSS_SOURCES: RSSSource[] = [
    // world news
    { name: 'BBC World', url: 'https://feeds.bbci.co.uk/news/rss.xml', category: 'world', credibility_tier: 1, region: 'global' },
    { name: 'Al Jazeera', url: 'https://www.aljazeera.com/xml/rss/all.xml', category: 'world', credibility_tier: 1, region: 'global' },
    { name: 'NYT World', url: 'https://rss.nytimes.com/services/xml/rss/nyt/World.xml', category: 'world', credibility_tier: 1, region: 'global' },
    { name: 'DW News', url: 'https://rss.dw.com/rdf/rss-en-eu', category: 'world', credibility_tier: 1, region: 'europe' },
    { name: 'France 24', url: 'https://www.france24.com/en/europe/rss', category: 'world', credibility_tier: 1, region: 'europe' },
    { name: 'SCMP', url: 'https://www.scmp.com/rss/91/feed', category: 'world', credibility_tier: 1, region: 'asia' },
    { name: 'BBC Africa', url: 'http://feeds.bbci.co.uk/news/world/africa/rss.xml', category: 'world', credibility_tier: 1, region: 'africa' },
    { name: 'BBC Middle East', url: 'http://feeds.bbci.co.uk/news/world/middle_east/rss.xml', category: 'world', credibility_tier: 1, region: 'middle_east' },

    // regional gap-fillers (Indo-Pacific, Middle East, Latin America)
    { name: 'CNA Asia', url: 'https://www.channelnewsasia.com/api/v1/rss-outbound-feed?_format=xml&category=6511', category: 'world', credibility_tier: 1, region: 'asia' },
    { name: 'Times of Israel', url: 'https://www.timesofisrael.com/feed/', category: 'world', credibility_tier: 2, region: 'middle_east' },
    { name: 'Al Arabiya English', url: 'https://news.google.com/rss/search?q=site:english.alarabiya.net&hl=en', category: 'world', credibility_tier: 1, region: 'middle_east' },
    { name: 'MercoPress LatAm', url: 'https://en.mercopress.com/rss/', category: 'world', credibility_tier: 2, region: 'latin_america' },

    // crisis and humanitarian
    { name: 'USGS Earthquakes', url: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/significant_month.atom', category: 'crisis', credibility_tier: 1, region: 'global' },
    // { name: 'ReliefWeb', url: 'https://reliefweb.int/updates/rss.xml', category: 'crisis', region: 'global' },

    // geopolitical think tanks
    { name: 'War on the Rocks', url: 'https://warontherocks.com/feed/', category: 'world', credibility_tier: 2, region: 'global' },
    { name: 'ISW Daily Updates', url: 'https://news.google.com/rss/search?q=site:understandingwar.org&hl=en', category: 'crisis', credibility_tier: 2, region: 'global' },
    { name: 'Foreign Affairs', url: 'https://foreignaffairs.com/rss.xml', category: 'world', credibility_tier: 1, region: 'global' },
    { name: 'CFR', url: 'https://news.google.com/rss/search?q=site:cfr.org&hl=en', category: 'world', credibility_tier: 2, region: 'global' },
    { name: 'Chatham House', url: 'https://news.google.com/rss/search?q=site:chathamhouse.org&hl=en', category: 'world', credibility_tier: 2, region: 'global' },
    { name: 'ECFR', url: 'https://ecfr.eu/feed/', category: 'world', credibility_tier: 2, region: 'europe' },
    { name: 'ICG CrisisWatch', url: 'https://www.crisisgroup.org/rss', category: 'crisis', credibility_tier: 2, region: 'global' },
    { name: 'The Diplomat', url: 'https://thediplomat.com/feed', category: 'world', credibility_tier: 2, region: 'asia' },
    { name: 'Geopolitical Futures', url: 'https://geopoliticalfutures.com/feed', category: 'world', credibility_tier: 2, region: 'global' },

    // oSINT / investigative
    { name: 'Bellingcat', url: 'https://www.bellingcat.com/feed/', category: 'world', credibility_tier: 2, region: 'global' },

    // national / domestic
    { name: 'NPR US', url: 'https://feeds.npr.org/1003/rss.xml', category: 'nation', credibility_tier: 1, region: 'north_america' },

    // business
    { name: 'CNBC', url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114', category: 'business', credibility_tier: 1, region: 'global' },
    { name: 'MarketWatch', url: 'https://feeds.marketwatch.com/marketwatch/topstories/', category: 'business', credibility_tier: 1, region: 'global' },

    // technology + cyber intelligence
    { name: 'Ars Technica', url: 'https://feeds.arstechnica.com/arstechnica/index', category: 'technology', credibility_tier: 1, region: 'global' },
    { name: 'The Verge', url: 'https://www.theverge.com/rss/index.xml', category: 'technology', credibility_tier: 1, region: 'global' },
    { name: 'BleepingComputer', url: 'https://www.bleepingcomputer.com/feed/', category: 'technology', credibility_tier: 1, region: 'global' },
    { name: 'The Hacker News', url: 'https://feeds.feedburner.com/TheHackersNews', category: 'technology', credibility_tier: 1, region: 'global' },

    // science
    { name: 'NASA', url: 'https://www.nasa.gov/news-release/feed/', category: 'science', credibility_tier: 1, region: 'global' },
    { name: 'Nature', url: 'https://www.nature.com/nature.rss', category: 'science', credibility_tier: 1, region: 'global' },

    // health
    { name: 'WHO News', url: 'https://www.who.int/rss-feeds/news-english.xml', category: 'health', credibility_tier: 1, region: 'global' },

    // broadened geographic coverage
    { name: 'RNZ World', url: 'https://www.rnz.co.nz/rss/world.xml', category: 'world', credibility_tier: 1, region: 'oceania' },
    { name: 'The Hindu', url: 'https://www.thehindu.com/news/international/feeder/default.rss', category: 'world', credibility_tier: 1, region: 'asia' },
    { name: 'Politico Europe', url: 'https://www.politico.eu/feed/', category: 'world', credibility_tier: 1, region: 'europe' },
    { name: 'Middle East Eye', url: 'https://www.middleeasteye.net/rss', category: 'world', credibility_tier: 2, region: 'middle_east' },
    { name: 'The Rio Times', url: 'https://www.riotimesonline.com/feed/', category: 'world', credibility_tier: 2, region: 'latin_america' },
    { name: 'AllAfrica News', url: 'https://allafrica.com/tools/headlines/rdf/latest/headlines.rdf', category: 'world', credibility_tier: 2, region: 'africa' },

    // Tracks individual conflict events with dates, locations, actor types, fatality counts
    { name: 'ACLED', url: 'https://news.google.com/rss/search?q=site:acleddata.com&hl=en', category: 'crisis', credibility_tier: 2, region: 'global' },

];

// reddit feeds
export const REDDIT_SOURCES: RedditSource[] = [
    { name: 'Reddit CombatFootage', subreddit: 'CombatFootage', category: 'crisis', credibility_tier: 3, region: 'global' },
    { name: 'Reddit CredibleDefense', subreddit: 'CredibleDefense', category: 'crisis', credibility_tier: 2, region: 'global' },
    { name: 'Reddit WorldNews', subreddit: 'worldnews', category: 'world', credibility_tier: 3, region: 'global' },
    { name: 'Reddit News', subreddit: 'news', category: 'world', credibility_tier: 3, region: 'global' },
    { name: 'Reddit Geopolitics', subreddit: 'geopolitics', category: 'world', credibility_tier: 2, region: 'global' },
    { name: 'Reddit Europe', subreddit: 'europe', category: 'world', credibility_tier: 3, region: 'europe' },
    { name: 'Reddit MiddleEastNews', subreddit: 'MiddleEastNews', category: 'world', credibility_tier: 3, region: 'middle_east' },
    { name: 'Reddit UkraineWarVideoReport', subreddit: 'UkraineWarVideoReport', category: 'crisis', credibility_tier: 3, region: 'global' },
    { name: 'Reddit ukraine', subreddit: 'ukraine', category: 'crisis', credibility_tier: 3, region: 'europe' },
    { name: 'Reddit GlobalConflict', subreddit: 'GlobalConflict', category: 'crisis', credibility_tier: 2, region: 'global' },
    { name: 'Reddit MiddleEast', subreddit: 'MiddleEast', category: 'world', credibility_tier: 3, region: 'middle_east' },
    { name: 'Reddit China', subreddit: 'China', category: 'world', credibility_tier: 3, region: 'asia' },
    { name: 'Reddit LatinAmerica', subreddit: 'LatinAmerica', category: 'world', credibility_tier: 3, region: 'latin_america' },
    { name: 'Reddit InternationalPolitics', subreddit: 'internationalpolitics', category: 'world', credibility_tier: 3, region: 'global' },
];

export interface SocialSource {
    name: string;
    url: string;
    platform: 'telegram' | 'x';
    category: string;
    credibility_tier: 1 | 2 | 3;
}

export const TELEGRAM_CHANNELS: SocialSource[] = [
    { name: 'LiveUkraine (Telegram)', url: 'https://t.me/s/liveukraine_media', platform: 'telegram', category: 'crisis', credibility_tier: 3 },
    { name: 'bloomberg (Telegram)', url: 'https://t.me/s/bloomberg', platform: 'telegram', category: 'business', credibility_tier: 1 },
    { name: 'War Translated (Telegram)', url: 'https://t.me/s/wartranslated', platform: 'telegram', category: 'crisis', credibility_tier: 2 },
    { name: 'Kyiv Independent (Telegram)', url: 'https://t.me/s/kyivindependent', platform: 'telegram', category: 'crisis', credibility_tier: 1 },
    { name: 'Intel Slava Z (Telegram)', url: 'https://t.me/s/intelslava', platform: 'telegram', category: 'crisis', credibility_tier: 3 },
    { name: 'OSINTdefender (Telegram)', url: 'https://t.me/s/osintdefender', platform: 'telegram', category: 'crisis', credibility_tier: 2 },
    { name: 'Middle East Eye (Telegram)', url: 'https://t.me/s/middleeasteye', platform: 'telegram', category: 'world', credibility_tier: 2 },
];

export const X_ACCOUNTS: SocialSource[] = [
    { name: 'GeoConfirmed (X)', url: 'GeoConfirmed', platform: 'x', category: 'crisis', credibility_tier: 2 },
    { name: 'OSINTtechnical (X)', url: 'OSINTtechnical', platform: 'x', category: 'crisis', credibility_tier: 2 },
    { name: 'Liveuamap (X)', url: 'Liveuamap', platform: 'x', category: 'crisis', credibility_tier: 1 },
    { name: 'The Intel Crab (X)', url: 'IntelCrab', platform: 'x', category: 'crisis', credibility_tier: 2 },
    { name: 'Aurora Intel (X)', url: 'AuroraIntel', platform: 'x', category: 'crisis', credibility_tier: 2 },
    { name: 'ELINT News (X)', url: 'ELINTNews', platform: 'x', category: 'crisis', credibility_tier: 2 },
    { name: 'Rob Lee (X)', url: 'RALee85', platform: 'x', category: 'crisis', credibility_tier: 2 },
    { name: 'Clash Report (X)', url: 'clashreport', platform: 'x', category: 'crisis', credibility_tier: 3 },
    { name: 'Oliver Alexander (X)', url: 'OAlexanderDK', platform: 'x', category: 'crisis', credibility_tier: 2 },
    { name: 'Michael Kofman (X)', url: 'KofmanMichael', platform: 'x', category: 'crisis', credibility_tier: 2 },
    { name: 'OSINTdefender (X)', url: 'sentdefender', platform: 'x', category: 'crisis', credibility_tier: 2 },
    { name: 'IDF (X)', url: 'IDF', platform: 'x', category: 'crisis', credibility_tier: 1 },
    { name: 'IsraelWarRoom (X)', url: 'IsraelWarRoom', platform: 'x', category: 'crisis', credibility_tier: 3 },
];
