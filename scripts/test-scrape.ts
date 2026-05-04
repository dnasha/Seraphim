/*
Seraphim Scraper Fetcher Diagnostics
Tests raw data ingestion performance and counts without database or geocoding overhead.

Usage: bun run scripts/test-scrape.ts
*/

import { fetchAllRSSFeeds, fetchAllRedditFeeds } from '../src/scraper/fetchers/rss';
import { fetchGNews, fetchOSINTGNews } from '../src/scraper/fetchers/gnews';
import { fetchSocialFeeds } from '../src/scraper/fetchers/social-feeds';
import { NewsItem } from '../src/lib/types';

/*
Measures the performance of a specific scraper fetcher.
Outputs a summary table of items retrieved per source.
*/
async function measureScrape(name: string, fetcher: () => Promise<NewsItem[]>) {
    console.log(`\nStarting scrape: ${name}`);
    const startMs = Date.now();
    try {
        const items = await fetcher();
        const duration = ((Date.now() - startMs) / 1000).toFixed(2);
        console.log(`[${name}] Complete in ${duration}s. Items retrieved: ${items.length}`);
        
        // Aggregate item counts per source
        const sourceCounts = items.reduce((acc: Record<string, number>, curr) => {
            acc[curr.source] = (acc[curr.source] || 0) + 1;
            return acc;
        }, {});
        
        console.table(Object.entries(sourceCounts).map(([Source, Count]) => ({ Source, Count })));
        return items;
    } catch (e) {
        const duration = ((Date.now() - startMs) / 1000).toFixed(2);
        console.error(`[${name}] Failed in ${duration}s - Error:`, e);
        return [];
    }
}

async function runTest() {
    console.log('=============================================');
    console.log('         Scraper Fetcher Diagnostics         ');
    console.log('=============================================');

    const totalStartMs = Date.now();

    // Run fetchers sequentially for cleaner console logging
    const rssItems = await measureScrape('RSS Feeds', fetchAllRSSFeeds);
    const redditItems = await measureScrape('Reddit Feeds', fetchAllRedditFeeds);
    const gnewsGeneral = await measureScrape('GNews General', () => fetchGNews('general', 30));
    const gnewsOsint = await measureScrape('GNews OSINT', () => fetchOSINTGNews(50));
    const socialItems = await measureScrape('Social Feeds (Telegram & X)', fetchSocialFeeds);

    const allItems = [
        ...rssItems,
        ...redditItems,
        ...gnewsGeneral,
        ...gnewsOsint,
        ...socialItems
    ];

    const totalDuration = ((Date.now() - totalStartMs) / 1000).toFixed(2);
    
    console.log('\n=============================================');
    console.log(`SUMMARY (Total Time: ${totalDuration}s)`);
    console.log('=============================================');
    console.log(`RSS Items:       ${rssItems.length}`);
    console.log(`Reddit Items:    ${redditItems.length}`);
    console.log(`GNews General:   ${gnewsGeneral.length}`);
    console.log(`GNews OSINT:     ${gnewsOsint.length}`);
    console.log(`Social Items:    ${socialItems.length}`);
    console.log('---------------------------------------------');
    console.log(`Total retrieved:   ${allItems.length}`);
    console.log('=============================================');
    
    // Show a preview of the most recent results
    if (allItems.length > 0) {
        console.log('\nPreview of top 3 global items recently published:');
        const sorted = allItems.sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());
        sorted.slice(0, 3).forEach((item, idx) => {
            console.log(`\n[${idx + 1}] ${item.title}`);
            console.log(`    Source: ${item.source} | Date: ${item.publishedAt}`);
            console.log(`    URL: ${item.url}`);
        });
    }
}

runTest().catch((err) => {
    console.error('Fatal scrape test error:', err);
    process.exit(1);
});

