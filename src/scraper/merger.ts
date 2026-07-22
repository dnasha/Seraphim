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
import { canonicalizeEventUrl, normalizeTitleFingerprint } from "./utils/content";

const RECENT_WINDOW_MS = 48 * 60 * 60 * 1000;
const VECTOR_QUERY_CHUNK_SIZE = 100;
const VECTOR_CANDIDATE_LIMIT = 12;
const DETAIL_QUERY_CHUNK_SIZE = 100;

interface CandidateDetail {
  id: string;
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
  source_type: DbEvent["source_type"];
  url: string;
  image_url?: string;
  published_at: string;
}

interface VectorCandidateRow {
  query_index: number;
  event_id: string;
  similarity: number;
  latitude: number | null;
  longitude: number | null;
  location_name: string | null;
}

interface FallbackCandidate extends CandidateDetail {
  embedding: number[];
  fingerprint: string;
}

async function fetchRecentTitles(
  db: SupabaseClient,
  since: string,
): Promise<Array<{ id: string; title: string; published_at: string }>> {
  const { data, error } = await db
    .from("events")
    .select("id, title, published_at")
    .gte("published_at", since)
    .order("published_at", { ascending: false });

  if (error) {
    throw new Error(`Recent title lookup failed: ${error.message}`);
  }

  return (data ?? []) as Array<{ id: string; title: string; published_at: string }>;
}

async function fetchIndexedVectorCandidates(
  db: SupabaseClient,
  embeddings: Array<number[] | null>,
  since: string,
): Promise<Map<number, VectorCandidateRow[]>> {
  const result = new Map<number, VectorCandidateRow[]>();
  const queries = embeddings
    .map((embedding, queryIndex) => embedding
      ? { query_index: queryIndex, embedding: `[${embedding.join(",")}]` }
      : null)
    .filter((query): query is { query_index: number; embedding: string } => query !== null);

  for (let offset = 0; offset < queries.length; offset += VECTOR_QUERY_CHUNK_SIZE) {
    const chunk = queries.slice(offset, offset + VECTOR_QUERY_CHUNK_SIZE);
    const { data, error } = await db.rpc("match_recent_event_candidates", {
      p_queries: chunk,
      p_since: since,
      p_limit: VECTOR_CANDIDATE_LIMIT,
    });

    if (error) {
      throw new Error(error.message);
    }

    for (const row of (data ?? []) as VectorCandidateRow[]) {
      const rows = result.get(row.query_index) ?? [];
      rows.push(row);
      result.set(row.query_index, rows);
    }
  }

  return result;
}

async function fetchCandidateDetails(
  db: SupabaseClient,
  ids: string[],
): Promise<Map<string, CandidateDetail>> {
  const details = new Map<string, CandidateDetail>();

  for (let offset = 0; offset < ids.length; offset += DETAIL_QUERY_CHUNK_SIZE) {
    const chunk = ids.slice(offset, offset + DETAIL_QUERY_CHUNK_SIZE);
    const { data, error } = await db
      .from("events")
      .select("id, sources, latitude, longitude, location_name, title, description, credibility_tier, impact_score, event_count, source, source_type, url, image_url, published_at")
      .in("id", chunk);

    if (error) {
      throw new Error(`Matched event detail lookup failed: ${error.message}`);
    }

    for (const row of (data ?? []) as Array<Record<string, unknown>>) {
      const detail: CandidateDetail = {
        id: String(row.id),
        sources: (row.sources as DbEventSource[] | null) ?? [],
        latitude: row.latitude == null ? undefined : Number(row.latitude),
        longitude: row.longitude == null ? undefined : Number(row.longitude),
        location_name: row.location_name == null ? undefined : String(row.location_name),
        title: String(row.title ?? ""),
        description: row.description == null ? undefined : String(row.description),
        credibility_tier: Number(row.credibility_tier) || 3,
        impact_score: Number(row.impact_score) || 0,
        event_count: Number(row.event_count) || 1,
        source: String(row.source ?? ""),
        source_type: row.source_type as DbEvent["source_type"],
        url: String(row.url ?? ""),
        image_url: row.image_url == null ? undefined : String(row.image_url),
        published_at: String(row.published_at ?? ""),
      };
      details.set(detail.id, detail);
    }
  }

  return details;
}

/** Compatibility fallback while older database deployments lack the batch matcher. */
export async function fetchRecentEmbeddings(db: SupabaseClient): Promise<FallbackCandidate[]> {
  const since = new Date(Date.now() - RECENT_WINDOW_MS).toISOString();
  const { data, error } = await db
    .from("events")
    .select("id, embedding, sources, latitude, longitude, location_name, title, description, credibility_tier, impact_score, event_count, source, source_type, url, image_url, published_at")
    .not("embedding", "is", null)
    .gte("published_at", since);

  if (error) {
    console.error("[scraper] Failed to fetch fallback embeddings:", error.message);
    return [];
  }

  return ((data ?? []) as Array<Record<string, unknown>>)
    .filter((row) => row.embedding)
    .map((row) => {
      const title = String(row.title ?? "");
      return {
        id: String(row.id),
        embedding: typeof row.embedding === "string"
          ? JSON.parse(row.embedding)
          : row.embedding as number[],
        sources: (row.sources as DbEventSource[] | null) ?? [],
        latitude: row.latitude == null ? undefined : Number(row.latitude),
        longitude: row.longitude == null ? undefined : Number(row.longitude),
        location_name: row.location_name == null ? undefined : String(row.location_name),
        title,
        fingerprint: normalizeTitleFingerprint(title),
        description: row.description == null ? undefined : String(row.description),
        credibility_tier: Number(row.credibility_tier) || 3,
        impact_score: Number(row.impact_score) || 0,
        event_count: Number(row.event_count) || 1,
        source: String(row.source ?? ""),
        source_type: row.source_type as DbEvent["source_type"],
        url: String(row.url ?? ""),
        image_url: row.image_url == null ? undefined : String(row.image_url),
        published_at: String(row.published_at ?? ""),
      };
    });
}

function candidatePassesMergeThreshold(
  event: DbEvent,
  candidate: Pick<VectorCandidateRow, "similarity" | "latitude" | "longitude" | "location_name">,
): boolean {
  if (candidate.similarity >= SIMILARITY_THRESHOLD_STRICT) return true;
  if (
    candidate.similarity >= SIMILARITY_THRESHOLD_PLACE_ANCHORED &&
    event.location_name && candidate.location_name &&
    event.location_name === candidate.location_name
  ) return true;
  if (
    candidate.similarity >= SIMILARITY_THRESHOLD_PROXIMITY &&
    event.latitude != null && event.longitude != null &&
    candidate.latitude != null && candidate.longitude != null
  ) {
    return calculateDistance(
      event.latitude,
      event.longitude,
      candidate.latitude,
      candidate.longitude,
    ) <= MAX_MERGE_DISTANCE_KM;
  }
  return false;
}

export async function resolveStoryMerges(
  dbEvents: DbEvent[],
  db: SupabaseClient,
): Promise<{
  newEvents: DbEvent[];
  merges: Map<string, {
    sources: DbEventSource[];
    title?: string;
    description?: string;
    source?: string;
    source_type?: DbEvent["source_type"];
    url?: string;
    image_url?: string;
    credibility_tier?: number;
    published_at?: string;
    event_count?: number;
    impact_score?: number;
    expires_at?: string | null;
    primary_discovered_at?: string | null;
  }>;
}> {
  const newEvents: DbEvent[] = [];
  const merges = new Map<string, {
    sources: DbEventSource[];
    title?: string;
    description?: string;
    source?: string;
    source_type?: DbEvent["source_type"];
    url?: string;
    image_url?: string;
    credibility_tier?: number;
    published_at?: string;
    event_count?: number;
    impact_score?: number;
    expires_at?: string | null;
    primary_discovered_at?: string | null;
  }>();

  if (dbEvents.length === 0) return { newEvents, merges };

  console.log(`[vectorize] Generating embeddings for ${dbEvents.length} items...`);
  const texts = dbEvents.map((event) => buildEmbeddingText(event.title, event.description));
  const startMs = Date.now();
  let embeddings: Array<number[] | null>;
  try {
    embeddings = await generateEmbeddings(texts);
  } catch {
    console.error("[vectorize] Embedding generation failed. Exact matching will continue without vectors.");
    embeddings = dbEvents.map(() => null);
  }
  console.log(`[vectorize] Embeddings generated in ${((Date.now() - startMs) / 1000).toFixed(1)}s`);

  for (let index = 0; index < dbEvents.length; index++) {
    const embedding = embeddings[index];
    if (embedding) dbEvents[index].embedding = `[${embedding.join(",")}]`;
  }

  const since = new Date(Date.now() - RECENT_WINDOW_MS).toISOString();
  const eventFingerprints = dbEvents.map((event) => normalizeTitleFingerprint(event.title));
  let titleRows: Array<{ id: string; title: string; published_at: string }> = [];
  try {
    titleRows = await fetchRecentTitles(db, since);
  } catch (error) {
    console.warn("[vectorize] Recent title lookup unavailable:", error instanceof Error ? error.message : error);
  }

  const exactTitleIds = new Map<string, string>();
  for (const row of titleRows) {
    const fingerprint = normalizeTitleFingerprint(row.title);
    if (fingerprint.length >= 24 && !exactTitleIds.has(fingerprint)) {
      exactTitleIds.set(fingerprint, row.id);
    }
  }

  const bestMatchIds: Array<string | null> = dbEvents.map((_, index) => {
    const fingerprint = eventFingerprints[index];
    return fingerprint.length >= 24 ? exactTitleIds.get(fingerprint) ?? null : null;
  });

  let indexedCandidates: Map<number, VectorCandidateRow[]> | null = null;
  let fallbackCandidates: FallbackCandidate[] | null = null;
  try {
    indexedCandidates = await fetchIndexedVectorCandidates(db, embeddings, since);
    console.log(`[vectorize] Indexed candidate lookup completed for ${indexedCandidates.size} item(s)`);
  } catch (error) {
    console.warn(
      "[vectorize] Batch vector matcher unavailable; using compatibility fallback:",
      error instanceof Error ? error.message : error,
    );
    fallbackCandidates = await fetchRecentEmbeddings(db);
    console.log(`[vectorize] ${fallbackCandidates.length} fallback candidates loaded`);
  }

  for (let index = 0; index < dbEvents.length; index++) {
    if (bestMatchIds[index]) continue;
    const event = dbEvents[index];
    const embedding = embeddings[index];
    if (!embedding) continue;

    if (indexedCandidates) {
      let best: VectorCandidateRow | null = null;
      for (const candidate of indexedCandidates.get(index) ?? []) {
        if (!candidatePassesMergeThreshold(event, candidate)) continue;
        if (!best || candidate.similarity > best.similarity) best = candidate;
      }
      bestMatchIds[index] = best?.event_id ?? null;
      continue;
    }

    let bestId: string | null = null;
    let highestSimilarity = -1;
    for (const candidate of fallbackCandidates ?? []) {
      const isExactTitle = eventFingerprints[index].length >= 24 &&
        eventFingerprints[index] === candidate.fingerprint;
      const similarity = cosineSimilarity(embedding, candidate.embedding);
      const passes = isExactTitle || candidatePassesMergeThreshold(event, {
        similarity,
        latitude: candidate.latitude ?? null,
        longitude: candidate.longitude ?? null,
        location_name: candidate.location_name ?? null,
      });
      const score = isExactTitle ? 2 : similarity;
      if (passes && score > highestSimilarity) {
        highestSimilarity = score;
        bestId = candidate.id;
      }
    }
    bestMatchIds[index] = bestId;
  }

  let candidateDetails: Map<string, CandidateDetail>;
  if (fallbackCandidates) {
    candidateDetails = new Map(fallbackCandidates.map((candidate) => [candidate.id, candidate]));
  } else {
    const matchedIds = [...new Set(bestMatchIds.filter((id): id is string => id !== null))];
    candidateDetails = await fetchCandidateDetails(db, matchedIds);
  }

  let mergeCount = 0;
  const pendingExactTitles = new Map<string, number>();

  for (let index = 0; index < dbEvents.length; index++) {
    const event = dbEvents[index];
    const bestMatchId = bestMatchIds[index];
    const matchedCandidate = bestMatchId ? candidateDetails.get(bestMatchId) : undefined;

    if (bestMatchId && matchedCandidate) {
      const existingMerge = merges.get(bestMatchId);
      const storyState = existingMerge ? { ...matchedCandidate, ...existingMerge } : matchedCandidate;
      const sourceExists =
        canonicalizeEventUrl(matchedCandidate.url) === event.url ||
        canonicalizeEventUrl(storyState.url) === event.url ||
        storyState.sources.some((source) => canonicalizeEventUrl(source.url) === event.url);

      if (!sourceExists) {
        const mergedResult = calculateMergedStory(storyState, event);
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { id: _id, ...mergeData } = mergedResult;
        merges.set(bestMatchId, mergeData);
        mergeCount++;
      } else {
        const incomingTime = new Date(event.published_at).getTime();
        const currentTime = new Date(storyState.published_at).getTime();
        if (incomingTime > currentTime) {
          if (existingMerge) {
            existingMerge.published_at = event.published_at;
          } else {
            merges.set(bestMatchId, {
              sources: matchedCandidate.sources,
              published_at: event.published_at,
              event_count: matchedCandidate.event_count || matchedCandidate.sources.length,
              impact_score: matchedCandidate.impact_score || 0,
            });
          }
        }
      }
      continue;
    }

    const fingerprint = eventFingerprints[index];
    const pendingIndex = fingerprint.length >= 24 ? pendingExactTitles.get(fingerprint) : undefined;
    if (pendingIndex !== undefined) {
      const pending = newEvents[pendingIndex];
      const mergedResult = calculateMergedStory({
        id: `pending-${pendingIndex}`,
        title: pending.title,
        description: pending.description,
        source: pending.source,
        source_type: pending.source_type,
        url: pending.url,
        image_url: pending.image_url,
        credibility_tier: pending.credibility_tier ?? 3,
        published_at: pending.published_at,
        sources: pending.sources ?? [],
      }, event);
      const mergedPending = { ...mergedResult };
      delete (mergedPending as { id?: string }).id;
      newEvents[pendingIndex] = { ...pending, ...mergedPending };
      mergeCount++;
    } else {
      const newIndex = newEvents.push(event) - 1;
      if (fingerprint.length >= 24) pendingExactTitles.set(fingerprint, newIndex);
    }
  }

  console.log(`[vectorize] Story resolution: ${mergeCount} merged, ${newEvents.length} new events`);
  return { newEvents, merges };
}
