import type { SupabaseClient } from '@supabase/supabase-js';
import type { DbEventSource } from '@/types';
import { fetchPageImageCandidate } from '@/lib/api/pageImages';
import { mapWithHostLimit } from './imageEnrichment';
import { evaluateImageUpdate } from '@/lib/utils/merging';

export const DEFAULT_IMAGE_BACKFILL_DAYS = 7;
export const DEFAULT_IMAGE_BACKFILL_LIMIT = 250;
export const IMAGE_BACKFILL_CONCURRENCY = 3;
export const IMAGE_BACKFILL_RETRY_DAYS = 7;
const IMAGE_WRITE_CHUNK_SIZE = 25;

export interface ImageBackfillRow {
  id: string;
  url: string;
  published_at: string;
  credibility_tier: number | null;
  event_count: number | null;
  sources: DbEventSource[] | null;
  image_url?: string | null;
  image_source_url?: string | null;
  image_source_published_at?: string | null;
  image_origin?: string | null;
  image_updated_at?: string | null;
  created_at?: string | null;
}

export interface ImageBackfillUpdate {
  id: string;
  image_url?: string;
  image_source_url?: string;
  image_source_published_at?: string;
  image_origin?: string;
  image_updated_at?: string;
  image_last_checked_at: string;
  replace_existing?: boolean;
}

export interface ImageBackfillOptions {
  days?: number;
  limit?: number;
  apply?: boolean;
  eventId?: string;
  now?: () => number;
  lookup?: typeof fetchPageImageCandidate;
}

export function backfillArticleCandidates(row: ImageBackfillRow) {
  const primary = {
    url: row.url,
    publishedAt: row.published_at,
  };
  if ((row.event_count ?? 1) <= 1) return [primary];
  const secondary = [...(row.sources ?? [])]
    .filter((source) => source.url && source.url !== row.url)
    .sort((a, b) =>
      new Date(b.discovered_at).getTime() - new Date(a.discovered_at).getTime()
    )
    .slice(0, 2)
    .map((source) => ({
      url: source.url,
      publishedAt: source.discovered_at,
    }));
  return [primary, ...secondary];
}

async function loadRows(
  db: SupabaseClient,
  options: Required<Pick<ImageBackfillOptions, 'days' | 'limit'>> & {
    eventId?: string;
    nowMs: number;
  },
) {
  const since = new Date(options.nowMs - options.days * 24 * 60 * 60 * 1000).toISOString();
  const retryBefore = new Date(
    options.nowMs - IMAGE_BACKFILL_RETRY_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();
  let query = db
    .from('events')
    .select('id, url, published_at, credibility_tier, event_count, sources, image_url, image_source_url, image_source_published_at, image_origin, image_updated_at, created_at')
    .gte('published_at', since)
    .order('event_count', { ascending: false })
    .order('published_at', { ascending: false })
    .limit(options.limit);
  if (options.eventId) {
    query = query.eq('id', options.eventId);
  } else {
    query = query
      .or('image_url.is.null,image_url.eq.')
      .or(`image_last_checked_at.is.null,image_last_checked_at.lt.${retryBefore}`);
  }
  const { data, error } = await query;
  if (error) throw new Error(`Unable to load image backfill rows: ${error.message}`);
  return (data ?? []) as ImageBackfillRow[];
}

async function writeUpdates(db: SupabaseClient, updates: ImageBackfillUpdate[]) {
  let updated = 0;
  const missingImageUpdates = updates.filter((update) => !update.replace_existing);
  const refreshUpdates = updates.filter((update) => update.replace_existing);
  for (let offset = 0; offset < missingImageUpdates.length; offset += IMAGE_WRITE_CHUNK_SIZE) {
    const chunk = missingImageUpdates.slice(offset, offset + IMAGE_WRITE_CHUNK_SIZE);
    const { data, error } = await db.rpc('bulk_update_event_images', {
      p_updates: chunk,
    });
    if (error) throw new Error(`Unable to persist image backfill batch: ${error.message}`);
    updated += Number(data) || 0;
  }
  for (let offset = 0; offset < refreshUpdates.length; offset += IMAGE_WRITE_CHUNK_SIZE) {
    const chunk = refreshUpdates.slice(offset, offset + IMAGE_WRITE_CHUNK_SIZE)
      .map(({ replace_existing: _replaceExisting, ...update }) => update);
    const { data, error } = await db.rpc('bulk_ingest_events', {
      p_new_events: [],
      p_merges: chunk,
    });
    if (error) throw new Error(`Unable to persist image refresh batch: ${error.message}`);
    const result = Array.isArray(data) ? data[0] : data;
    updated += Number(result?.merged_count) || 0;
  }
  return updated;
}

export async function runImageBackfill(
  db: SupabaseClient,
  options: ImageBackfillOptions = {},
) {
  const now = options.now ?? Date.now;
  const nowMs = now();
  const days = Math.max(1, Math.min(30, Math.floor(options.days ?? DEFAULT_IMAGE_BACKFILL_DAYS)));
  const limit = Math.max(1, Math.min(1000, Math.floor(options.limit ?? DEFAULT_IMAGE_BACKFILL_LIMIT)));
  const lookup = options.lookup ?? fetchPageImageCandidate;
  const rows = await loadRows(db, { days, limit, eventId: options.eventId, nowMs });

  const updates = await mapWithHostLimit(
    rows,
    IMAGE_BACKFILL_CONCURRENCY,
    (row) => {
      try {
        return new URL(row.url).hostname.toLowerCase();
      } catch {
        return `invalid:${row.id}`;
      }
    },
    async (row): Promise<ImageBackfillUpdate> => {
      const checkedAt = new Date(now()).toISOString();
      for (const article of backfillArticleCandidates(row)) {
        try {
          const candidate = await lookup({
            articleUrl: article.url,
            sourcePublishedAt: article.publishedAt,
            sourceTier: row.credibility_tier ?? 3,
          }, {
            timeoutMs: 1500,
            maxRedirects: 3,
          });
          if (candidate) {
            const update = evaluateImageUpdate({
              image_url: row.image_url ?? undefined,
              image_source_url: row.image_source_url ?? undefined,
              image_source_published_at: row.image_source_published_at ?? undefined,
              image_origin: row.image_origin ?? undefined,
              image_updated_at: row.image_updated_at ?? undefined,
              created_at: row.created_at ?? undefined,
              published_at: row.published_at,
            }, {
              image_url: candidate.url,
              image_source_url: candidate.sourceUrl,
              image_source_published_at: candidate.sourcePublishedAt,
              image_origin: candidate.origin,
              url: candidate.sourceUrl,
              published_at: candidate.sourcePublishedAt,
            }, now());
            if (!update) continue;
            return {
              id: row.id,
              ...update,
              image_last_checked_at: checkedAt,
              replace_existing: Boolean(row.image_url?.trim()),
            };
          }
        } catch {
          // A source-specific failure must not prevent trying another source.
        }
      }
      return { id: row.id, image_last_checked_at: checkedAt };
    },
  );

  const hits = updates.filter((update) => update.image_url).length;
  const written = options.apply ? await writeUpdates(db, updates) : 0;
  return {
    days,
    selected: rows.length,
    hits,
    misses: rows.length - hits,
    written,
    dryRun: !options.apply,
    updates,
  };
}
