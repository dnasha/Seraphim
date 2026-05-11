/**
 * Centralized type definitions for the Seraphim platform.
 * 
 * Bridges the gap between database models (PostgreSQL) and frontend 
 * data structures. Includes mapping utilities to transform raw database rows 
 * into application-ready objects.
 */

import { NewsItem } from '@/lib/core/types';

// Re-export core types for backward compatibility
export * from '@/lib/core/types';

/**
 * Represents the structure of a source within a database event.
 */
export interface DbEventSource {
  name: string;
  url: string;
  source_type: string;
  discovered_at: string;
}

/**
 * Interface for database events matching the Supabase 'events' table schema.
 * 
 * Includes fields for standard event metadata, semantic clustering information, 
 * and spatial data (PostGIS).
 */
export interface DbEvent {
  id?: string;                
  title: string;
  description?: string;
  url: string;                
  source: string;
  source_type: 'gnews' | 'rss' | 'social';
  category?: string;
  image_url?: string;
  published_at: string;       
  latitude?: number | null;
  longitude?: number | null;
  location_name?: string | null;
  tags?: string[] | null;       
  embedding?: number[] | string; 
  created_at?: string;        
  cluster_id?: number;        
  story_count?: number;       
  center_lat?: number;        
  center_lng?: number;        
  event_count?: number;       
  is_top_hot?: boolean;        
  impact_score?: number;
  credibility_tier?: number;
  sources?: DbEventSource[];
}

/**
 * Transforms a database row (DbEvent) into a frontend-optimized NewsItem.
 * 
 * This function centralizes the mapping of snake_case database fields to 
 * camelCase application properties. It handles property fallbacks for 
 * RPC-driven queries (e.g., event_count vs source_count) and ensures that 
 * numeric fields are correctly parsed before being passed to the UI.
 */
export function dbEventToNewsItem(row: DbEvent): NewsItem {
    // Cast to record for flexible property access during RPC result mapping
    const raw = row as unknown as Record<string, unknown>;
    
    // Resolve counts and scores from potential snake_case or camelCase source fields
    const eventCountRaw = row.event_count ?? raw.event_count ?? raw.source_count ?? raw.sourceCount ?? raw.eventCount;
    const impactScoreRaw = row.impact_score ?? raw.impact_score ?? raw.impactScore;
    
    const parsedEventCount = Number(eventCountRaw);
    const parsedImpactScore = Number(impactScoreRaw);

    return {
        id: String(row.id ?? row.url),
        title: row.title,
        // Only include description if explicitly fetched (to save egress)
        ...(row.description !== undefined ? { description: row.description } : {}),
        url: row.url,
        source: row.source,
        sourceType: row.source_type,
        category: row.category,
        publishedAt: row.published_at,
        imageUrl: row.image_url,
        // Prefer cluster centroid for clustered views
        latitude: row.center_lat ?? row.latitude ?? undefined,
        longitude: row.center_lng ?? row.longitude ?? undefined,
        locationName: row.location_name ?? undefined,
        tags: row.tags ?? undefined,
        clusterId: row.cluster_id ?? undefined,
        storyCount: row.story_count ?? undefined,
        sourcesCount: Number.isFinite(parsedEventCount) ? parsedEventCount : undefined,
        isTopHot: row.is_top_hot ?? undefined,
        impactScore: Number.isFinite(parsedImpactScore) ? parsedImpactScore : undefined,
        credibilityTier: row.credibility_tier ?? undefined,
        sources: row.sources?.map(s => ({
            name: s.name,
            url: s.url,
            sourceType: s.source_type,
            discoveredAt: s.discovered_at,
        })) ?? undefined,
    };
}
