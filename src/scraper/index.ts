/*
Seraphim Scraper - Main ingestion worker

Local execution:
bun run src/scraper/index.ts

Dry run (no database writes, prints payload):
DRY_RUN=true bun run src/scraper/index.ts

Environment variables:
SUPABASE_URL: Supabase project URL
SUPABASE_SERVICE_ROLE_KEY: Service-role key for bypassing RLS
GNEWS_API_KEY: Optional API key for GNews.io

Pipeline:
1. Fetch raw items from RSS, GNews, Reddit, and social channels.
2. Pre-fetch known URLs from database to avoid redundant processing.
3. Filter out existing items.
4. Geocode new items via the local NLP engine.
5. Generate semantic embeddings (all-MiniLM-L6-v2, local ONNX).
6. Match against recent events — merge if similarity > 0.85 (Story model).
7. Upsert new events and update merged stories in Supabase.
*/

import { supabaseAdmin as supabase } from "@/lib/core/supabase";
import { fetchAllRSSFeeds, fetchAllRedditFeeds } from "@/lib/api/rss";
import { fetchGNews } from "@/lib/api/gnews";
import { fetchSocialFeeds } from "@/lib/api/social";
import { enrichItemsWithLocation } from '@/lib/geocoding';
import { NewsItem } from "@/lib/core/types";
import type { DbEvent, DbEventSource } from "@/types";
import { newsItemToDbEvent } from "./utils/transforms";
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

/* Configuration */

const DRY_RUN = process.env.DRY_RUN === "true";

if (!supabase) {
  console.error(
    "[scraper] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.",
  );
  process.exit(1);
}

const db = supabase!;

/* ─── Semantic Merge Logic ─── */

/*
Fetches recent events that already have embeddings from Supabase.
Only pulls id, embedding, sources, latitude, and longitude.
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
Applies the Story merge logic with Spatial gating:
  1. Strict Match: Similarity > 0.85 (always merge)
  2. Proximity Match: Similarity > 0.60 AND distance < 50km
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
  /* 
       CRITICAL FIX: We build texts from dbEvents directly to ensure 1:1 alignment 
       with the items we are assigning embeddings to. 
    */
  const texts = dbEvents.map((event) =>
    buildEmbeddingText(event.title, event.description),
  );
  const startMs = Date.now();

  let embeddings: number[][];
  try {
    embeddings = await generateEmbeddings(texts);
  } catch (err) {
    console.error(
      "[vectorize] FATAL: Embedding generation failed. Items will be inserted without vectors.",
    );
    console.error(
      "[vectorize] Error details:",
      err instanceof Error ? err.message : String(err),
    );
    return { newEvents: dbEvents, merges };
  }

  console.log(
    `[vectorize] Embeddings generated in ${((Date.now() - startMs) / 1000).toFixed(1)}s`,
  );

  const candidates = await fetchRecentEmbeddings();
  console.log(
    `[vectorize] ${candidates.length} recent candidates loaded for similarity matching`,
  );

  let mergeCount = 0;

  for (let i = 0; i < dbEvents.length; i++) {
    const event = dbEvents[i];
    const embedding = embeddings[i];

    event.embedding = `[${embedding.join(",")}]`;

    /* Find best match among candidates */
    let bestMatchId: string | null = null;
    let highestSim = -1;

    for (const candidate of candidates) {
      const sim = cosineSimilarity(embedding, candidate.embedding);

      let shouldMerge = false;

      // Strategy 1: Strict semantic (highly identical text)
      if (sim >= SIMILARITY_THRESHOLD_STRICT) {
        shouldMerge = true;
      }
      // Strategy 1.5: Place Name Anchoring (exact location name match)
      else if (
        sim >= SIMILARITY_THRESHOLD_PLACE_ANCHORED &&
        event.location_name &&
        candidate.location_name &&
        event.location_name === candidate.location_name
      ) {
        shouldMerge = true;
      }
      // Strategy 2: Proximity semantic (related text in same location)
      else if (
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
      
      // Use the helper to calculate the new merged state
      const storyState = existingMerge 
        ? { ...matchedCandidate, ...existingMerge } 
        : matchedCandidate;

      const sourceExists = matchedCandidate.sources.some(s => s.url === event.url);
      
      if (!sourceExists) {
        const mergedResult = calculateMergedStory(storyState, event);
        
        // Update the merges map (we omit 'id' as it's the key)
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { id: _id, ...mergeData } = mergedResult;
        merges.set(bestMatchId, mergeData);
        mergeCount++;
      } else {
        // Source exists, handle potential timestamp refresh if article updated
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

/*
Applies source merges to existing events in Supabase.
Each merge is a single UPDATE setting the expanded sources array.
Batched into individual updates to avoid complex SQL.
*/
/*
Removed applyMerges in favor of bulk_ingest_events RPC 
*/

interface BulkIngestResult {
  upserted_count: number;
  merged_count: number;
}

/* ─── Main Pipeline ─── */

async function run(): Promise<void> {
  const startMs = Date.now();
  console.log(
    `[scraper] Starting ingestion run at ${new Date().toISOString()} (dry_run=${DRY_RUN})`,
  );

  // Step 1: Fetch raw items from all configured sources
  console.log("[scraper] Fetching raw items from all sources...");
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

  // Validate that items have URLs as they are required for the conflict key
  const itemsWithUrl = rawItems.filter((item) => !!item.url);

  // Step 2: Pre-fetch known URLs from database to skip redundant processing
  console.log(
    "[scraper] Fetching recent known URLs from Supabase (Deep Deduplication)...",
  );
  const incomingUrls = itemsWithUrl.map((i) => i.url);

  /*
    We use the check_urls_exist RPC to check both the 'url' column and 
    the 'sources' JSONB array. This prevents duplicating items that 
    have already been merged into other stories.
    */
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
        `[scraper] Deep deduplication check failed for chunk ${i + 1}:`,
        res.error.message,
      );
    } else if (res.data) {
      res.data.forEach((r: { existing_url: string }) =>
        knownUrls.add(r.existing_url),
      );
    }
  });

  console.log(`[scraper] Known URLs (Primary + Merged): ${knownUrls.size}`);

  // Step 3: Filter for new items only
  const newItems = itemsWithUrl.filter((item) => !knownUrls.has(item.url));
  console.log(`[scraper] New items to process: ${newItems.length}`);

  if (newItems.length === 0) {
    console.log("[scraper] No new items. Exiting.");
    return;
  }

  // Step 4: Extract geographic data from new items
  console.log("[scraper] Running NLP geocoding on new items...");
  const enrichedItems = await enrichItemsWithLocation(newItems);

  const geocodedCount = enrichedItems.filter((i) => i.latitude != null).length;
  console.log(
    `[scraper] Geocoding complete: ${geocodedCount}/${enrichedItems.length} items mapped`,
  );

  // Step 5: Convert items to database schema
  const dbEvents: DbEvent[] = enrichedItems
    .map(newsItemToDbEvent)
    .filter((e): e is DbEvent => e !== null);

  // Step 6: Vectorize and resolve story merges
  console.log("[scraper] Running semantic vectorization pipeline...");
  const { newEvents, merges } = await resolveStoryMerges(dbEvents);

  if (DRY_RUN) {
    console.log("[scraper] DRY RUN — would upsert the following events:");
    for (const event of newEvents) {
      console.log(`  * [${event.source_type}] ${event.title.slice(0, 80)}`);
      if (event.latitude)
        console.log(
          `    Location: ${event.location_name} (${event.latitude.toFixed(3)}, ${event.longitude!.toFixed(3)})`,
        );
      if (event.embedding) {
        const embStr =
          typeof event.embedding === "string"
            ? event.embedding
            : JSON.stringify(event.embedding);
        console.log(`    Embedding: [${embStr.slice(0, 40)}...]`);
      }
    }
    console.log(
      `[scraper] DRY RUN — ${newEvents.length} new events, ${merges.size} story merges`,
    );
    return;
  }

  // Step 7: Bulk Ingest (Updates + Upserts) in a single RPC call
  console.log(`[scraper] Ingesting ${newEvents.length} new events and ${merges.size} merges via RPC...`);
  
  const mergePayload = Array.from(merges.entries()).map(([id, data]) => ({
    id,
    ...data
  }));

  let upserted_count = 0;
  let merged_count = 0;

  try {
    const { data: ingestResult, error: ingestError } = await db.rpc('bulk_ingest_events', {
      p_new_events: newEvents,
      p_merges: mergePayload
    });

    if (ingestError) {
      const isTimeout = ingestError.message?.includes('timeout') || ingestError.message?.includes('canceling statement');
      
      if (isTimeout) {
        console.warn('[scraper] Bulk ingestion RPC timed out. Falling back to sequential ingestion...');
        
        // Fallback: Process merges individually
        for (const merge of mergePayload) {
          const { error: mErr } = await db
            .from('events')
            .update(merge as Partial<DbEvent>)
            .eq('id', merge.id);
          if (!mErr) {
            merged_count++;
          } else {
            console.error(`[scraper] Individual merge failed for ${merge.id}:`, mErr.message);
          }
        }

        // Fallback: Process new events individually
        for (const event of newEvents) {
          const { error: iErr } = await db
            .from('events')
            .insert(event);
          if (!iErr) {
            upserted_count++;
          } else if (!iErr.message.includes('duplicate key')) {
            console.error(`[scraper] Individual insertion failed for ${event.url}:`, iErr.message);
          }
        }
      } else {
        console.error('[scraper] Bulk ingestion RPC failed:', ingestError.message);
        throw new Error(`Bulk ingestion failed: ${ingestError.message}`);
      }
    } else {
      const result = (ingestResult as unknown as BulkIngestResult[])?.[0] || { upserted_count: 0, merged_count: 0 };
      upserted_count = result.upserted_count;
      merged_count = result.merged_count;
    }
  } catch (err) {
    if (err instanceof Error && (err.message.includes('timeout') || err.message.includes('canceling statement'))) {
       // already handled or logged above, but just in case of fetch-level timeout
       console.error('[scraper] Ingestion network/timeout error:', err.message);
    } else {
       throw err;
    }
  }

  const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);
  console.log(
    `[scraper] Finished ingestion in ${elapsed}s. Events upserted: ${upserted_count}, Stories merged: ${merged_count}`,
  );
}

// Process entry point
run().catch((err) => {
  console.error("[scraper] Unhandled error:", err);
  process.exit(1);
});
