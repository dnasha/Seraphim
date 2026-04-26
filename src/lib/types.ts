/**
 * Core type definitions for the news aggregation pipeline.
 */

export interface NewsItem {
  id: string;
  title: string;
  /** Omitted on initial list fetch — loaded on demand when a card is expanded. */
  description?: string;
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
  eventCount?: number;
}

export interface NewsResponse {
  items: NewsItem[];
  lastUpdated: string;
  nextCursor?: string;
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
