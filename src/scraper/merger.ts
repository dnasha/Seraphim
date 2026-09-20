import type { SupabaseClient } from "@supabase/supabase-js";
import type { DbEvent, DbEventSource } from "@/types";
import { calculateMergedStory, isImageLookupEligible } from "@/lib/utils/merging";
import {
  generateEmbeddings,
  buildEmbeddingText,
  cosineSimilarity,
} from "@/lib/utils/vectorize";
import { normalizeTitleFingerprint } from "./utils/content";
import { reportIdentityKey } from "@/lib/utils/reportIdentity";
import { hasConflictingStoryEvidence, passesSemanticThreshold } from './storyMatching';
import { readRecentEventPages } from './recentEvents';

const RECENT_WINDOW_MS = 48 * 60 * 60 * 1000;
const VECTOR_QUERY_CHUNK_SIZE = 100;
const VECTOR_CANDIDATE_LIMIT = 12;
const EXPANDED_VECTOR_CANDIDATE_LIMIT = 50;
const DETAIL_QUERY_CHUNK_SIZE = 100;

interface CandidateDetail {
  description_provenance?: DbEvent['description_provenance'];
  primary_discovered_at?: string | null;
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
  description_provenance?: DbEvent['description_provenance'];
  independent_publisher_count?: number;
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
  limit = VECTOR_CANDIDATE_LIMIT,
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
      p_limit: limit,
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
      .select("id, sources, latitude, longitude, location_name, title, description, description_provenance, primary_discovered_at, credibility_tier, impact_score, event_count, source, source_type, url, image_url, image_source_url, image_source_published_at, image_origin, image_updated_at, image_last_checked_at, created_at, published_at")
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
        description_provenance: row.description_provenance as DbEvent['description_provenance'],
        primary_discovered_at: row.primary_discovered_at == null ? null : String(row.primary_discovered_at),
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
    'id, embedding, sources, latitude, longitude, location_name, title, description, description_provenance, primary_discovered_at, credibility_tier, impact_score, event_count, source, source_type, url, image_url, image_source_url, image_source_published_at, image_origin, image_updated_at, image_last_checked_at, created_at, published_at',
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
        description_provenance: row.description_provenance as DbEvent['description_provenance'],
        primary_discovered_at: row.primary_discovered_at == null ? null : String(row.primary_discovered_at),
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

  for (const event of dbEvents) {
    event.primary_discovered_at ??= event.published_at;
    event.independent_publisher_count ??= 1;
    if (event.description?.trim()) event.description_provenance ??= {
      name: event.source, url: event.url, published_at: event.primary_discovered_at,
      tier: event.credibility_tier ?? 3,
    };
  }
  if (dbEvents.length === 0) return { newEvents, merges, imageTargets: [] };

  const since = new Date(Date.now() - RECENT_WINDOW_MS).toISOString();
  const eventFingerprints = dbEvents.map((event) => normalizeTitleFingerprint(event.title));
  let titleRows: Array<{ id: string; title: string; published_at: string }> = [];
  try {
    titleRows = await fetchRecentTitles(db, since);
  } catch (error) {
    console.warn("[vectorize] Recent title lookup unavailable:", error instanceof Error ? error.message : error);
  }

  const exactTitleIds = new Map<string, string[]>();
  for (const row of titleRows) {
    const fingerprint = normalizeTitleFingerprint(row.title);
    if (fingerprint.length >= 24) {
      const ids = exactTitleIds.get(fingerprint) ?? [];
      ids.push(row.id);
      exactTitleIds.set(fingerprint, ids);
    }
  }

  // Exact titles still need their geography and incident details checked. Keep
  // all exact candidates, since identical generic headlines can describe different places.
  const requestedExactIds = [...new Set(eventFingerprints.flatMap(fingerprint => exactTitleIds.get(fingerprint) ?? []))];
  const candidateDetails = await fetchCandidateDetails(db, requestedExactIds);
  const candidateOptions: Array<Array<{ id: string; score: number }>> = dbEvents.map((event, index) => {
    return (exactTitleIds.get(eventFingerprints[index]) ?? [])
      .filter(id => {
        const detail = candidateDetails.get(id);
        return detail && !hasConflictingStoryEvidence(event, detail);
      })
      .map(id => ({ id, score: 2 }));
  });

  const embeddings: Array<number[] | null> = dbEvents.map(() => null);
  const embeddingsByText = new Map<string, number[]>();
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
        embeddingsByText.set(texts[offset], embedding);
        dbEvents[index].embedding = `[${embedding.join(",")}]`;
      }
      console.log(`[vectorize] Embeddings generated in ${((Date.now() - startMs) / 1000).toFixed(1)}s`);
      return true;
    } catch {
      console.error("[vectorize] Embedding generation failed. Exact matching will continue without vectors.");
      return false;
    }
  };

  const unmatchedIndices = candidateOptions
    .map((options, index) => options.length ? null : index)
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

  for (const index of unmatchedIndices) {
    const event = dbEvents[index];
    const embedding = embeddings[index];
    if (!embedding) continue;
    if (indexedCandidates) {
      for (const candidate of indexedCandidates.get(index) ?? []) {
        if (passesSemanticThreshold(event, candidate, candidate.similarity)) {
          candidateOptions[index].push({ id: candidate.event_id, score: candidate.similarity });
        }
      }
    } else {
      for (const candidate of fallbackCandidates ?? []) {
        candidateDetails.set(candidate.id, candidate);
        const exact = eventFingerprints[index].length >= 24 && eventFingerprints[index] === candidate.fingerprint;
        const similarity = cosineSimilarity(embedding, candidate.embedding);
        if (exact || passesSemanticThreshold(event, candidate, similarity)) {
          candidateOptions[index].push({ id: candidate.id, score: exact ? 2 : similarity });
        }
      }
    }
    candidateOptions[index].sort((a, b) => b.score - a.score);
  }
  if (indexedCandidates) {
    const missingIds = [...new Set(candidateOptions.flatMap(options => options.map(option => option.id)))]
      .filter(id => !candidateDetails.has(id));
    for (const [id, detail] of await fetchCandidateDetails(db, missingIds)) candidateDetails.set(id, detail);

    // The database ranks by vector only. If a full page contains no eligible
    // incident, a nearby/compatible story may be just beyond the first twelve.
    const blockedIndices = unmatchedIndices.filter(index =>
      (indexedCandidates!.get(index)?.length ?? 0) >= VECTOR_CANDIDATE_LIMIT &&
      !candidateOptions[index].some(option => {
        const detail = candidateDetails.get(option.id);
        return detail && !hasConflictingStoryEvidence(dbEvents[index], detail);
      }),
    );
    if (blockedIndices.length > 0) {
      try {
        const blocked = new Set(blockedIndices);
        const expanded = await fetchIndexedVectorCandidates(db,
          embeddings.map((embedding, index) => blocked.has(index) ? embedding : null), since, EXPANDED_VECTOR_CANDIDATE_LIMIT);
        for (const [index, rows] of expanded) {
          candidateOptions[index] = rows
            .filter(candidate => passesSemanticThreshold(dbEvents[index], candidate, candidate.similarity))
            .map(candidate => ({ id: candidate.event_id, score: candidate.similarity }))
            .sort((a, b) => b.score - a.score);
        }
        const expandedIds = [...new Set(blockedIndices.flatMap(index => candidateOptions[index].map(option => option.id)))]
          .filter(id => !candidateDetails.has(id));
        for (const [id, detail] of await fetchCandidateDetails(db, expandedIds)) candidateDetails.set(id, detail);
      } catch (error) {
        // The bounded recall retry is optional; the original candidates remain usable.
        console.warn('[vectorize] Expanded candidate lookup unavailable:', error instanceof Error ? error.message : error);
      }
    }
  }

  let mergeCount = 0;
  const pendingExactTitles = new Map<string, number[]>();
  const pendingReportIdentities = new Map<string, number>();
  const pendingEmbeddings = new Map<number, number[]>();

  for (let index = 0; index < dbEvents.length; index++) {
    const event = dbEvents[index];
    // Validate each candidate before selecting it, including changes accumulated
    // earlier in this batch. A rejected top hit must not hide an eligible runner-up.
    const bestMatchId = candidateOptions[index].find(option => {
      const candidate = candidateDetails.get(option.id);
      const state = candidate && { ...candidate, ...merges.get(option.id) };
      return state && !hasConflictingStoryEvidence(event, state);
    })?.id;
    const matchedCandidate = bestMatchId ? candidateDetails.get(bestMatchId) : undefined;

    if (bestMatchId && matchedCandidate) {
      const existingMerge = merges.get(bestMatchId);
      const storyState = existingMerge ? { ...matchedCandidate, ...existingMerge } : matchedCandidate;
      const sourceExists =
        reportIdentityKey(matchedCandidate.url) === reportIdentityKey(event.url) ||
        reportIdentityKey(storyState.url) === reportIdentityKey(event.url) ||
        storyState.sources.some((source) => reportIdentityKey(source.url) === reportIdentityKey(event.url));

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
    let pendingIndex = pendingReportIdentities.get(reportIdentityKey(event.url)) ?? (pendingExactTitles.get(fingerprint) ?? [])
      .find(candidateIndex => !hasConflictingStoryEvidence(event, newEvents[candidateIndex]));
    const embedding = embeddings[index];
    if (pendingIndex === undefined && embedding) {
      let highestSimilarity = -1;
      for (const [candidateIndex, candidateEmbedding] of pendingEmbeddings) {
        const candidate = newEvents[candidateIndex];
        if (hasConflictingStoryEvidence(event, candidate)) continue;
        const similarity = cosineSimilarity(embedding, candidateEmbedding);
        if (similarity > highestSimilarity && passesSemanticThreshold(event, candidate, similarity)) {
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
        description_provenance: pending.description_provenance,
        primary_discovered_at: pending.primary_discovered_at,
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
      if (mergedResult.title !== undefined) {
        newEvents[pendingIndex].latitude = event.latitude ?? null;
        newEvents[pendingIndex].longitude = event.longitude ?? null;
        newEvents[pendingIndex].location_name = event.location_name ?? null;
      }
      const representativeText = buildEmbeddingText(newEvents[pendingIndex].title, newEvents[pendingIndex].description);
      if (representativeText !== buildEmbeddingText(pending.title, pending.description)) {
        // These rows have not been persisted yet. Keep their search vector and
        // the next in-batch comparison aligned with the final representative.
        let representativeVector = embeddingsByText.get(representativeText);
        if (!representativeVector) {
          try {
            [representativeVector] = await generateEmbeddings([representativeText]);
            if (representativeVector) embeddingsByText.set(representativeText, representativeVector);
          } catch {
            console.warn('[vectorize] Could not embed updated pending representative; omitting its stale vector.');
          }
        }
        if (representativeVector) {
          pendingEmbeddings.set(pendingIndex, representativeVector);
          newEvents[pendingIndex].embedding = `[${representativeVector.join(',')}]`;
        } else {
          pendingEmbeddings.delete(pendingIndex);
          delete newEvents[pendingIndex].embedding;
        }
      }
      pendingReportIdentities.set(reportIdentityKey(event.url), pendingIndex);
      if (fingerprint.length >= 24) {
        const indices = pendingExactTitles.get(fingerprint) ?? [];
        if (!indices.includes(pendingIndex)) indices.push(pendingIndex);
        pendingExactTitles.set(fingerprint, indices);
      }
      mergeCount++;
    } else {
      const newIndex = newEvents.push(event) - 1;
      pendingReportIdentities.set(reportIdentityKey(event.url), newIndex);
      if (embedding) pendingEmbeddings.set(newIndex, embedding);
      if (fingerprint.length >= 24) {
        const indices = pendingExactTitles.get(fingerprint) ?? [];
        indices.push(newIndex);
        pendingExactTitles.set(fingerprint, indices);
      }
    }
  }

  console.log(`[vectorize] Story resolution: ${mergeCount} merged, ${newEvents.length} new events`);
  return { newEvents, merges, imageTargets: [...imageTargets.values()] };
}
