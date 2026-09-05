import type { SupabaseClient } from "@supabase/supabase-js";
import type { DbEvent, DbEventSource } from "@/types";
import { calculateMergedStory, isImageLookupEligible } from "@/lib/utils/merging";
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
import { canonicalizeEventUrl, isRecurringTemplatePair, normalizeTitleFingerprint } from "./utils/content";
import { publisherKey } from "@/lib/utils/corroboration";
import { readRecentEventPages } from './recentEvents';

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
  image_source_url?: string;
  image_source_published_at?: string;
  image_origin?: string;
  image_updated_at?: string;
  image_last_checked_at?: string;
  created_at?: string;
  published_at: string;
}

export interface ImageEnrichmentTarget {
  targetType: "merge";
  targetId: string;
  articleUrl: string;
  sourcePublishedAt: string;
  sourceTier: number;
  priority: 0 | 2;
  currentImageUrl?: string;
  currentImageSourcePublishedAt?: string;
  currentImageUpdatedAt?: string;
  currentCreatedAt?: string;
  currentPublishedAt: string;
}

export interface StoryMerge {
  sources: DbEventSource[];
  title?: string;
  description?: string;
  source?: string;
  source_type?: DbEvent["source_type"];
  url?: string;
  image_url?: string;
  image_source_url?: string;
  image_source_published_at?: string;
  image_origin?: string;
  image_updated_at?: string;
  image_last_checked_at?: string;
  credibility_tier?: number;
  published_at?: string;
  event_count?: number;
  impact_score?: number;
  expires_at?: string | null;
  primary_discovered_at?: string | null;
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
  return await readRecentEventPages(db, 'id, title, published_at', since) as Array<{ id: string; title: string; published_at: string }>;
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
      .select("id, sources, latitude, longitude, location_name, title, description, credibility_tier, impact_score, event_count, source, source_type, url, image_url, image_source_url, image_source_published_at, image_origin, image_updated_at, image_last_checked_at, created_at, published_at")
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
        image_source_url: row.image_source_url == null ? undefined : String(row.image_source_url),
        image_source_published_at: row.image_source_published_at == null ? undefined : String(row.image_source_published_at),
        image_origin: row.image_origin == null ? undefined : String(row.image_origin),
        image_updated_at: row.image_updated_at == null ? undefined : String(row.image_updated_at),
        image_last_checked_at: row.image_last_checked_at == null ? undefined : String(row.image_last_checked_at),
        created_at: row.created_at == null ? undefined : String(row.created_at),
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
  const data = await readRecentEventPages(db,
    'id, embedding, sources, latitude, longitude, location_name, title, description, credibility_tier, impact_score, event_count, source, source_type, url, image_url, image_source_url, image_source_published_at, image_origin, image_updated_at, image_last_checked_at, created_at, published_at',
    since, true);

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
        image_source_url: row.image_source_url == null ? undefined : String(row.image_source_url),
        image_source_published_at: row.image_source_published_at == null ? undefined : String(row.image_source_published_at),
        image_origin: row.image_origin == null ? undefined : String(row.image_origin),
        image_updated_at: row.image_updated_at == null ? undefined : String(row.image_updated_at),
        image_last_checked_at: row.image_last_checked_at == null ? undefined : String(row.image_last_checked_at),
        created_at: row.created_at == null ? undefined : String(row.created_at),
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
  merges: Map<string, StoryMerge>;
  imageTargets: ImageEnrichmentTarget[];
}> {
  const newEvents: DbEvent[] = [];
  const merges = new Map<string, StoryMerge>();
  const imageTargets = new Map<string, ImageEnrichmentTarget>();

  if (dbEvents.length === 0) return { newEvents, merges, imageTargets: [] };

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

  const embeddings: Array<number[] | null> = dbEvents.map(() => null);
  const embedIndices = async (indices: number[]) => {
    if (indices.length === 0) return true;
    console.log(`[vectorize] Generating embeddings for ${indices.length}/${dbEvents.length} items...`);
    const texts = indices.map((index) => buildEmbeddingText(
      dbEvents[index].title,
      dbEvents[index].description,
    ));
    const startMs = Date.now();
    try {
      const generated = await generateEmbeddings(texts);
      for (let offset = 0; offset < indices.length; offset++) {
        const index = indices[offset];
        const embedding = generated[offset];
        embeddings[index] = embedding;
        dbEvents[index].embedding = `[${embedding.join(",")}]`;
      }
      console.log(`[vectorize] Embeddings generated in ${((Date.now() - startMs) / 1000).toFixed(1)}s`);
      return true;
    } catch {
      console.error("[vectorize] Embedding generation failed. Exact matching will continue without vectors.");
      return false;
    }
  };

  const unmatchedIndices = bestMatchIds
    .map((matchId, index) => matchId ? null : index)
    .filter((index): index is number => index !== null);
  await embedIndices(unmatchedIndices);

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

  const assignSemanticMatches = (indices: number[]) => {
    for (const index of indices) {
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
  };

  assignSemanticMatches(unmatchedIndices);

  let candidateDetails: Map<string, CandidateDetail>;
  if (fallbackCandidates) {
    candidateDetails = new Map(fallbackCandidates.map((candidate) => [candidate.id, candidate]));
  } else {
    const matchedIds = [...new Set(bestMatchIds.filter((id): id is string => id !== null))];
    candidateDetails = await fetchCandidateDetails(db, matchedIds);
  }

  // An exact-title row can be deleted between the lightweight title lookup and
  // the detail query. Preserve the old behavior by embedding only those raced
  // items on demand and giving semantic matching one chance before insertion.
  const racedExactIndices = bestMatchIds
    .map((matchId, index) => matchId && !candidateDetails.has(matchId) ? index : null)
    .filter((index): index is number => index !== null);
  if (racedExactIndices.length > 0) {
    for (const index of racedExactIndices) bestMatchIds[index] = null;
    await embedIndices(racedExactIndices);
    if (indexedCandidates) {
      const racedEmbeddings = embeddings.map((embedding, index) =>
        racedExactIndices.includes(index) ? embedding : null
      );
      const racedCandidates = await fetchIndexedVectorCandidates(db, racedEmbeddings, since);
      for (const [index, candidates] of racedCandidates) {
        indexedCandidates.set(index, candidates);
      }
    }
    assignSemanticMatches(racedExactIndices);

    if (!fallbackCandidates) {
      const racedMatchIds = [...new Set(
        racedExactIndices
          .map((index) => bestMatchIds[index])
          .filter((id): id is string => id !== null),
      )];
      const racedDetails = await fetchCandidateDetails(db, racedMatchIds);
      for (const [id, detail] of racedDetails) candidateDetails.set(id, detail);
    }
  }

  let mergeCount = 0;
  const pendingExactTitles = new Map<string, number>();
  const pendingEmbeddings = new Map<number, number[]>();

  for (let index = 0; index < dbEvents.length; index++) {
    const event = dbEvents[index];
    const bestMatchId = bestMatchIds[index];
    const matchedCandidate = bestMatchId ? candidateDetails.get(bestMatchId) : undefined;

    const samePublisherRecurringTemplate = matchedCandidate
      ? publisherKey({
          name: event.source,
          url: event.url,
          source_type: event.source_type,
        }) === publisherKey({
          name: matchedCandidate.source,
          url: matchedCandidate.url,
          source_type: matchedCandidate.source_type,
        }) && isRecurringTemplatePair(event.title, matchedCandidate.title)
      : false;

    if (bestMatchId && matchedCandidate && !samePublisherRecurringTemplate) {
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
        if (
          !event.image_url &&
          isImageLookupEligible(storyState, event)
        ) {
          const priority = storyState.image_url ? 2 : 0;
          const proposed: ImageEnrichmentTarget = {
            targetType: "merge",
            targetId: bestMatchId,
            articleUrl: event.url,
            sourcePublishedAt: event.published_at,
            sourceTier: event.credibility_tier ?? 3,
            priority,
            currentImageUrl: storyState.image_url,
            currentImageSourcePublishedAt: storyState.image_source_published_at,
            currentImageUpdatedAt: storyState.image_updated_at,
            currentCreatedAt: storyState.created_at,
            currentPublishedAt: storyState.published_at,
          };
          const current = imageTargets.get(bestMatchId);
          if (
            !current ||
            proposed.priority < current.priority ||
            (
              proposed.priority === current.priority &&
              new Date(proposed.sourcePublishedAt).getTime() >
                new Date(current.sourcePublishedAt).getTime()
            )
          ) {
            imageTargets.set(bestMatchId, proposed);
          }
        }
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
    let pendingIndex = fingerprint.length >= 24 ? pendingExactTitles.get(fingerprint) : undefined;
    const embedding = embeddings[index];
    if (pendingIndex === undefined && embedding) {
      let highestSimilarity = -1;
      for (const [candidateIndex, candidateEmbedding] of pendingEmbeddings) {
        const candidate = newEvents[candidateIndex];
        const samePublisher = publisherKey({ name: event.source, url: event.url, source_type: event.source_type }) ===
          publisherKey({ name: candidate.source, url: candidate.url, source_type: candidate.source_type });
        if (samePublisher && isRecurringTemplatePair(event.title, candidate.title)) continue;
        const similarity = cosineSimilarity(embedding, candidateEmbedding);
        if (similarity > highestSimilarity && candidatePassesMergeThreshold(event, {
          similarity, latitude: candidate.latitude ?? null, longitude: candidate.longitude ?? null,
          location_name: candidate.location_name ?? null,
        })) {
          pendingIndex = candidateIndex;
          highestSimilarity = similarity;
        }
      }
    }
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
        image_source_url: pending.image_source_url,
        image_source_published_at: pending.image_source_published_at,
        image_origin: pending.image_origin,
        image_updated_at: pending.image_updated_at,
        created_at: pending.created_at,
        credibility_tier: pending.credibility_tier ?? 3,
        published_at: pending.published_at,
        sources: pending.sources ?? [],
      }, event);
      const mergedPending = { ...mergedResult };
      delete (mergedPending as { id?: string }).id;
      newEvents[pendingIndex] = { ...pending, ...mergedPending };
      if (fingerprint.length >= 24) pendingExactTitles.set(fingerprint, pendingIndex);
      mergeCount++;
    } else {
      const newIndex = newEvents.push(event) - 1;
      if (embedding) pendingEmbeddings.set(newIndex, embedding);
      if (fingerprint.length >= 24) pendingExactTitles.set(fingerprint, newIndex);
    }
  }

  console.log(`[vectorize] Story resolution: ${mergeCount} merged, ${newEvents.length} new events`);
  return { newEvents, merges, imageTargets: [...imageTargets.values()] };
}
