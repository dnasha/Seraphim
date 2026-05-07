/*
Core type definitions for the news aggregation pipeline.
Used across the frontend to represent news items and API responses.
*/

export interface EventSource {
  name: string;
  url: string;
  sourceType: string;
  discoveredAt: string;
}

export interface NewsItem {
  id: string;
  title: string;
  /* Omitted on initial list fetch. Loaded on demand when a card is expanded. */
  description?: string;
  /* Canonical "freshness" timestamp: latest source discovery or publishedAt fallback. */
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
  };
  sources: {
    gnews: boolean;
    rss: boolean;
    social: boolean;
  };
}

export type NewsCategory =
  | 'general'
  | 'world'
  | 'nation'
  | 'crisis'
  | 'business'
  | 'technology'
  | 'science'
  | 'health';
