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
    { name: 'ReliefWeb', url: 'https://reliefweb.int/updates/rss.xml', category: 'crisis', region: 'global' },

    // geopolitical think tanks
    { name: 'War on the Rocks', url: 'https://warontherocks.com/feed/', category: 'world', region: 'global' },
    { name: 'ISW Daily Updates', url: 'https://news.google.com/rss/search?q=site:understandingwar.org&hl=en', category: 'crisis', region: 'global' },

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
];
