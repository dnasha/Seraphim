/*
Seraphim Data Sources Registry
Central configuration for all news ingestion channels including RSS, Reddit, Telegram, and X.

Credibility Tier System:
- Tier 1: Primary news agencies, verified official channels, and institutional sources.
- Tier 2: Specialized OSINT accounts, independent investigative journalists, and regional experts.
- Tier 3: Raw social media feeds, community-driven reports, and unverified breaking news.
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

export interface SocialSource {
    name: string;
    url: string;
    platform: 'telegram' | 'x';
    category: string;
    credibility_tier: 1 | 2 | 3;
}

export const RSS_SOURCES: RSSSource[] = [
    // WORLD NEWS: Tier 1 (Major Agencies)
    { name: 'BBC World', url: 'https://feeds.bbci.co.uk/news/rss.xml', category: 'world', credibility_tier: 1, region: 'global' },
    { name: 'Al Jazeera', url: 'https://www.aljazeera.com/xml/rss/all.xml', category: 'world', credibility_tier: 1, region: 'global' },
    { name: 'NYT World', url: 'https://rss.nytimes.com/services/xml/rss/nyt/World.xml', category: 'world', credibility_tier: 1, region: 'global' },
    { name: 'DW News', url: 'https://rss.dw.com/rdf/rss-en-eu', category: 'world', credibility_tier: 1, region: 'europe' },
    { name: 'France 24', url: 'https://www.france24.com/en/europe/rss', category: 'world', credibility_tier: 1, region: 'europe' },
    { name: 'Politico Europe', url: 'https://www.politico.eu/feed/', category: 'world', credibility_tier: 1, region: 'europe' },
    { name: 'SCMP', url: 'https://www.scmp.com/rss/91/feed', category: 'world', credibility_tier: 1, region: 'asia' },
    { name: 'CNA Asia', url: 'https://www.channelnewsasia.com/api/v1/rss-outbound-feed?_format=xml&category=6511', category: 'world', credibility_tier: 1, region: 'asia' },
    { name: 'Nikkei Asia', url: 'https://asia.nikkei.com/rss/feed/nar', category: 'world', credibility_tier: 1, region: 'asia' },
    { name: 'The Hindu', url: 'https://www.thehindu.com/news/international/feeder/default.rss', category: 'world', credibility_tier: 1, region: 'asia' },
    { name: 'BBC Africa', url: 'http://feeds.bbci.co.uk/news/world/africa/rss.xml', category: 'world', credibility_tier: 1, region: 'africa' },
    { name: 'Africanews', url: 'https://www.africanews.com/feed/rss', category: 'world', credibility_tier: 1, region: 'africa' },
    { name: 'BBC Middle East', url: 'http://feeds.bbci.co.uk/news/world/middle_east/rss.xml', category: 'world', credibility_tier: 1, region: 'middle_east' },
    { name: 'Al Arabiya English', url: 'https://news.google.com/rss/search?q=site:english.alarabiya.net&hl=en', category: 'world', credibility_tier: 1, region: 'middle_east' },
    { name: 'RNZ World', url: 'https://www.rnz.co.nz/rss/world.xml', category: 'world', credibility_tier: 1, region: 'oceania' },
    { name: 'SBS News Australia', url: 'https://www.sbs.com.au/news/topic/australia/feed', category: 'world', credibility_tier: 1, region: 'oceania' },
    { name: 'The Guardian Australia', url: 'https://www.theguardian.com/australia-news/rss', category: 'world', credibility_tier: 1, region: 'oceania' },

    // WORLD NEWS: Tier 2 (Specialized/Regional)
    { name: 'The Astana Times', url: 'https://astanatimes.com/feed/', category: 'world', credibility_tier: 2, region: 'asia' },
    { name: 'Balkan Insight', url: 'https://balkaninsight.com/feed/', category: 'world', credibility_tier: 2, region: 'europe' },
    { name: 'The Geopost', url: 'https://thegeopost.com/en/feed/', category: 'world', credibility_tier: 2, region: 'europe' },
    { name: 'N1 English', url: 'https://n1info.ba/english/feed/', category: 'world', credibility_tier: 2, region: 'europe' },
    { name: 'Bangkok Post', url: 'https://www.bangkokpost.com/rss/data/topstories.xml', category: 'world', credibility_tier: 1, region: 'asia' },
    { name: 'The Straits Times', url: 'https://www.straitstimes.com/news/asia/rss.xml', category: 'world', credibility_tier: 1, region: 'asia' },
    { name: 'ANTARA News', url: 'https://en.antaranews.com/rss/news.xml', category: 'world', credibility_tier: 1, region: 'asia' },
    { name: 'Nunatsiaq News', url: 'https://nunatsiaq.com/feed/', category: 'world', credibility_tier: 2, region: 'north_america' },
    { name: 'Times of Israel', url: 'https://www.timesofisrael.com/feed/', category: 'world', credibility_tier: 2, region: 'middle_east' },
    { name: 'Middle East Eye', url: 'https://www.middleeasteye.net/rss', category: 'world', credibility_tier: 2, region: 'middle_east' },
    { name: 'MercoPress LatAm', url: 'https://en.mercopress.com/rss/', category: 'world', credibility_tier: 2, region: 'latin_america' },
    { name: 'The Rio Times', url: 'https://www.riotimesonline.com/feed/', category: 'world', credibility_tier: 2, region: 'latin_america' },
    { name: 'AllAfrica News', url: 'https://allafrica.com/tools/headlines/rdf/latest/headlines.rdf', category: 'world', credibility_tier: 2, region: 'africa' },
    { name: 'Mail & Guardian', url: 'https://mg.co.za/feed/', category: 'world', credibility_tier: 2, region: 'africa' },
    { name: 'Latin America Reports', url: 'https://latinamericareports.com/feed', category: 'world', credibility_tier: 2, region: 'latin_america' },
    { name: 'The Tico Times', url: 'https://ticotimes.net/feed', category: 'world', credibility_tier: 2, region: 'latin_america' },
    { name: 'Mexico News Daily', url: 'https://mexiconewsdaily.com/feed', category: 'world', credibility_tier: 2, region: 'latin_america' },

    // CRISIS & GEOPOLITICS: Tier 1/2
    { name: 'USGS Earthquakes', url: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/significant_month.atom', category: 'crisis', credibility_tier: 1, region: 'global' },
    { name: 'ISW Daily Updates', url: 'https://news.google.com/rss/search?q=site:understandingwar.org&hl=en', category: 'crisis', credibility_tier: 2, region: 'global' },
    { name: 'ICG CrisisWatch', url: 'https://www.crisisgroup.org/rss', category: 'crisis', credibility_tier: 2, region: 'global' },
    { name: 'ACLED', url: 'https://news.google.com/rss/search?q=site:acleddata.com&hl=en', category: 'crisis', credibility_tier: 2, region: 'global' },
    { name: 'War on the Rocks', url: 'https://warontherocks.com/feed/', category: 'world', credibility_tier: 2, region: 'global' },
    { name: 'Foreign Affairs', url: 'https://foreignaffairs.com/rss.xml', category: 'world', credibility_tier: 1, region: 'global' },
    { name: 'CFR', url: 'https://news.google.com/rss/search?q=site:cfr.org&hl=en', category: 'world', credibility_tier: 2, region: 'global' },
    { name: 'Chatham House', url: 'https://news.google.com/rss/search?q=site:chathamhouse.org&hl=en', category: 'world', credibility_tier: 2, region: 'global' },
    { name: 'ECFR', url: 'https://ecfr.eu/feed/', category: 'world', credibility_tier: 2, region: 'europe' },
    { name: 'The Diplomat', url: 'https://thediplomat.com/feed', category: 'world', credibility_tier: 2, region: 'asia' },
    { name: 'Geopolitical Futures', url: 'https://geopoliticalfutures.com/feed', category: 'world', credibility_tier: 2, region: 'global' },
    { name: 'Bellingcat', url: 'https://www.bellingcat.com/feed/', category: 'world', credibility_tier: 2, region: 'global' },

    // NATIONAL NEWS
    { name: 'NPR US', url: 'https://feeds.npr.org/1003/rss.xml', category: 'nation', credibility_tier: 1, region: 'north_america' },
    { name: 'ABC Australia', url: 'https://www.abc.net.au/news/feed/51120/rss.xml', category: 'nation', credibility_tier: 1, region: 'oceania' },
    { name: 'NDTV India', url: 'https://feeds.feedburner.com/ndtvnews-top-stories', category: 'nation', credibility_tier: 1, region: 'asia' },
    { name: 'DW Germany', url: 'https://rss.dw.com/rdf/rss-en-top', category: 'nation', credibility_tier: 1, region: 'europe' },
    { name: 'Le Monde France', url: 'https://www.lemonde.fr/en/rss/une.xml', category: 'nation', credibility_tier: 1, region: 'europe' },
    { name: 'Premium Times Nigeria', url: 'https://www.premiumtimesng.com/feed', category: 'nation', credibility_tier: 1, region: 'africa' },
    { name: 'Nation Kenya', url: 'https://news.google.com/rss/search?q=site:nation.africa&hl=en', category: 'nation', credibility_tier: 1, region: 'africa' },
    { name: 'Daily News Egypt', url: 'https://www.dailynewsegypt.com/feed/', category: 'nation', credibility_tier: 1, region: 'africa' },
    { name: 'Japan Today', url: 'https://japantoday.com/feed', category: 'nation', credibility_tier: 2, region: 'asia' },

    // Regional OSINT
    { name: 'Dawn Pakistan', url: 'https://www.dawn.com/feeds/home', category: 'world', credibility_tier: 1, region: 'asia' },
    { name: 'Daily Star Bangladesh', url: 'https://www.thedailystar.net/frontpage/rss.xml', category: 'world', credibility_tier: 1, region: 'asia' },
    { name: 'Ada Derana Sri Lanka', url: 'http://www.adaderana.lk/rss.php', category: 'world', credibility_tier: 2, region: 'asia' },
    { name: 'Defence24 Poland', url: 'https://defence24.com/rss', category: 'crisis', credibility_tier: 2, region: 'europe' },
    { name: 'Romania Insider', url: 'https://www.romania-insider.com/feed', category: 'world', credibility_tier: 2, region: 'europe' },

    // BUSINESS
    { name: 'CNBC', url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114', category: 'business', credibility_tier: 1, region: 'global' },
    { name: 'MarketWatch', url: 'https://feeds.marketwatch.com/marketwatch/topstories/', category: 'business', credibility_tier: 1, region: 'global' },

    // TECHNOLOGY & CYBER
    { name: 'Ars Technica', url: 'https://feeds.arstechnica.com/arstechnica/index', category: 'technology', credibility_tier: 1, region: 'global' },
    { name: 'The Verge', url: 'https://www.theverge.com/rss/index.xml', category: 'technology', credibility_tier: 1, region: 'global' },
    { name: 'BleepingComputer', url: 'https://www.bleepingcomputer.com/feed/', category: 'technology', credibility_tier: 1, region: 'global' },
    { name: 'The Hacker News', url: 'https://feeds.feedburner.com/TheHackersNews', category: 'technology', credibility_tier: 1, region: 'global' },
    { name: 'TechCrunch', url: 'https://techcrunch.com/feed/', category: 'technology', credibility_tier: 1, region: 'global' },

    // SCIENCE
    { name: 'NASA', url: 'https://www.nasa.gov/news-release/feed/', category: 'science', credibility_tier: 1, region: 'global' },
    { name: 'Nature', url: 'https://www.nature.com/nature.rss', category: 'science', credibility_tier: 1, region: 'global' },
    { name: 'ScienceDaily', url: 'https://www.sciencedaily.com/rss/all.xml', category: 'science', credibility_tier: 1, region: 'global' },
    { name: 'Science Magazine', url: 'https://www.science.org/rss/express.xml', category: 'science', credibility_tier: 1, region: 'global' },
    { name: 'Phys.org', url: 'https://phys.org/rss-feed/', category: 'science', credibility_tier: 1, region: 'global' },

    // HEALTH
    { name: 'WHO News', url: 'https://www.who.int/rss-feeds/news-english.xml', category: 'health', credibility_tier: 1, region: 'global' },
    { name: 'Stat News', url: 'https://www.statnews.com/feed/', category: 'health', credibility_tier: 1, region: 'global' },

    // NORTH AMERICA REGIONAL
    { name: 'NYT New York', url: 'https://rss.nytimes.com/services/xml/rss/nyt/NYRegion.xml', category: 'nation', credibility_tier: 1, region: 'north_america' },
    { name: 'WBUR News', url: 'https://www.wbur.org/rss', category: 'nation', credibility_tier: 1, region: 'north_america' },
    { name: 'WHYY News', url: 'https://whyy.org/feed/', category: 'nation', credibility_tier: 1, region: 'north_america' },
    { name: 'NJ.com', url: 'https://www.nj.com/arc/outboundfeeds/rss/', category: 'nation', credibility_tier: 2, region: 'north_america' },
    { name: 'The Texas Tribune', url: 'https://feeds.texastribune.org/feeds/main/', category: 'nation', credibility_tier: 1, region: 'north_america' },
    { name: 'Florida Phoenix', url: 'https://www.floridaphoenix.com/feed/', category: 'nation', credibility_tier: 1, region: 'north_america' },
    { name: 'Georgia Recorder', url: 'https://georgiarecorder.com/feed/', category: 'nation', credibility_tier: 1, region: 'north_america' },
    { name: 'AL.com', url: 'https://www.al.com/arc/outboundfeeds/rss/category/news/', category: 'nation', credibility_tier: 1, region: 'north_america' },
    { name: 'Star Tribune', url: 'https://www.startribune.com/local/index.rss2', category: 'nation', credibility_tier: 1, region: 'north_america' },
    { name: 'WBEZ Chicago', url: 'https://www.wbez.org/rss', category: 'nation', credibility_tier: 1, region: 'north_america' },
    { name: 'Los Angeles Times', url: 'https://www.latimes.com/rss2.0.xml', category: 'nation', credibility_tier: 1, region: 'north_america' },
    { name: 'Washington State Standard', url: 'https://washingtonstatestandard.com/feed/', category: 'nation', credibility_tier: 1, region: 'north_america' },
    { name: 'OregonLive News', url: 'https://www.oregonlive.com/arc/outboundfeeds/rss/category/news/', category: 'nation', credibility_tier: 1, region: 'north_america' },
    { name: 'KOMO News Seattle', url: 'https://komonews.com/news/local.rss', category: 'nation', credibility_tier: 2, region: 'north_america' },
    { name: 'Global News Canada', url: 'https://globalnews.ca/canada/feed/', category: 'world', credibility_tier: 1, region: 'north_america' },
    { name: 'National Post', url: 'https://nationalpost.com/feed/', category: 'world', credibility_tier: 1, region: 'north_america' },

    // LATIN AMERICA
    { name: 'Buenos Aires Times', url: 'https://www.batimes.com.ar/feed', category: 'world', credibility_tier: 2, region: 'latin_america' },
    { name: 'The Santiago Times', url: 'https://santiagotimes.cl/feed', category: 'world', credibility_tier: 2, region: 'latin_america' },
    { name: 'Colombia Reports', url: 'https://colombiareports.com/feed/', category: 'world', credibility_tier: 2, region: 'latin_america' },

    // AFRICA
    { name: 'Daily Maverick', url: 'https://www.dailymaverick.co.za/dmrss/', category: 'world', credibility_tier: 1, region: 'africa' },
    { name: 'The EastAfrican', url: 'https://www.theeastafrican.co.ke/rss.xml', category: 'world', credibility_tier: 1, region: 'africa' },
    { name: 'Vanguard News', url: 'https://www.vanguardngr.com/feed/', category: 'world', credibility_tier: 1, region: 'africa' },

    // MIDDLE EAST
    { name: 'Anadolu Agency', url: 'https://www.aa.com.tr/en/rss/default?cat=guncel', category: 'world', credibility_tier: 1, region: 'middle_east' },
    { name: 'Al-Monitor', url: 'https://www.al-monitor.com/rss', category: 'world', credibility_tier: 1, region: 'middle_east' },

    // ASIA
    { name: 'Japan Times', url: 'https://www.japantimes.co.jp/feed/', category: 'world', credibility_tier: 1, region: 'asia' },
    { name: 'Yonhap News', url: 'https://en.yna.co.kr/RSS/news.xml', category: 'world', credibility_tier: 1, region: 'asia' },
    { name: 'VNExpress International', url: 'https://e.vnexpress.net/rss/news.rss', category: 'world', credibility_tier: 1, region: 'asia' },
    { name: 'Indian Express', url: 'https://indianexpress.com/feed/', category: 'world', credibility_tier: 1, region: 'asia' },

    // OCEANIA & PACIFIC
    { name: 'Post Courier', url: 'https://postcourier.com.pg/feed/', category: 'world', credibility_tier: 1, region: 'oceania' },
];

export const REDDIT_SOURCES: RedditSource[] = [
    { name: 'Reddit CombatFootage', subreddit: 'CombatFootage', category: 'crisis', credibility_tier: 3, region: 'global' },
    { name: 'Reddit CredibleDefense', subreddit: 'CredibleDefense', category: 'crisis', credibility_tier: 2, region: 'global' },
    { name: 'Reddit UkraineWarVideoReport', subreddit: 'UkraineWarVideoReport', category: 'crisis', credibility_tier: 3, region: 'global' },
    { name: 'Reddit ukraine', subreddit: 'ukraine', category: 'crisis', credibility_tier: 3, region: 'europe' },
    { name: 'Reddit LessCredibleDefence', subreddit: 'LessCredibleDefence', category: 'crisis', credibility_tier: 2, region: 'global' },
    { name: 'Reddit SyrianCivilWar', subreddit: 'syriancivilwar', category: 'crisis', credibility_tier: 3, region: 'middle_east' },
    
    { name: 'Reddit WorldNews', subreddit: 'worldnews', category: 'world', credibility_tier: 3, region: 'global' },
    { name: 'Reddit News', subreddit: 'news', category: 'world', credibility_tier: 3, region: 'global' },
    { name: 'Reddit Geopolitics', subreddit: 'geopolitics', category: 'world', credibility_tier: 2, region: 'global' },
    { name: 'Reddit Europe', subreddit: 'europe', category: 'world', credibility_tier: 3, region: 'europe' },
    { name: 'Reddit MiddleEastNews', subreddit: 'MiddleEastNews', category: 'world', credibility_tier: 3, region: 'middle_east' },
    { name: 'Reddit MiddleEast', subreddit: 'MiddleEast', category: 'world', credibility_tier: 3, region: 'middle_east' },
    { name: 'Reddit China', subreddit: 'China', category: 'world', credibility_tier: 3, region: 'asia' },
    { name: 'Reddit LatinAmerica', subreddit: 'LatinAmerica', category: 'world', credibility_tier: 3, region: 'latin_america' },
    { name: 'Reddit InternationalPolitics', subreddit: 'internationalpolitics', category: 'world', credibility_tier: 3, region: 'global' },
];

export const TELEGRAM_CHANNELS: SocialSource[] = [
    
    { name: 'War Translated (Telegram)', url: 'https://t.me/s/wartranslated', platform: 'telegram', category: 'crisis', credibility_tier: 2 },
    { name: 'OSINTdefender (Telegram)', url: 'https://t.me/s/osintdefender', platform: 'telegram', category: 'crisis', credibility_tier: 2 },
    { name: 'Bellum Acta News (Telegram)', url: 'https://t.me/s/BellumActaNews', platform: 'telegram', category: 'crisis', credibility_tier: 3 },
    { name: 'Rybar in English (Telegram)', url: 'https://t.me/s/rybar_in_english', platform: 'telegram', category: 'crisis', credibility_tier: 3 },
    { name: 'Middle East Eye (Telegram)', url: 'https://t.me/s/MiddleEastEye_TG', platform: 'telegram', category: 'world', credibility_tier: 2 },
    
    { name: 'LiveUkraine (Telegram)', url: 'https://t.me/s/liveukraine_media', platform: 'telegram', category: 'crisis', credibility_tier: 3 },
    { name: 'Intel Slava Z (Telegram)', url: 'https://t.me/s/intelslava', platform: 'telegram', category: 'crisis', credibility_tier: 3 },
    { name: 'Clash Report (Telegram)', url: 'https://t.me/s/ClashReport', platform: 'telegram', category: 'crisis', credibility_tier: 3 },
];

export const X_ACCOUNTS: SocialSource[] = [
    { name: 'Liveuamap (X)', url: 'Liveuamap', platform: 'x', category: 'crisis', credibility_tier: 1 },
    { name: 'IDF (X)', url: 'IDF', platform: 'x', category: 'crisis', credibility_tier: 1 },
    
    { name: 'GeoConfirmed (X)', url: 'GeoConfirmed', platform: 'x', category: 'crisis', credibility_tier: 2 },
    { name: 'OSINTtechnical (X)', url: 'OSINTtechnical', platform: 'x', category: 'crisis', credibility_tier: 2 },
    { name: 'ELINT News (X)', url: 'ELINTNews', platform: 'x', category: 'crisis', credibility_tier: 2 },
    { name: 'Rob Lee (X)', url: 'RALee85', platform: 'x', category: 'crisis', credibility_tier: 2 },
    { name: 'Michael Kofman (X)', url: 'KofmanMichael', platform: 'x', category: 'crisis', credibility_tier: 2 },
    { name: 'OSINTdefender (X)', url: 'sentdefender', platform: 'x', category: 'crisis', credibility_tier: 2 },
    { name: 'BRICSinfo (X)', url: 'BRICSinfo', platform: 'x', category: 'world', credibility_tier: 3 },
    
];
