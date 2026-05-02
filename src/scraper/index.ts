/*
Dan Sharan

Seraphim Scraper — main ingestion worker

run locally:
    bun run src/scraper/index.ts

dry-run (no db writes, prints payload instead):
    DRY_RUN=true bun run src/scraper/index.ts

environment variables (loaded from .env.local by bun automatically):
    SUPABASE_URL               – Supabase project URL
    SUPABASE_SERVICE_ROLE_KEY  – Service-role key (bypasses RLS for writes)
    GNEWS_API_KEY              – GNews.io API key (optional; skipped when absent)

pipeline:
    1. fetch raw items from RSS feeds, GNews, Reddit, and social channels.
    2. pre-fetch recent event URLs from Supabase to avoid redundant NLP/geocoding.
    3. filter out already-ingested URLs (deduplication guard).
    4. geocode remaining items using the local NLP engine.
    5. upsert events into Supabase (conflict key: `url`).
*/

import { createClient } from '@supabase/supabase-js';
import { fetchAllRSSFeeds, fetchAllRedditFeeds } from './fetchers/rss';
import { fetchGNews, fetchOSINTGNews } from './fetchers/gnews';
import { fetchSocialFeeds } from './fetchers/social-feeds';
import { enrichItemsWithLocation } from './fetchers/geocoding';
import type { NewsItem } from '@/lib/types';
import type { DbEvent } from '@/types';
import { newsItemToDbEvent } from './utils/transforms';

// config

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DRY_RUN = process.env.DRY_RUN === 'true';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('[scraper] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
});

// main pipeline

async function run(): Promise<void> {
    const startMs = Date.now();
    console.log(`[scraper] Starting ingestion run at ${new Date().toISOString()} (dry_run=${DRY_RUN})`);

    // step 1: fetch raw items from all sources
    console.log('[scraper] Fetching raw items from all sources...');
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
        ...rssItems,
        ...redditItems,
        ...gnewsItems,
        ...osintItems,
        ...socialItems,
    ];

    console.log(`[scraper] Raw items fetched: ${rawItems.length} (rss=${rssItems.length}, reddit=${redditItems.length}, gnews=${gnewsItems.length + osintItems.length}, social=${socialItems.length})`);

    // Drop items with no URL (can't upsert without the conflict key)
    const itemsWithUrl = rawItems.filter(item => !!item.url);

    // step 2: pre-fetch known URLs from DB to skip redundant geocoding
    console.log('[scraper] Fetching recent known URLs from Supabase...');
    const incomingUrls = itemsWithUrl.map(i => i.url);

    // Supabase in() generates a GET request, so large arrays exceed URI length limits.
    // Batch into chunks of 20 to stay well under the limit (especially with long social media URLs).
    const knownUrls = new Set<string>();
    const CHUNK_SIZE = 20;
    
    for (let i = 0; i < incomingUrls.length; i += CHUNK_SIZE) {
        const chunk = incomingUrls.slice(i, i + CHUNK_SIZE);
        const { data, error } = await supabase
            .from('events')
            .select('url')
            .in('url', chunk);
            
        if (error) {
            console.error(`[scraper] Failed to pre-fetch chunk ${i / CHUNK_SIZE + 1}:`, error.message);
            // Non-fatal: if this fails, we just don't dedupe this chunk here
            // (the database unique constraint will still protect during upsert)
        } else if (data) {
            data.forEach((r: { url: string }) => knownUrls.add(r.url));
        }
    }
    
    console.log(`[scraper] Known URLs in DB: ${knownUrls.size}`);

    // step 3: filter out already-processed items
    const newItems = itemsWithUrl.filter(item => !knownUrls.has(item.url));
    console.log(`[scraper] New items to process: ${newItems.length}`);

    if (newItems.length === 0) {
        console.log('[scraper] No new items. Exiting.');
        return;
    }

    // step 4: geocode new items using NLP engine
    console.log('[scraper] Running NLP geocoding on new items...');
    const enrichedItems = await enrichItemsWithLocation(newItems);

    const geocodedCount = enrichedItems.filter(i => i.latitude != null).length;
    console.log(`[scraper] Geocoding complete: ${geocodedCount}/${enrichedItems.length} items mapped`);

    // step 5: build db rows and upsert
    const dbEvents: DbEvent[] = enrichedItems
        .map(newsItemToDbEvent)
        .filter((e): e is DbEvent => e !== null);

    if (DRY_RUN) {
        console.log('[scraper] DRY RUN — would upsert the following events:');
        for (const event of dbEvents) {
            console.log(`  • [${event.source_type}] ${event.title.slice(0, 80)}`);
            if (event.latitude) console.log(`    📍 ${event.location_name} (${event.latitude.toFixed(3)}, ${event.longitude!.toFixed(3)})`);
        }
        console.log(`[scraper] DRY RUN complete — ${dbEvents.length} events would have been upserted.`);
        return;
    }

    console.log(`[scraper] Upserting ${dbEvents.length} events into Supabase...`);

    // Chunk upserts to stay under request size limits and provide better error isolation
    const UPSERT_CHUNK_SIZE = 50;
    let totalUpserted = 0;

    for (let i = 0; i < dbEvents.length; i += UPSERT_CHUNK_SIZE) {
        const chunk = dbEvents.slice(i, i + UPSERT_CHUNK_SIZE);
        const { data: upserted, error: upsertError } = await supabase
            .from('events')
            .upsert(chunk, { onConflict: 'url', ignoreDuplicates: true })
            .select('id');

        if (upsertError) {
            console.error(`[scraper] Chunk upsert failed at index ${i}:`, upsertError.message);
            
            // If the chunk failed, try individual rows to find the offender
            console.log(`[scraper] Attempting individual upserts for failed chunk to isolate error...`);
            for (const event of chunk) {
                const { error: singleError } = await supabase
                    .from('events')
                    .upsert([event], { onConflict: 'url', ignoreDuplicates: true });
                
                if (singleError) {
                    console.error('[scraper] Individual upsert failed for URL:', event.url);
                    console.error('[scraper] Error:', singleError.message);
                    console.error('[scraper] Full payload:', JSON.stringify(event, (key, value) => 
                        typeof value === 'number' && !Number.isFinite(value) ? 'SERIALIZATION_ERROR_NOT_FINITE' : value
                    , 2));
                } else {
                    totalUpserted++;
                }
            }
        } else {
            totalUpserted += upserted?.length ?? chunk.length;
        }
    }

    const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);
    console.log(`[scraper] ✓ Finished ingestion in ${elapsed}s. Total events successfully handled: ${totalUpserted}`);
}

// entry point
run().catch(err => {
    console.error('[scraper] Unhandled error:', err);
    process.exit(1);
});
