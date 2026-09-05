import type { SupabaseClient } from '@supabase/supabase-js';
import type { FeedValidator } from '@/lib/security/feedFetch';

type ValidatorRow = {
  source_url: string;
  etag: string | null;
  last_modified: string | null;
  latest_usable_item_at: string | null;
};

function validatorStoreUnavailable(error: { code?: string; message?: string } | null) {
  return error?.code === '42P01' ||
    error?.code === 'PGRST205' ||
    error?.message?.includes('source_http_validators');
}

export async function loadFeedValidators(db: SupabaseClient) {
  const { data, error } = await db
    .from('source_http_validators')
    .select('source_url, etag, last_modified, latest_usable_item_at');
  if (error) {
    if (validatorStoreUnavailable(error)) {
      console.warn('[rss] Conditional-request store is not deployed; continuing without validators.');
      return new Map<string, FeedValidator>();
    }
    throw new Error(`Unable to load RSS validators: ${error.message}`);
  }

  return new Map(((data as ValidatorRow[] | null) ?? []).map((row) => [
    row.source_url,
    { etag: row.etag, lastModified: row.last_modified, latestItemAt: row.latest_usable_item_at },
  ]));
}

export async function persistFeedValidators(
  db: SupabaseClient,
  validators: ReadonlyMap<string, FeedValidator>,
) {
  if (validators.size === 0) return;
  const rows = [...validators].map(([sourceUrl, validator]) => ({
    source_url: sourceUrl,
    etag: validator.etag ?? null,
    last_modified: validator.lastModified ?? null,
    latest_usable_item_at: validator.latestItemAt ?? null,
    updated_at: new Date().toISOString(),
  }));
  const { error } = await db.from('source_http_validators').upsert(rows, {
    onConflict: 'source_url',
  });
  if (error && !validatorStoreUnavailable(error)) {
    throw new Error(`Unable to persist RSS validators: ${error.message}`);
  }
}
