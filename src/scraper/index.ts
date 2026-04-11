/*
Dan Sharan

Seraphim Scraper — main ingestion worker
═══════════════════════════════════════════════════════════════════════════════

Run locally:
    bun run src/scraper/index.ts

Dry-run (no DB writes, prints payload instead):
    DRY_RUN=true bun run src/scraper/index.ts

Environment variables (loaded from .env.local by Bun automatically):
    SUPABASE_URL               – Supabase project URL
    SUPABASE_SERVICE_ROLE_KEY  – Service-role key (bypasses RLS for writes)
    GNEWS_API_KEY              – GNews.io API key (optional; skipped when absent)

Pipeline:
    1. Fetch raw items from RSS feeds, GNews, Reddit, and social channels.
    2. Pre-fetch recent event URLs from Supabase to avoid redundant NLP/geocoding.
    3. Filter out already-ingested URLs (deduplication guard).
    4. Geocode remaining items using the local NLP engine.
    5. Upsert events into Supabase (conflict key: `url`).
═══════════════════════════════════════════════════════════════════════════════
*/

import { createClient } from '@supabase/supabase-js';
import { fetchAllRSSFeeds, fetchAllRedditFeeds } from './fetchers/rss';
import { fetchGNews, fetchOSINTGNews } from './fetchers/gnews';
import { fetchSocialFeeds } from './fetchers/social-feeds';
import { enrichItemsWithLocation } from './fetchers/geocoding';
import type { NewsItem } from '@/lib/types';
import type { DbEvent } from '@/types';

// ─── Config ───────────────────────────────────────────────────────────────────

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

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Convert a scraped NewsItem into a Supabase-ready DbEvent row.
 * Items without a URL are dropped (URL is the UNIQUE conflict key).
 */
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

// ─── Main pipeline ────────────────────────────────────────────────────────────

async function run(): Promise<void> {
    const startMs = Date.now();
    console.log(`[scraper] Starting ingestion run at ${new Date().toISOString()} (dry_run=${DRY_RUN})`);

    // ── Step 1: Fetch raw items from all sources ──────────────────────────────
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

    // ── Step 2: Pre-fetch known URLs from DB to skip redundant geocoding ──────
    console.log('[scraper] Fetching recent known URLs from Supabase...');
    const incomingUrls = itemsWithUrl.map(i => i.url);

    // Supabase in() operator has a limit; batch if needed (usually fine for ~200 URLs)
    const { data: existingRows, error: selectError } = await supabase
        .from('events')
        .select('url')
        .in('url', incomingUrls);

    if (selectError) {
        console.error('[scraper] Failed to pre-fetch known URLs:', selectError.message);
        // Non-fatal: continue without deduplication guard (upsert will handle conflicts)
    }

    const knownUrls = new Set((existingRows ?? []).map((r: { url: string }) => r.url));
    console.log(`[scraper] Known URLs in DB: ${knownUrls.size}`);

    // ── Step 3: Filter out already-processed items ────────────────────────────
    const newItems = itemsWithUrl.filter(item => !knownUrls.has(item.url));
    console.log(`[scraper] New items to process: ${newItems.length}`);

    if (newItems.length === 0) {
        console.log('[scraper] No new items. Exiting.');
        return;
    }

    // ── Step 4: Geocode new items ─────────────────────────────────────────────
    console.log('[scraper] Running NLP geocoding on new items...');
    const enrichedItems = await enrichItemsWithLocation(newItems);

    const geocodedCount = enrichedItems.filter(i => i.latitude !== undefined).length;
    console.log(`[scraper] Geocoding complete: ${geocodedCount}/${enrichedItems.length} items mapped`);

    // ── Step 5: Build DB rows and upsert ─────────────────────────────────────
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
    const { data: upserted, error: upsertError } = await supabase
        .from('events')
        .upsert(dbEvents, { onConflict: 'url', ignoreDuplicates: true })
        .select('id');

    if (upsertError) {
        console.error('[scraper] Upsert failed:', upsertError.message);
        process.exit(1);
    }

    const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);
    console.log(`[scraper] ✓ Upserted ${upserted?.length ?? dbEvents.length} new event(s) in ${elapsed}s`);
}

// ─── Entry point ──────────────────────────────────────────────────────────────
run().catch(err => {
    console.error('[scraper] Unhandled error:', err);
    process.exit(1);
});
