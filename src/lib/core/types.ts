/**
 * Core type definitions for the Seraphim news pipeline.
 * 
 * Defines the primary data structures used throughout the frontend to represent 
 * news items, API responses, and spatial bounding boxes. These types ensure 
 * consistency across the map, sidebar, and filter components.
 */

/**
 * Represents a single source of information for a news event.
 */
export interface EventSource {
  name: string;
  url: string;
  sourceType: string;
  discoveredAt: string;
}

/**
 * The primary news entity used within the dashboard.
 * 
 * Note: Heavy fields like 'description' are omitted during initial list 
 * fetches to optimize egress and are loaded on demand.
 */
export interface NewsItem {
  id: string;
  title: string;
  description?: string;
  /** Canonical freshness timestamp reflecting the latest source update. */
  latestActivityAt?: string;
  url: string;
  source: string;
  sourceType: 'gnews' | 'rss' | 'social';
  category?: string;
  publishedAt: string;
  imageUrl?: string;
  latitude?: number;
  longitude?: number;
  locationName?: string;
  foundLocations?: string[];
  tags?: string[];
  clusterId?: number;
  sourcesCount?: number;
  storyCount?: number;
  isTopHot?: boolean;
  clusterSize?: number;
  originalId?: string;
  impactScore?: number;
  credibilityTier?: number;
  sources?: EventSource[];
}

/**
 * Structure of the standard API response for news queries.
 */
export interface NewsResponse {
  items: NewsItem[];
  lastUpdated: string;
  nextCursor?: string;
  meta?: {
    sort: 'new' | 'hot';
    view: 'map' | 'sidebar';
    scope: 'viewport' | 'global';
    clustered: boolean;
    zoomBucket: number | null;
    globalTopN?: number;
    isCapped?: boolean;
    appliedLimit?: number;
  };
  sources: {
    gnews: boolean;
    rss: boolean;
    social: boolean;
  };
}

/**
 * Bounding box parameters used for spatial queries and viewport filtering.
 */
export interface BBox {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
  centerLat?: number;
  centerLng?: number;
  zoom?: number;
  forceRaw?: boolean;
  since?: string;
  until?: string;
  timeRange?: string;
  query?: string;
  sortMode?: string;
}

/**
 * Supported news categories for filtering and classification.
 */
export type NewsCategory =
  | 'general'
  | 'world'
  | 'nation'
  | 'crisis'
  | 'business'
  | 'technology'
  | 'science'
  | 'health';
