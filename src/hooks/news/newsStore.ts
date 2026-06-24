import { NewsItem } from "@/lib/core/types";

export const MAX_ENTITY_COUNT = 5000;

/**
 * Merges an incoming news item with an existing one in the store.
 * It prioritizes the highest source count and preserves impact scores.
 * This prevents data downgrades when receiving partial updates from the API.
 */
export function mergeNewsItem(existing: NewsItem | undefined, incoming: NewsItem): NewsItem {
    if (!existing) return incoming;
    
    // Reporting strength is determined by the maximum known source count across all updates.
    const raw = incoming as unknown as Record<string, unknown>;
    const sCount = Number(
        incoming.sourcesCount ?? 
        raw.sourceCount ?? 
        raw.event_count ?? 
        raw.source_count ?? 
        raw.eventCount ?? 
        0
    );

    const sourcesCount = Math.max(
        Number(existing.sourcesCount) || 0,
        sCount
    );

    const impactScore = Math.max(
        Number(existing.impactScore) || 0,
        Number(incoming.impactScore) || 0
    );

    return {
        ...existing,
        ...incoming,
        sourcesCount: sourcesCount > 0 ? sourcesCount : undefined,
        impactScore: impactScore > 0 ? impactScore : undefined,
        description: incoming.description ?? existing.description,
        sources: incoming.sources ?? existing.sources,
        originalId: incoming.originalId ?? existing.originalId,
        isTopHot: incoming.isTopHot || existing.isTopHot,
    };
}
