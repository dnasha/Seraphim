import type { SupabaseClient } from "@supabase/supabase-js";
import type { DbEvent, DbEventSource } from "@/types";
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

/*
Fetches events from the last 48 hours that contain vector embeddings.
This window provides a balance between historical context and performance.
*/
export async function fetchRecentEmbeddings(db: SupabaseClient): Promise<
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
export async function resolveStoryMerges(
  dbEvents: DbEvent[],
  db: SupabaseClient
): Promise<{
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

  const candidates = await fetchRecentEmbeddings(db);
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
