/**
 * Story merging and content evaluation utilities for the Seraphim ingestion pipeline.
 * This module determines how incoming news events are consolidated into existing stories,
 * managing content updates (title/description) based on recency, depth, and credibility.
 */

import { DbEvent, DbEventSource } from "@/types";

const DESCRIPTION_STALENESS_MS = 6 * 60 * 60 * 1000; // 6 hours
const DESCRIPTION_LENGTH_THRESHOLD = 0.7; // 70% of current length
export const IMAGE_FRESHNESS_GAP_MS = 12 * 60 * 60 * 1000;
export const IMAGE_REFRESH_COOLDOWN_MS = 6 * 60 * 60 * 1000;

type ExistingImageState = {
  image_url?: string;
  image_source_url?: string;
  image_source_published_at?: string;
  image_origin?: string;
  image_updated_at?: string;
  created_at?: string;
  published_at: string;
};

type IncomingImageState = {
  image_url?: string;
  image_source_url?: string;
  image_source_published_at?: string;
  image_origin?: string;
  url: string;
  published_at: string;
};

function validTime(value?: string) {
  const parsed = value ? new Date(value).getTime() : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Returns image fields when an incoming source may fill or refresh the story.
 * Image promotion deliberately does not depend on title/source promotion.
 */
export function evaluateImageUpdate(
  current: ExistingImageState,
  incoming: IncomingImageState,
  nowMs = Date.now(),
) {
  const imageUrl = typeof incoming.image_url === 'string'
    ? incoming.image_url.trim()
    : '';
  if (!imageUrl) return null;

  if (!isImageLookupEligible(current, incoming, nowMs)) return null;

  const candidatePublishedAt =
    validTime(incoming.image_source_published_at) ??
    validTime(incoming.published_at) ??
    nowMs;
  const candidateIso = new Date(candidatePublishedAt).toISOString();
  return {
    image_url: imageUrl,
    image_source_url: incoming.image_source_url || incoming.url,
    image_source_published_at: candidateIso,
    image_origin: incoming.image_origin || 'feed',
    image_updated_at: new Date(nowMs).toISOString(),
  };
}

export function isImageLookupEligible(
  current: ExistingImageState,
  incoming: Pick<IncomingImageState, 'image_source_published_at' | 'published_at'>,
  nowMs = Date.now(),
) {
  const currentImage = typeof current.image_url === 'string'
    ? current.image_url.trim()
    : '';
  if (!currentImage) return true;

  const candidatePublishedAt =
    validTime(incoming.image_source_published_at) ??
    validTime(incoming.published_at) ??
    nowMs;
  const currentImagePublishedAt =
    validTime(current.image_source_published_at) ??
    validTime(current.created_at) ??
    validTime(current.published_at) ??
    0;
  const lastUpdatedAt = validTime(current.image_updated_at) ?? currentImagePublishedAt;

  if (
    candidatePublishedAt < currentImagePublishedAt + IMAGE_FRESHNESS_GAP_MS ||
    nowMs < lastUpdatedAt + IMAGE_REFRESH_COOLDOWN_MS
  ) {
    return false;
  }
  return true;
}

/**
 * Evaluates whether an incoming event should update the "Master" content of a story.
 * 
 * Content Update Strategy:
 * 1. Headlines (Title) prefer Recency: Latest information is prioritized for the dashboard.
 * 2. Descriptions prefer Depth and Freshness: 
 *    - The longest description from the highest credibility tier is preferred.
 *    - Eviction Policy: If the current description is older than 6 hours, a newer source
 *      can replace it if it meets the length threshold (70%) and has a similar tier.
 */
export function evaluateContentUpdate(
  current: { 
    title: string; 
    description?: string; 
    tier: number; 
    contentPublishedAt: number; // Publication time of the current Master content
    latestClusterTime: number;  // Latest known activity in the whole cluster
  },
  incoming: { 
    title: string; 
    description?: string; 
    tier: number; 
    publishedAt: number; 
  }
) {
  const isNewerThanMaster = incoming.publishedAt > current.contentPublishedAt;
  const isMuchNewerThanMaster = incoming.publishedAt > current.contentPublishedAt + (15 * 60 * 1000);
  const isDescriptionStale = incoming.publishedAt > current.contentPublishedAt + DESCRIPTION_STALENESS_MS;
  
  const currentLen = (current.title?.length || 0) + (current.description?.length || 0);
  const incomingLen = (incoming.title?.length || 0) + (incoming.description?.length || 0);

  let updateTitle = false;
  let updateDescription = false;

  /**
   * Title Logic: Recency Weighted
   * Higher credibility (lower tier number) always wins.
   * Same tier: Newer content wins.
   * Breaking News Override: A tier 2 source can override a tier 1 source if it is significantly fresher.
   */
  if (incoming.tier < current.tier) {
    updateTitle = true;
  } else if (incoming.tier === current.tier) {
    if (isNewerThanMaster) updateTitle = true;
    else if (incoming.publishedAt === current.contentPublishedAt && incomingLen > currentLen) updateTitle = true;
  } else if (incoming.tier === current.tier + 1 && isMuchNewerThanMaster) {
    updateTitle = true;
  }

  /**
   * Description Logic: Depth and Eviction Policy
   * Descriptions are updated if the incoming source has higher credibility.
   * For the same tier, descriptions are updated if the current one is stale and the new one
   * is sufficiently long, or if the new one simply provides more depth (longer).
   */
  if (incoming.tier < current.tier) {
    updateDescription = true;
  } else if (incoming.tier === current.tier) {
    if (isDescriptionStale && incomingLen >= currentLen * DESCRIPTION_LENGTH_THRESHOLD) {
      updateDescription = true;
    }
    else if (incomingLen > currentLen) {
      updateDescription = true;
    }
  } else if (incoming.tier === current.tier + 1 && isDescriptionStale && incomingLen >= currentLen) {
    updateDescription = true;
  }

  return {
    updateTitle,
    updateDescription,
    shouldUpdateMaster: updateTitle || updateDescription
  };
}

/**
 * Calculates the final merged state of a story after a new event is added.
 * Updates the source list, latest timestamps, and impact scores.
 */
export function calculateMergedStory(
  existingStory: {
    id: string;
    title: string;
    description?: string;
    source: string;
    source_type: DbEvent["source_type"];
    url: string;
    image_url?: string;
    image_source_url?: string;
    image_source_published_at?: string;
    image_origin?: string;
    image_updated_at?: string;
    created_at?: string;
    credibility_tier: number;
    published_at: string; // The Master timestamp
    sources: DbEventSource[];
  },
  incomingEvent: DbEvent
) {
  const incomingTier = incomingEvent.credibility_tier || 3;
  const currentTier = existingStory.credibility_tier || 3;
  
  /**
   * Identify the actual publication time of the current Master content to correctly 
   * apply the eviction policy. Fallback to the story's published_at if not found.
   */
  const masterSource = existingStory.sources.find(s => s.url === existingStory.url);
  const contentPublishedAt = masterSource 
    ? new Date(masterSource.discovered_at).getTime() 
    : new Date(existingStory.published_at).getTime();

  let latestClusterTime = new Date(existingStory.published_at).getTime();
  for (const s of existingStory.sources) {
    const sTime = new Date(s.discovered_at).getTime();
    if (sTime > latestClusterTime) latestClusterTime = sTime;
  }

  const { updateTitle, updateDescription } = evaluateContentUpdate(
    {
      title: existingStory.title,
      description: existingStory.description,
      tier: currentTier,
      contentPublishedAt,
      latestClusterTime
    },
    {
      title: incomingEvent.title,
      description: incomingEvent.description,
      tier: incomingTier,
      publishedAt: new Date(incomingEvent.published_at).getTime()
    }
  );

  const incomingTime = new Date(incomingEvent.published_at).getTime();
  const latestPublishedAt = incomingTime > latestClusterTime ? incomingEvent.published_at : existingStory.published_at;
  const imageUpdate = evaluateImageUpdate(existingStory, incomingEvent);

  const incomingSource: DbEventSource = {
    name: incomingEvent.source,
    url: incomingEvent.url,
    source_type: incomingEvent.source_type,
    discovered_at: incomingEvent.published_at,
  };

  const existingPrimary: DbEventSource = {
    name: existingStory.source,
    url: existingStory.url,
    source_type: existingStory.source_type,
    discovered_at: masterSource?.discovered_at ?? existingStory.published_at,
  };
  const finalPrimaryUrl = updateTitle ? incomingEvent.url : existingStory.url;
  const uniqueByUrl = new Map<string, DbEventSource>();
  for (const article of [existingPrimary, ...existingStory.sources, incomingSource]) {
    if (!uniqueByUrl.has(article.url)) uniqueByUrl.set(article.url, article);
  }
  uniqueByUrl.delete(finalPrimaryUrl);
  const updatedSources = [...uniqueByUrl.values()];
  const eventCount = 1 + updatedSources.length;
  
  /**
   * Impact Score Calculation:
   * Multiplies the number of events by a credibility factor (5 minus the best tier).
   * This ensures stories with more sources and higher credibility are ranked higher.
   */
  const bestTierForImpact = Math.min(currentTier, incomingTier);
  const impactScore = eventCount * (5.0 - bestTierForImpact);

  return {
    id: existingStory.id,
    sources: updatedSources,
    published_at: latestPublishedAt,
    event_count: eventCount,
    impact_score: impactScore,
    // Any independent corroboration promotes a temporary low-signal report
    // into the durable archive.
    expires_at: null,
    // Apply content updates if evaluation returned true
    ...(updateTitle ? {
      title: incomingEvent.title,
      source: incomingEvent.source,
      source_type: incomingEvent.source_type,
      url: incomingEvent.url,
      credibility_tier: incomingTier, 
      primary_discovered_at: incomingEvent.primary_discovered_at ?? incomingEvent.published_at,
    } : {}),
    ...(imageUpdate ?? {}),
    ...(updateDescription ? {
      description: incomingEvent.description,
    } : {})
  };
}
