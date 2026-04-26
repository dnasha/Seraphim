/*
  Dan Sharan
  
  Centralized types — shared by both the Next.js frontend and Bun scraper.
  Exported from @/types to decouple the directory structures.
*/

// Re-export everything from the lib types so existing frontend code
// that still imports from @/lib/types continues to compile unchanged.
export * from '@/lib/types';

// Database event interface (matches Supabase 'events' table).
// Scraper writes these rows; API route reads and transforms them.
export interface DbEvent {
  id?: string;                // auto-generated UUID primary key
  title: string;
  /** Present on detail fetch only — omitted from list queries to reduce egress. */
  description?: string;
  url: string;                // Primary conflict key for upserts
  source: string;
  source_type: 'gnews' | 'rss' | 'social';
  category?: string;
  image_url?: string;
  published_at: string;       // ISO-8601 timestamp
  latitude?: number | null;
  longitude?: number | null;
  location_name?: string | null;
  tags?: string[] | null;       // stored as JSONB in Supabase
  created_at?: string;        // set by Supabase default
  cluster_id?: number;
  event_count?: number;
}

// helper: map a DbEvent row → NewsItem
// Keeps the API route thin — no manual field mapping scattered around.
import { NewsItem } from '@/lib/types';

export function dbEventToNewsItem(row: DbEvent): NewsItem {
  return {
    id: String(row.id ?? row.url),
    title: row.title,
    // description is optional — only populated by the detail endpoint
    ...(row.description !== undefined ? { description: row.description } : {}),
    url: row.url,
    source: row.source,
    sourceType: row.source_type,
    category: row.category,
    publishedAt: row.published_at,
    imageUrl: row.image_url,
    latitude: row.latitude ?? undefined,
    longitude: row.longitude ?? undefined,
    locationName: row.location_name ?? undefined,
    tags: row.tags ?? undefined,
    clusterId: row.cluster_id ?? undefined,
    eventCount: row.event_count ?? undefined,
  };
}
