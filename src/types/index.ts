/*
Dan Sharan

Shared types — used by both the Next.js frontend and the Bun scraper worker.
Exported from @/types so that neither side is tightly coupled to the other's
directory structure.
*/

// Re-export everything from the lib types so existing frontend code
// that still imports from @/lib/types continues to compile unchanged.
export * from '@/lib/types';

// ─── Database row shape ────────────────────────────────────────────────────────
// Mirrors the `events` table in Supabase (snake_case to match PostgreSQL).
// The scraper writes rows matching this interface; the API route reads them.
export interface DbEvent {
  id?: string;                // auto-generated UUID primary key
  title: string;
  description: string;
  url: string;                // UNIQUE — used as the upsert conflict key
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
}

// ─── Helper: map a DbEvent row → NewsItem ─────────────────────────────────────
// Keeps the API route thin — no manual field mapping scattered around.
import { NewsItem } from '@/lib/types';

export function dbEventToNewsItem(row: DbEvent): NewsItem {
  return {
    id: String(row.id ?? row.url),
    title: row.title,
    description: row.description,
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
  };
}
