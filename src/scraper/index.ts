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
import { fetchGNews } from "@/lib/api/gnews";
import { fetchSocialFeeds } from "@/lib/api/social";
import { enrichItemsWithLocation } from '@/lib/geocoding';
import { NewsItem } from "@/lib/core/types";
import type { DbEvent, DbEventSource } from "@/types";
import { hasUsableCoordinates, newsItemToDbEvent } from "./utils/transforms";
import { calculateMergedStory } from "@/lib/utils/merging";
import {
  generateEmbeddings,
  buildEmbeddingText,
  cosineSimilarity,
  calculateDistance,
  SIMILARITY_THRESHOLD_STRICT,
  SIMILARITY_THRESHOLD_PLACE_ANCHORED,
  SIMILARITY_THRESHOLD_PROXIMITY,
  MAX_MERGE_DISTANCE_KM,
} from "@/lib/utils/vectorize";

const DRY_RUN = process.env.DRY_RUN === "true";

if (!supabase) {
  console.error(
    "[scraper] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.",
  );
  process.exit(1);
}

const db = supabase!;

/*
Fetches events from the last 48 hours that contain vector embeddings.
This window provides a balance between historical context and performance.
*/
async function fetchRecentEmbeddings(): Promise<
  {
    id: string;
    embedding: number[];
    sources: DbEventSource[];
    latitude?: number;
    longitude?: number;
    location_name?: string;
    title: string;
    description?: string;
    credibility_tier: number;
    impact_score: number;
    event_count: number;
    source: string;
    url: string;
    published_at: string;
  }[]
> {
  const since = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

  const { data, error } = await db
    .from("events")
    .select(
      "id, embedding, sources, latitude, longitude, title, description, credibility_tier, impact_score, event_count, source, url, published_at",
    )
    .not("embedding", "is", null)
    .gte("published_at", since);

  if (error) {
    console.error(
      "[scraper] Failed to fetch recent embeddings:",
      error.message,
    );
    return [];
  }

  interface RecentEventRow {
    id: string;
    embedding: string | number[];
    sources: DbEventSource[] | null;
    latitude: number | null;
    longitude: number | null;
    location_name: string | null;
    title: string;
    description: string;
    credibility_tier: number;
    impact_score: number | null;
    event_count: number | null;
    source: string;
    url: string;
    published_at: string;
  }

  const rows = (data ?? []) as unknown as RecentEventRow[];

  return rows
    .filter((r) => r.embedding)
    .map((r) => ({
      id: r.id,
      embedding:
        typeof r.embedding === "string" ? JSON.parse(r.embedding) : r.embedding,
      sources: r.sources ?? [],
      latitude: r.latitude ?? undefined,
      longitude: r.longitude ?? undefined,
      location_name: r.location_name ?? undefined,
      title: r.title,
      description: r.description,
      credibility_tier: r.credibility_tier,
      impact_score: r.impact_score ?? 0,
      event_count: r.event_count ?? 1,
      source: r.source,
      url: r.url,
      published_at: r.published_at,
    }));
}

/*
Resolves semantic merges between new events and existing database records.
Uses a tiered matching strategy:
1. Strict Semantic: High cosine similarity (0.85+) suggests near-identical content.
2. Anchored Place: Moderate similarity (0.75+) combined with exact location name match.
3. Proximity: Lower similarity (0.60+) but within tight geographic distance (50km).
*/
async function resolveStoryMerges(dbEvents: DbEvent[]): Promise<{
  newEvents: DbEvent[];
  merges: Map<
    string,
    {
      sources: DbEventSource[];
      title?: string;
      description?: string;
      source?: string;
      url?: string;
      credibility_tier?: number;
      published_at?: string;
      event_count?: number;
      impact_score?: number;
    }
  >;
}> {
  const newEvents: DbEvent[] = [];
  const merges = new Map<
    string,
    {
      sources: DbEventSource[];
      title?: string;
      description?: string;
      source?: string;
      url?: string;
      credibility_tier?: number;
      published_at?: string;
      event_count?: number;
      impact_score?: number;
    }
  >();

  if (dbEvents.length === 0) {
    return { newEvents, merges };
  }

  console.log(
    `[vectorize] Generating embeddings for ${dbEvents.length} items...`,
  );
  
  const texts = dbEvents.map((event) =>
    buildEmbeddingText(event.title, event.description),
  );
  const startMs = Date.now();

  let embeddings: number[][];
  try {
    embeddings = await generateEmbeddings(texts);
  } catch {
    console.error(
      "[vectorize] Embedding generation failed. Items will be inserted without vectors.",
    );
    return { newEvents: dbEvents, merges };
  }

  console.log(
    `[vectorize] Embeddings generated in ${((Date.now() - startMs) / 1000).toFixed(1)}s`,
  );

  const candidates = await fetchRecentEmbeddings();
  console.log(
    `[vectorize] ${candidates.length} candidates loaded for matching`,
  );

  let mergeCount = 0;

  for (let i = 0; i < dbEvents.length; i++) {
    const event = dbEvents[i];
    const embedding = embeddings[i];

    event.embedding = `[${embedding.join(",")}]`;

    let bestMatchId: string | null = null;
    let highestSim = -1;

    for (const candidate of candidates) {
      const sim = cosineSimilarity(embedding, candidate.embedding);
      let shouldMerge = false;

      if (sim >= SIMILARITY_THRESHOLD_STRICT) {
        shouldMerge = true;
      } else if (
        sim >= SIMILARITY_THRESHOLD_PLACE_ANCHORED &&
        event.location_name &&
        candidate.location_name &&
        event.location_name === candidate.location_name
      ) {
        shouldMerge = true;
      } else if (
        sim >= SIMILARITY_THRESHOLD_PROXIMITY &&
        event.latitude != null &&
        event.longitude != null &&
        candidate.latitude != null &&
        candidate.longitude != null
      ) {
        const dist = calculateDistance(
          event.latitude,
          event.longitude,
          candidate.latitude,
          candidate.longitude,
          );
        if (dist <= MAX_MERGE_DISTANCE_KM) {
          shouldMerge = true;
        }
      }

      if (shouldMerge && sim > highestSim) {
        highestSim = sim;
        bestMatchId = candidate.id;
      }
    }

    if (bestMatchId) {
      const matchedCandidate = candidates.find((c) => c.id === bestMatchId)!;
      const existingMerge = merges.get(bestMatchId);
      
      const storyState = existingMerge 
        ? { ...matchedCandidate, ...existingMerge } 
        : matchedCandidate;

      const sourceExists = matchedCandidate.sources.some(s => s.url === event.url);
      
      if (!sourceExists) {
        const mergedResult = calculateMergedStory(storyState, event);
        
        // Remove ID from the update payload
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { id: _id, ...mergeData } = mergedResult;
        merges.set(bestMatchId, mergeData);
        mergeCount++;
      } else {
        // Refresh timestamp if the incoming item is newer than the stored version
        const incomingTime = new Date(event.published_at).getTime();
        const currentPubTime = new Date(storyState.published_at).getTime();
        if (incomingTime > currentPubTime) {
          if (existingMerge) {
            existingMerge.published_at = event.published_at;
          } else {
            merges.set(bestMatchId, {
              sources: matchedCandidate.sources,
              published_at: event.published_at,
              event_count: matchedCandidate.event_count || matchedCandidate.sources.length,
              impact_score: matchedCandidate.impact_score || 0
            });
          }
        }
      }
    } else {
      newEvents.push(event);
    }
  }
  console.log(
    `[vectorize] Story resolution: ${mergeCount} merged, ${newEvents.length} new events`,
  );
  return { newEvents, merges };
}

interface BulkIngestResult {
  upserted_count: number;
  merged_count: number;
}

function isVectorTypeMissingError(message?: string | null): boolean {
  return /type\s+"vector"\s+does not exist/i.test(message ?? "");
}

function stripEmbedding(event: DbEvent): Omit<DbEvent, "embedding"> {
  // Keep inserts compatible when pgvector is unavailable.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { embedding: _embedding, ...eventWithoutEmbedding } = event;
  return eventWithoutEmbedding;
}

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
      fetchGNews("general", 20),
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

  const itemsWithUrl = rawItems.filter((item) => !!item.url);

  /*
    Deep Deduplication:
    Uses the check_urls_exist RPC to scan both primary 'url' columns and 
    nested 'sources' JSONB arrays. This prevents duplication of articles
    that were previously merged into larger stories.
  */
  console.log(
    "[scraper] Running deep deduplication check...",
  );
  const incomingUrls = itemsWithUrl.map((i) => i.url);
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

  const newItems = itemsWithUrl.filter((item) => !knownUrls.has(item.url));
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
  const { newEvents, merges } = await resolveStoryMerges(dbEvents);

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

  const CHUNK_SIZE = 15;
  
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

  type MergePayloadEntry = (typeof mergePayload)[number];
  async function ingestSequentially(
    eChunk: DbEvent[],
    mChunk: MergePayloadEntry[],
    omitEmbedding: boolean,
  ): Promise<void> {
    for (const merge of mChunk) {
      const { error: mErr } = await db
        .from("events")
        .update(merge as Partial<DbEvent>)
        .eq("id", merge.id);
      if (!mErr) {
        merged_count++;
      } else {
        console.error("[scraper] Sequential merge failed:", mErr.message);
      }
    }

    for (const event of eChunk) {
      let payload: Partial<DbEvent> = omitEmbedding
        ? stripEmbedding(event)
        : event;
      let { error: iErr } = await db.from("events").insert(payload);

      if (
        iErr &&
        !omitEmbedding &&
        isVectorTypeMissingError(iErr.message)
      ) {
        vectorTypeUnavailable = true;
        payload = stripEmbedding(event);
        ({ error: iErr } = await db.from("events").insert(payload));
      }

      if (!iErr) {
        upserted_count++;
      } else {
        console.error("[scraper] Sequential insert failed:", iErr.message);
      }
    }
  }

  try {
    for (let i = 0; i < numChunks; i++) {
      const eChunk = eventChunks[i] || [];
      const mChunk = mergeChunks[i] || [];
      
      console.log(`[scraper] Processing chunk ${i + 1}/${numChunks} (${eChunk.length} events, ${mChunk.length} merges)...`);

      if (vectorTypeUnavailable) {
        await ingestSequentially(eChunk, mChunk, false);
        continue;
      }

      const { data: ingestResult, error: ingestError } = await db.rpc('bulk_ingest_events', {
        p_new_events: eChunk,
        p_merges: mChunk
      });

      if (ingestError) {
        const isTimeout = ingestError.message?.includes('timeout') || ingestError.message?.includes('canceling statement');
        
        if (isTimeout) {
          console.warn(`[scraper] Chunk ${i + 1} RPC timed out. Executing sequential fallback...`);
          await ingestSequentially(eChunk, mChunk, false);
        } else if (isVectorTypeMissingError(ingestError.message)) {
          vectorTypeUnavailable = true;
          console.warn(
            `[scraper] pgvector type is unavailable. Falling back to sequential ingestion from chunk ${i + 1}.`,
          );
          await ingestSequentially(eChunk, mChunk, false);
        } else {
          throw new Error(`Bulk ingestion failed on chunk ${i + 1}: ${ingestError.message}`);
        }
      } else {
        const result = (ingestResult as unknown as BulkIngestResult[])?.[0] || { upserted_count: 0, merged_count: 0 };
        upserted_count += result.upserted_count;
        merged_count += result.merged_count;
      }
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
