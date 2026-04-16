/*
Dan Sharan

data sources file

contains rss and reddit sources
*/

export interface RSSSource {
    name: string;
    url: string;
    category: string;
    region?: string;
}

export interface RedditSource {
    name: string;
    subreddit: string;
    category: string;
    region: string;
}

// curated feeds for world news, crisis, national, business, tech, science, health
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
    // { name: 'ReliefWeb', url: 'https://reliefweb.int/updates/rss.xml', category: 'crisis', region: 'global' },

    // geopolitical think tanks
    { name: 'War on the Rocks', url: 'https://warontherocks.com/feed/', category: 'world', region: 'global' },
    { name: 'ISW Daily Updates', url: 'https://news.google.com/rss/search?q=site:understandingwar.org&hl=en', category: 'crisis', region: 'global' },
    { name: 'Foreign Affairs', url: 'https://foreignaffairs.com/rss.xml', category: 'world', region: 'global' },
    { name: 'CFR', url: 'https://news.google.com/rss/search?q=site:cfr.org&hl=en', category: 'world', region: 'global' },
    { name: 'Chatham House', url: 'https://news.google.com/rss/search?q=site:chathamhouse.org&hl=en', category: 'world', region: 'global' },
    { name: 'ECFR', url: 'https://ecfr.eu/feed/', category: 'world', region: 'europe' },
    { name: 'ICG CrisisWatch', url: 'https://www.crisisgroup.org/rss', category: 'crisis', region: 'global' },
    { name: 'The Diplomat', url: 'https://thediplomat.com/feed', category: 'world', region: 'asia' },
    { name: 'Geopolitical Futures', url: 'https://geopoliticalfutures.com/feed', category: 'world', region: 'global' },

    // oSINT / investigative
    { name: 'Bellingcat', url: 'https://www.bellingcat.com/feed/', category: 'world', region: 'global' },

    // national / domestic
    { name: 'NPR US', url: 'https://feeds.npr.org/1003/rss.xml', category: 'nation', region: 'north_america' },

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

    // broadened geographic coverage
    { name: 'RNZ World', url: 'https://www.rnz.co.nz/rss/world.xml', category: 'world', region: 'oceania' },
    { name: 'The Hindu', url: 'https://www.thehindu.com/news/international/feeder/default.rss', category: 'world', region: 'asia' },
    { name: 'Politico Europe', url: 'https://www.politico.eu/feed/', category: 'world', region: 'europe' },
    { name: 'Middle East Eye', url: 'https://www.middleeasteye.net/rss', category: 'world', region: 'middle_east' },
    { name: 'The Rio Times', url: 'https://www.riotimesonline.com/feed/', category: 'world', region: 'latin_america' },
    { name: 'AllAfrica News', url: 'https://allafrica.com/tools/headlines/rdf/latest/headlines.rdf', category: 'world', region: 'africa' },

    // Tracks individual conflict events with dates, locations, actor types, fatality counts
    { name: 'ACLED', url: 'https://news.google.com/rss/search?q=site:acleddata.com&hl=en', category: 'crisis', region: 'global' },

];

// reddit feeds
export const REDDIT_SOURCES: RedditSource[] = [
    { name: 'Reddit CombatFootage', subreddit: 'CombatFootage', category: 'crisis', region: 'global' },
    { name: 'Reddit CredibleDefense', subreddit: 'CredibleDefense', category: 'crisis', region: 'global' },
    { name: 'Reddit WorldNews', subreddit: 'worldnews', category: 'world', region: 'global' },
    { name: 'Reddit News', subreddit: 'news', category: 'world', region: 'global' },
    { name: 'Reddit Geopolitics', subreddit: 'geopolitics', category: 'world', region: 'global' },
    { name: 'Reddit Europe', subreddit: 'europe', category: 'world', region: 'europe' },
    { name: 'Reddit MiddleEastNews', subreddit: 'MiddleEastNews', category: 'world', region: 'middle_east' },
    // Crisis / conflict
    { name: 'Reddit UkraineWarVideoReport', subreddit: 'UkraineWarVideoReport', category: 'crisis', region: 'global' },
    // More strictly moderated than CombatFootage, Ukraine-focused, faster sourcing standards

    { name: 'Reddit ukraine', subreddit: 'ukraine', category: 'crisis', region: 'europe' },
    // Good mix of on-the-ground perspective + English-language Ukrainian media

    { name: 'Reddit GlobalConflict', subreddit: 'GlobalConflict', category: 'crisis', region: 'global' },
    // Analytical, less noise than CombatFootage

    // Regional
    { name: 'Reddit MiddleEast', subreddit: 'MiddleEast', category: 'world', region: 'middle_east' },
    // Broader than MiddleEastNews, more diverse sourcing

    { name: 'Reddit China', subreddit: 'China', category: 'world', region: 'asia' },
    // You have nothing for China specifically — real gap given Taiwan/SCS coverage

    { name: 'Reddit LatinAmerica', subreddit: 'LatinAmerica', category: 'world', region: 'latin_america' },

    // Analysis
    { name: 'Reddit InternationalPolitics', subreddit: 'internationalpolitics', category: 'world', region: 'global' },
    // Less noise than worldnews, more analysis-oriented
];

export interface SocialSource {
    name: string;
    url: string;
    platform: 'telegram' | 'x';
    category: string;
}

export const TELEGRAM_CHANNELS: SocialSource[] = [
    { name: 'LiveUkraine (Telegram)', url: 'https://t.me/s/liveukraine_media', platform: 'telegram', category: 'crisis' },
    { name: 'bloomberg (Telegram)', url: 'https://t.me/s/bloomberg', platform: 'telegram', category: 'business' },
    // Ukraine conflict
{ name: 'War Translated (Telegram)', url: 'https://t.me/s/wartranslated', platform: 'telegram', category: 'crisis' },
// Translates Russian milbloggers in near real-time — essential for understanding the Russian side without going to pro-Kremlin channels directly

//{ name: 'NEXTA (Telegram)', url: 'https://t.me/s/nexta_live', platform: 'telegram', category: 'crisis' },
// Belarusian opposition outlet, fast Ukraine/Belarus breaking news

{ name: 'Kyiv Independent (Telegram)', url: 'https://t.me/s/kyivindependent', platform: 'telegram', category: 'crisis' },
// English-language, editorially rigorous, primary Ukraine source

// Global/OSINT
{ name: 'Intel Slava Z (Telegram)', url: 'https://t.me/s/intelslava', platform: 'telegram', category: 'crisis' },
// ⚠️ Pro-Russian lean — treat as primary source intelligence, not editorial truth. Useful for what Russia wants amplified.

{ name: 'OSINTdefender (Telegram)', url: 'https://t.me/s/osintdefender', platform: 'telegram', category: 'crisis' },
// Mirror of the @sentdefender X account, global conflict

{ name: 'Middle East Eye (Telegram)', url: 'https://t.me/s/middleeasteye', platform: 'telegram', category: 'world' },
];

export const X_ACCOUNTS: SocialSource[] = [
    { name: 'GeoConfirmed (X)', url: 'GeoConfirmed', platform: 'x', category: 'crisis' },
    { name: 'OSINTtechnical (X)', url: 'OSINTtechnical', platform: 'x', category: 'crisis' },
    { name: 'Liveuamap (X)', url: 'Liveuamap', platform: 'x', category: 'crisis' },
    { name: 'The Intel Crab (X)', url: 'IntelCrab', platform: 'x', category: 'crisis' },
    { name: 'Aurora Intel (X)', url: 'AuroraIntel', platform: 'x', category: 'crisis' },
    { name: 'ELINT News (X)', url: 'ELINTNews', platform: 'x', category: 'crisis' },
    //{ name: 'Def Mon (X)', url: 'DefMon3', platform: 'x', category: 'crisis' },
    { name: 'Rob Lee (X)', url: 'RALee85', platform: 'x', category: 'crisis' },
    { name: 'Clash Report (X)', url: 'clashreport', platform: 'x', category: 'crisis' },
    { name: 'Oliver Alexander (X)', url: 'OAlexanderDK', platform: 'x', category: 'crisis' },
    { name: 'Michael Kofman (X)', url: 'KofmanMichael', platform: 'x', category: 'crisis' },
    { name: 'OSINTdefender (X)', url: 'sentdefender', platform: 'x', category: 'crisis' },
    { name: 'IDF (X)', url: 'IDF', platform: 'x', category: 'crisis' },
    { name: 'IsraelWarRoom (X)', url: 'IsraelWarRoom', platform: 'x', category: 'crisis' },
    // { name: 'Geoff P. Smith (X)', url: 'GeoFront5', platform: 'x', category: 'crisis' },
];
