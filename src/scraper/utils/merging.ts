import { DbEvent, DbEventSource } from "../../types";

const DESCRIPTION_STALENESS_MS = 6 * 60 * 60 * 1000; // 6 hours
const DESCRIPTION_LENGTH_THRESHOLD = 0.7; // 70% of current length

/**
 * Evaluates whether an incoming event should update the "Master" content of a story.
 * 
 * Smarter Merging Strategy:
 * 1. Headlines (Title) prefer Recency: Latest info is better for a dashboard.
 * 2. Descriptions prefer Depth & Freshness: 
 *    - By default, the longest description from the highest tier wins.
 *    - Eviction Policy: If the current description is > 6 hours old, a newer source
 *      can replace it if it's at least 70% as long and from a similar credibility tier.
 */
export function evaluateContentUpdate(
  current: { 
    title: string; 
    description?: string; 
    tier: number; 
    contentPublishedAt: number; // The publication time of the current Master content
    latestClusterTime: number;  // The latest known activity in the whole cluster
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

  // --- Title Logic (Recency Weighted) ---
  if (incoming.tier < current.tier) {
    updateTitle = true;
  } else if (incoming.tier === current.tier) {
    // Within same tier, always prefer the fresher headline
    if (isNewerThanMaster) updateTitle = true;
    else if (incoming.publishedAt === current.contentPublishedAt && incomingLen > currentLen) updateTitle = true;
  } else if (incoming.tier === current.tier + 1 && isMuchNewerThanMaster) {
    // Breaking News Override: Allow a tier-2 source to update a tier-1 headline if it's fresher
    updateTitle = true;
  }

  // --- Description Logic (Depth + Eviction Policy) ---
  if (incoming.tier < current.tier) {
    updateDescription = true;
  } else if (incoming.tier === current.tier) {
    // Option A: Much newer and "good enough" length (Eviction)
    if (isDescriptionStale && incomingLen >= currentLen * DESCRIPTION_LENGTH_THRESHOLD) {
      updateDescription = true;
    }
    // Option B: Better depth
    else if (incomingLen > currentLen) {
      updateDescription = true;
    }
  } else if (incoming.tier === current.tier + 1 && isDescriptionStale && incomingLen >= currentLen) {
    // Even a slightly lower tier can evict a very stale description if it's at least as long
    updateDescription = true;
  }

  return {
    updateTitle,
    updateDescription,
    shouldUpdateMaster: updateTitle || updateDescription
  };
}

/**
 * Calculates the final merged state of a story.
 */
export function calculateMergedStory(
  existingStory: {
    id: string;
    title: string;
    description?: string;
    source: string;
    url: string;
    credibility_tier: number;
    published_at: string; // The "Master" timestamp (usually latest)
    sources: DbEventSource[];
  },
  incomingEvent: DbEvent
) {
  const incomingTier = incomingEvent.credibility_tier || 3;
  const currentTier = existingStory.credibility_tier || 3;
  
  // To implement the eviction policy correctly, we need to know when the CURRENT master 
  // content was published. We can find this by looking for the source that matches the Master URL.
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

  const newSource: DbEventSource = {
    name: incomingEvent.source,
    url: incomingEvent.url,
    source_type: incomingEvent.source_type,
    discovered_at: incomingEvent.published_at,
  };

  const updatedSources = [...existingStory.sources, newSource];
  const eventCount = updatedSources.length;
  const bestTierForImpact = Math.min(currentTier, incomingTier);
  const impactScore = eventCount * (5.0 - bestTierForImpact);

  return {
    id: existingStory.id,
    sources: updatedSources,
    published_at: latestPublishedAt,
    event_count: eventCount,
    impact_score: impactScore,
    // Content updates
    ...(updateTitle ? {
      title: incomingEvent.title,
      source: incomingEvent.source,
      url: incomingEvent.url,
      credibility_tier: incomingTier, 
    } : {}),
    ...(updateDescription ? {
      description: incomingEvent.description,
    } : {})
  };
}
