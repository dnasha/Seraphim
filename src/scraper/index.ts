/*
Seraphim Scraper
Main ingestion worker for processing news from multiple sources.

Usage:
bun run src/scraper/index.ts

Execution Modes:
- Standard: Fetches, geocodes, vectorizes, and commits to Supabase.
- Dry Run: Set DRY_RUN=true to skip database writes and view proposed payloads.

Requirements:
- SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY for database access.
- GNEWS_API_KEY for GNews integration.
*/

import { supabaseAdmin as supabase } from "@/lib/core/supabase-admin";
import { fetchAllRSSFeeds, fetchAllRedditFeeds } from "@/lib/api/rss";
import { fetchHealthEventGNews } from "@/lib/api/gnews";
import { fetchSocialFeeds } from "@/lib/api/social";
import { enrichItemsWithLocation } from '@/lib/geocoding';
import { NewsItem } from "@/lib/core/types";
import type { DbEvent } from "@/types";
import { hasUsableCoordinates, newsItemToDbEvent } from "./utils/transforms";
import { filterItemsByQuality } from "./utils/quality";
import { prepareIncomingItems } from "./utils/content";
import { applySourceNoveltyLimits, loadSourceNoveltyLimits } from "./sourceBudget";
import { resolveStoryMerges } from "./merger";
import {
  ingestSequentially,
  isVectorTypeMissingError,
  BulkIngestResult
} from "./dbIngest";

const DRY_RUN = process.env.DRY_RUN === "true";

if (!supabase) {
  console.error(
    "[scraper] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.",
  );
  process.exit(1);
}

const db = supabase!;



/* 
Main execution pipeline:
1. Fetch from RSS, GNews, Reddit, and social feeds.
2. Deduplicate against existing primary and merged URLs.
3. Geocode new items using NLP heuristics.
4. Resolve semantic clusters to merge related stories.
5. Ingest results via bulk RPC with sequential fallback.
*/
async function run(): Promise<void> {
  const startMs = Date.now();
  console.log(
    `[scraper] Starting ingestion run at ${new Date().toISOString()} (dry_run=${DRY_RUN})`,
  );

  const [rssItems, redditItems, gnewsItems, socialItems] =
    (await Promise.allSettled([
      fetchAllRSSFeeds(),
      fetchAllRedditFeeds(),
      fetchHealthEventGNews(20),
      fetchSocialFeeds(),
    ]).then((results) =>
      results.map((r) => (r.status === "fulfilled" ? r.value : [])),
    )) as [NewsItem[], NewsItem[], NewsItem[], NewsItem[]];

  const rawItems: NewsItem[] = [
    ...rssItems,
    ...redditItems,
    ...gnewsItems,
    ...socialItems,
  ];

  console.log(
    `[scraper] Raw items fetched: ${rawItems.length} (rss=${rssItems.length}, reddit=${redditItems.length}, gnews=${gnewsItems.length}, social=${socialItems.length})`,
  );

  const itemsWithUrl = prepareIncomingItems(rawItems.filter((item) => !!item.url));
  const { accepted: qualityItems, rejectedByReason } =
    filterItemsByQuality(itemsWithUrl);
  const rejectedQualityCount = itemsWithUrl.length - qualityItems.length;
  if (rejectedQualityCount > 0) {
    console.log(
      `[scraper] Quality gate rejected ${rejectedQualityCount} item(s) ` +
        `(irrelevant_section=${rejectedByReason.irrelevant_section}, ` +
        `insubstantial_description=${rejectedByReason.insubstantial_description}, ` +
        `clearly_non_event=${rejectedByReason.clearly_non_event}).`,
    );
  }

  /*
    Deep Deduplication:
    Uses the check_urls_exist RPC to scan both primary 'url' columns and 
    nested 'sources' JSONB arrays. This prevents duplication of articles
    that were previously merged into larger stories.
  */
  console.log(
    "[scraper] Running deep deduplication check...",
  );
  const incomingUrls = qualityItems.map((i) => i.url);
  const knownUrls = new Set<string>();
  const DEDUPE_CHUNK_SIZE = 1000;
  const dedupePromises = [];

  for (let i = 0; i < incomingUrls.length; i += DEDUPE_CHUNK_SIZE) {
    const chunk = incomingUrls.slice(i, i + DEDUPE_CHUNK_SIZE);
    dedupePromises.push(db.rpc("check_urls_exist", {
      p_urls: chunk,
    }));
  }

  const dedupeResults = await Promise.all(dedupePromises);
  dedupeResults.forEach((res, i) => {
    if (res.error) {
      console.error(
        `[scraper] Deduplication check failed for chunk ${i + 1}:`,
        res.error.message,
      );
    } else if (res.data) {
      res.data.forEach((r: { existing_url: string }) =>
        knownUrls.add(r.existing_url),
      );
    }
  });

  const unseenItems = qualityItems.filter((item) => !knownUrls.has(item.url));
  const sourceLimits = await loadSourceNoveltyLimits(db);
  const { accepted: newItems, cappedBySource } = applySourceNoveltyLimits(unseenItems, sourceLimits);
  const cappedCount = Object.values(cappedBySource).reduce((sum, count) => sum + count, 0);
  if (cappedCount > 0) {
    console.warn(`[scraper] Adaptive source safety cap deferred ${cappedCount} item(s):`, cappedBySource);
  }
  console.log(`[scraper] New items to process: ${newItems.length}`);

  if (newItems.length === 0) {
    console.log("[scraper] No new items. Exiting.");
    return;
  }

  console.log("[scraper] Running NLP geocoding...");
  const enrichedItems = await enrichItemsWithLocation(newItems);

  const geocodedCount = enrichedItems.filter(hasUsableCoordinates).length;
  console.log(
    `[scraper] Geocoding complete: ${geocodedCount}/${enrichedItems.length} items mapped`,
  );

  // Seraphim is a map-first product. Do not let unlocated items enter either
  // semantic merging or the bulk-insert payload, where they could otherwise
  // become durable unmapped events.
  const mappedItems = enrichedItems.filter(hasUsableCoordinates);
  const skippedUnmappedCount = enrichedItems.length - mappedItems.length;
  if (skippedUnmappedCount > 0) {
    console.log(
      `[scraper] Skipping ${skippedUnmappedCount} item(s) without usable coordinates.`,
    );
  }

  if (mappedItems.length === 0) {
    console.log("[scraper] No mapped items to ingest. Exiting.");
    return;
  }

  const dbEvents: DbEvent[] = mappedItems
    .map(newsItemToDbEvent)
    .filter((e): e is DbEvent => e !== null);

  console.log("[scraper] Running semantic vectorization...");
  const { newEvents, merges } = await resolveStoryMerges(dbEvents, db);

  if (DRY_RUN) {
    console.log("[scraper] DRY RUN Proposed Events:");
    for (const event of newEvents) {
      console.log(`  * [${event.source_type}] ${event.title.slice(0, 80)}`);
    }
    console.log(
      `[scraper] DRY RUN Summary: ${newEvents.length} new events, ${merges.size} merges`,
    );
    return;
  }

  /*
    Bulk Ingestion:
    Attempts to process all updates and inserts in a single RPC transaction.
    If the transaction times out (typically due to complex spatial/vector index updates),
    it falls back to individual processing to ensure data consistency.
  */
  console.log(`[scraper] Ingesting ${newEvents.length} new events and ${merges.size} merges in chunks...`);
  
  const mergePayload = Array.from(merges.entries()).map(([id, data]) => ({
    id,
    ...data
  }));

  let upserted_count = 0;
  let merged_count = 0;

  // Use a useful bulk size on the normal path. If index maintenance or database
  // pressure makes a batch time out, the batch is bisected before falling back
  // to per-row writes so one slow transaction does not penalize every run.
  const CHUNK_SIZE = 25;
  const MIN_SPLIT_SIZE = 5;
  
  const eventChunks = [];
  for (let i = 0; i < newEvents.length; i += CHUNK_SIZE) {
    eventChunks.push(newEvents.slice(i, i + CHUNK_SIZE));
  }
  if (eventChunks.length === 0) eventChunks.push([]);

  const mergeChunks = [];
  for (let i = 0; i < mergePayload.length; i += CHUNK_SIZE) {
    mergeChunks.push(mergePayload.slice(i, i + CHUNK_SIZE));
  }
  if (mergeChunks.length === 0) mergeChunks.push([]);

  const numChunks = Math.max(eventChunks.length, mergeChunks.length);
  let vectorTypeUnavailable = false;

  const processIngestChunk = async (
    eChunk: DbEvent[],
    mChunk: typeof mergePayload,
    label: string,
  ): Promise<void> => {
    if (vectorTypeUnavailable) {
      const fallback = await ingestSequentially(db, eChunk, mChunk, false, true);
      upserted_count += fallback.upserted_count;
      merged_count += fallback.merged_count;
      vectorTypeUnavailable = fallback.vectorTypeUnavailable;
      return;
    }

    const { data: ingestResult, error: ingestError } = await db.rpc('bulk_ingest_events', {
      p_new_events: eChunk,
      p_merges: mChunk,
    });

    if (!ingestError) {
      const result = (ingestResult as unknown as BulkIngestResult[])?.[0] || { upserted_count: 0, merged_count: 0 };
      upserted_count += result.upserted_count;
      merged_count += result.merged_count;
      return;
    }

    const isTimeout = ingestError.message?.includes('timeout') || ingestError.message?.includes('canceling statement');
    if (isVectorTypeMissingError(ingestError.message)) {
      vectorTypeUnavailable = true;
      console.warn(`[scraper] pgvector type is unavailable in ${label}. Using sequential ingestion without vectors.`);
      const fallback = await ingestSequentially(db, eChunk, mChunk, false, true);
      upserted_count += fallback.upserted_count;
      merged_count += fallback.merged_count;
      return;
    }

    const largestChunk = Math.max(eChunk.length, mChunk.length);
    if (isTimeout && largestChunk > MIN_SPLIT_SIZE) {
      const eventMid = Math.ceil(eChunk.length / 2);
      const mergeMid = Math.ceil(mChunk.length / 2);
      console.warn(`[scraper] ${label} timed out; retrying as smaller batches.`);
      await processIngestChunk(eChunk.slice(0, eventMid), mChunk.slice(0, mergeMid), `${label}.1`);
      await processIngestChunk(eChunk.slice(eventMid), mChunk.slice(mergeMid), `${label}.2`);
      return;
    }

    if (isTimeout) {
      console.warn(`[scraper] ${label} timed out at minimum batch size. Executing sequential fallback.`);
      const fallback = await ingestSequentially(db, eChunk, mChunk, false, vectorTypeUnavailable);
      upserted_count += fallback.upserted_count;
      merged_count += fallback.merged_count;
      vectorTypeUnavailable = fallback.vectorTypeUnavailable;
      return;
    }

    throw new Error(`Bulk ingestion failed in ${label}: ${ingestError.message}`);
  };

  try {
    for (let i = 0; i < numChunks; i++) {
      const eChunk = eventChunks[i] || [];
      const mChunk = mergeChunks[i] || [];
      
      console.log(`[scraper] Processing chunk ${i + 1}/${numChunks} (${eChunk.length} events, ${mChunk.length} merges)...`);

      await processIngestChunk(eChunk, mChunk, `chunk ${i + 1}/${numChunks}`);
    }
  } catch (err) {
    console.error('[scraper] Ingestion error:', err instanceof Error ? err.message : String(err));
  }

  const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);
  console.log(
    `[scraper] Finished in ${elapsed}s. Upserted: ${upserted_count}, Merged: ${merged_count}`,
  );
}

run().catch((err) => {
  console.error("[scraper] Unhandled error:", err);
  process.exit(1);
});
