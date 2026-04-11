/*
Seraphim Scraper — dry-run test
══════════════════════════════════════════════════════════════════════════════

Tests the full scraper pipeline WITHOUT writing anything to the database.
Fetches data from all sources, runs geocoding, and prints the proposed upsert
payload so you can visually inspect the output.

Run with:
    bun run scripts/test-scraper.ts

Required env vars (loaded from .env.local by Bun automatically):
    SUPABASE_URL               – needed only for the URL deduplication check
    SUPABASE_SERVICE_ROLE_KEY  – needed only for the URL deduplication check
    GNEWS_API_KEY              – optional; GNews is skipped when absent
*/

import { createClient } from '@supabase/supabase-js';
import { fetchAllRSSFeeds, fetchAllRedditFeeds } from '../src/scraper/fetchers/rss';
import { fetchGNews, fetchOSINTGNews } from '../src/scraper/fetchers/gnews';
import { fetchSocialFeeds } from '../src/scraper/fetchers/social-feeds';
import { enrichItemsWithLocation } from '../src/scraper/fetchers/geocoding';
import type { NewsItem } from '../src/lib/types';
import type { DbEvent } from '../src/types';

// ─── Supabase (read-only for dedup check) ─────────────────────────────────────
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
    process.exit(1);
}

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
        tags: item.tags,
    };
}

async function run() {
    const startMs = Date.now();
    console.log('═══════════════════════════════════════════════════════');
    console.log('  Seraphim Scraper — DRY RUN TEST');
    console.log('  No data will be written to the database.');
    console.log('═══════════════════════════════════════════════════════\n');

    // Step 1: Fetch raw items
    console.log('Step 1/4 — Fetching raw items from all sources...\n');
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
    console.log(`  ─────────────────────────────`);
    console.log(`  Total raw:     ${rawItems.length} items\n`);

    const itemsWithUrl = rawItems.filter(i => !!i.url);

    // Step 2: Dedup check
    console.log('Step 2/4 — Checking Supabase for known URLs...');
    const incomingUrls = itemsWithUrl.map(i => i.url);
    const { data: existingRows } = await supabase
        .from('events')
        .select('url')
        .in('url', incomingUrls);

    const knownUrls = new Set((existingRows ?? []).map((r: { url: string }) => r.url));
    const newItems = itemsWithUrl.filter(item => !knownUrls.has(item.url));
    console.log(`  Known in DB:   ${knownUrls.size} URLs`);
    console.log(`  New to ingest: ${newItems.length} items\n`);

    // Step 3: Geocode
    console.log('Step 3/4 — Running geocoding on new items...');
    const enriched = await enrichItemsWithLocation(newItems);
    const geocodedCount = enriched.filter(i => i.latitude !== undefined).length;
    console.log(`  Geocoded:      ${geocodedCount}/${enriched.length} items\n`);

    // Step 4: Print proposed payload
    const dbEvents: DbEvent[] = enriched
        .map(newsItemToDbEvent)
        .filter((e): e is DbEvent => e !== null);

    console.log(`Step 4/4 — Proposed upsert payload (${dbEvents.length} events):`);
    console.log('─────────────────────────────────────────────────────────\n');

    for (const event of dbEvents) {
        const locationStr = event.latitude
            ? `📍 ${event.location_name ?? '?'} (${event.latitude.toFixed(3)}, ${event.longitude!.toFixed(3)})`
            : '   (no location)';
        console.log(`[${event.source_type.padEnd(6)}] ${event.title.slice(0, 90)}`);
        console.log(`  ${locationStr}`);
        console.log(`  ${event.url.slice(0, 100)}\n`);
    }

    const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);
    console.log('═══════════════════════════════════════════════════════');
    console.log(`  Test complete in ${elapsed}s — ${dbEvents.length} events ready to upsert.`);
    console.log('  No writes performed. Run the scraper directly to ingest:');
    console.log('    bun run src/scraper/index.ts');
    console.log('═══════════════════════════════════════════════════════');
}

run().catch(err => {
    console.error('Test script failed:', err);
    process.exit(1);
});
