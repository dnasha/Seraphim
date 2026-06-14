/*
Seraphim Scraper Diagnostic Tool
Validates the full ingestion pipeline (fetch, deduplication, and geocoding) 
without committing changes to the database.

Usage:
bun run scripts/diagnostics/test-scraper.ts
*/

import { createClient } from '@supabase/supabase-js';
import { fetchAllRSSFeeds, fetchAllRedditFeeds } from '@/lib/api/rss';
import { fetchGNews, fetchOSINTGNews } from '@/lib/api/gnews';
import { fetchSocialFeeds } from '@/lib/api/social';
import { enrichItemsWithLocation } from '@/lib/geocoding';
import type { NewsItem } from '@/lib/core/types';
import type { DbEvent } from '@/types';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.');
    process.exit(1);
}

/*
Direct client initialization for diagnostic scripts.
Bypasses standard singleton to ensure service-role permissions in CLI context.
*/
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
});

function newsItemToDbEvent(item: NewsItem): DbEvent | null {
    if (!item.url) return null;
    return {
        title: item.title,
        description: item.description,
        url: item.url,
        source: item.source,
        source_type: item.sourceType,
        category: item.category,
        image_url: item.imageUrl,
        published_at: item.publishedAt,
        latitude: item.latitude,
        longitude: item.longitude,
        location_name: item.locationName,
    };
}

async function run() {
    const startMs = Date.now();
    console.log('Seraphim Scraper: Dry Run Test');
    console.log('No data will be committed to the database.\n');

    // Step 1: Fetch raw items
    console.log('Step 1: Fetching items from all sources...');
    const [rssItems, redditItems, gnewsItems, osintItems, socialItems] = await Promise.allSettled([
        fetchAllRSSFeeds(),
        fetchAllRedditFeeds(),
        fetchGNews('general', 20),
        fetchOSINTGNews(),
        fetchSocialFeeds(),
    ]).then(results =>
        results.map(r => (r.status === 'fulfilled' ? r.value : []))
    ) as [NewsItem[], NewsItem[], NewsItem[], NewsItem[], NewsItem[]];

    const rawItems: NewsItem[] = [
        ...rssItems, ...redditItems, ...gnewsItems, ...osintItems, ...socialItems,
    ];

    console.log(`  RSS feeds:     ${rssItems.length} items`);
    console.log(`  Reddit:        ${redditItems.length} items`);
    console.log(`  GNews:         ${gnewsItems.length + osintItems.length} items`);
    console.log(`  Social:        ${socialItems.length} items`);
    console.log(`  Total raw:     ${rawItems.length} items\n`);

    const itemsWithUrl = rawItems.filter(i => !!i.url);

    // Step 2: Deduplication check
    console.log('Step 2: Checking for existing URLs...');
    const incomingUrls = itemsWithUrl.map(i => i.url);
    const { data: existingRows } = await supabase
        .from('events')
        .select('url')
        .in('url', incomingUrls);

    const knownUrls = new Set((existingRows ?? []).map((r: { url: string }) => r.url));
    const newItems = itemsWithUrl.filter(item => !knownUrls.has(item.url));
    console.log(`  Known in DB:   ${knownUrls.size} URLs`);
    console.log(`  New to ingest: ${newItems.length} items\n`);

    // Step 3: Geocoding
    console.log('Step 3: Running geocoding on new items...');
    const enriched = await enrichItemsWithLocation(newItems);
    const geocodedCount = enriched.filter((i: NewsItem) => i.latitude !== undefined).length;
    console.log(`  Geocoded:      ${geocodedCount}/${enriched.length} items\n`);

    // Step 4: Proposed payload
    const dbEvents: DbEvent[] = enriched
        .map(newsItemToDbEvent)
        .filter((e): e is DbEvent => e !== null);

    console.log(`Step 4: Proposed upsert payload (${dbEvents.length} events):`);

    for (const event of dbEvents) {
        const locationStr = event.latitude
            ? `[LOCATION] ${event.location_name ?? '?'} (${event.latitude.toFixed(3)}, ${event.longitude!.toFixed(3)})`
            : '   (no location)';
        console.log(`[${event.source_type.padEnd(6)}] ${event.title.slice(0, 90)}`);
        console.log(`  ${locationStr}`);
        console.log(`  ${event.url.slice(0, 100)}\n`);
    }

    const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);
    console.log(`Test complete in ${elapsed}s - ${dbEvents.length} events ready for ingestion.`);
}

run().catch(err => {
    console.error('Test script failed:', err);
    process.exit(1);
});
