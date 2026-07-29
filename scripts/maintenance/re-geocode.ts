/*
  Seraphim DB Location Re-Geocoder
  Re-processes events through the current geocoding engine and produces a
  reviewable change report. Writes and deletions require an explicit
  approved-action manifest.

  This is useful after tweaking extraction heuristics or updating the
  GeoNames dictionary to propagate improvements to historical data.

  Usage:
    $env:IS_BENCHMARK="true"; bun run scripts/maintenance/re-geocode.ts --dry-run --limit 50
    $env:IS_BENCHMARK="true"; bun run scripts/maintenance/re-geocode.ts --approved-manifest scripts/results/re-geocode-approved.json --limit 50

  Flags:
    --dry-run       Show changes without writing to DB
    --all           Process all rows (ignores --limit; still produces a report)
    --limit N       Process N rows (default: 10)
    --offset N      Start from row N (default: 0)
    --oldest        Sort ascending (targets oldest/most stale rows first)
    --include-corroborated  Include event_count > 1 rows (default is uncorroborated only)
    --report PATH   Write the review report to PATH
    --approved-manifest PATH  [{"id":"...","action":"update|delete"}] or {"approved":[...]}

  Environment (loaded from .env.local by Bun automatically):
    SUPABASE_URL               - Supabase project URL
    SUPABASE_SERVICE_ROLE_KEY  - Service-role key (bypasses RLS for writes)
*/

import { createClient } from '@supabase/supabase-js';
import { resolveLocation, ensureInitialized } from '@/lib/geocoding/engine';

// Configuration

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('[re-geocode] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}

// How many rows to SELECT per Supabase request
const FETCH_PAGE_SIZE = 100;

// How many rows to UPDATE per Supabase request
const UPDATE_CHUNK_SIZE = 25;

// CLI Arguments

const args = process.argv.slice(2);
const DRY_RUN    = args.includes('--dry-run');
const FULL_RUN   = args.includes('--all');
const OLDEST     = args.includes('--oldest'); // sort ascending = oldest first
const INCLUDE_CORROBORATED = args.includes('--include-corroborated');
const reportIdx = args.indexOf('--report');
const REPORT_PATH = reportIdx !== -1 && args[reportIdx + 1]
  ? args[reportIdx + 1]
  : `scripts/results/re-geocode-report-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
const manifestIdx = args.indexOf('--approved-manifest');
const APPROVED_MANIFEST_PATH = manifestIdx !== -1 ? args[manifestIdx + 1] : null;

let LIMIT = 10; // default: safe test batch
const limitIdx = args.indexOf('--limit');
if (limitIdx !== -1 && args[limitIdx + 1]) {
  LIMIT = parseInt(args[limitIdx + 1], 10);
  if (isNaN(LIMIT) || LIMIT <= 0) {
    console.error('[re-geocode] --limit must be a positive integer');
    process.exit(1);
  }
}

let START_OFFSET = 0;
const offsetIdx = args.indexOf('--offset');
if (offsetIdx !== -1 && args[offsetIdx + 1]) {
  START_OFFSET = parseInt(args[offsetIdx + 1], 10);
  if (isNaN(START_OFFSET) || START_OFFSET < 0) {
    console.error('[re-geocode] --offset must be a non-negative integer');
    process.exit(1);
  }
}

// Types

interface EventRow {
  id: string;
  title: string;
  description: string | null;
  latitude: number | null;
  longitude: number | null;
  location_name: string | null;
  event_count: number;
}

interface UpdatePayload {
  id: string;
  action: 'update' | 'delete';
  latitude: number | null;
  longitude: number | null;
  location_name: string | null;
  old_location: string | null;  // for logging only
  old_latitude: number | null;
  old_longitude: number | null;
  candidate_source: string | null;
  candidate_score: number | null;
  gazetteer_id: string | null;
  reason: string;
  diagnostic_candidates: Array<{
    id: string;
    display_name: string;
    country_code?: string;
    admin1_code?: string;
    population: number;
  }>;
}

interface ApprovedAction {
  id: string;
  action: UpdatePayload['action'];
}

// Supabase client

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Helpers

function locationNameChanged(oldName: string | null, newName: string | null): boolean {
  const a = (oldName ?? '').toLowerCase().trim();
  const b = (newName ?? '').toLowerCase().trim();
  return a !== b;
}

// Fetch events

async function fetchEvents(limit: number, offset: number): Promise<EventRow[]> {
  let query = supabase
    .from('events')
    .select('id, title, description, latitude, longitude, location_name, event_count')
    .order('published_at', { ascending: OLDEST }) // --oldest = stale rows first
    .range(offset, offset + limit - 1);
  if (!INCLUDE_CORROBORATED) query = query.eq('event_count', 1);
  const { data, error } = await query;

  if (error) {
    throw new Error(`[re-geocode] Fetch failed (offset=${offset}): ${error.message}`);
  }
  return (data as EventRow[]) ?? [];
}

// Re-geocode a single row

async function remapRow(row: EventRow): Promise<UpdatePayload | null> {
  const title       = row.title ?? '';
  const description = row.description ?? '';

  const resolution = await resolveLocation(title, description);
  if (!resolution) {
    if (row.latitude == null && row.longitude == null && row.location_name == null) return null;
    return {
      id: row.id,
      action: 'delete',
      latitude: null,
      longitude: null,
      location_name: null,
      old_location: row.location_name,
      old_latitude: row.latitude,
      old_longitude: row.longitude,
      candidate_source: null,
      candidate_score: null,
      gazetteer_id: null,
      reason: 'reviewed resolver abstention in map-only event table',
      diagnostic_candidates: [],
    };
  }

  const nameChanged = locationNameChanged(row.location_name, resolution.displayName);
  const coordsChanged = row.latitude !== resolution.lat || row.longitude !== resolution.lon;

  /*
  Canonical coordinates are now persisted, so a row with the same resolved name
  but old jittered coordinates is eligible for manual review as well.
  */
  if (!nameChanged && !coordsChanged) return null;

  return {
    id: row.id,
    action: 'update',
    latitude: resolution.lat,
    longitude: resolution.lon,
    location_name: resolution.displayName,
    old_location: row.location_name,
    old_latitude: row.latitude,
    old_longitude: row.longitude,
    candidate_source: resolution.evidence,
    candidate_score: resolution.confidence,
    gazetteer_id: resolution.gazetteerId,
    reason: nameChanged
      ? 'text-supported location changed'
      : 'canonical coordinates replace legacy ingestion jitter',
    diagnostic_candidates: resolution.candidates.map(candidate => ({
      id: candidate.id,
      display_name: candidate.displayName,
      country_code: candidate.cc,
      admin1_code: candidate.admin1Code,
      population: candidate.population,
    })),
  };
}

function toReviewRecord(change: UpdatePayload) {
  return {
    id: change.id,
    action: change.action,
    old_location: {
      display_name: change.old_location,
      latitude: change.old_latitude,
      longitude: change.old_longitude,
    },
    proposed_resolution: change.action === 'update'
      ? {
          display_name: change.location_name,
          latitude: change.latitude,
          longitude: change.longitude,
        }
      : null,
    gazetteer_candidate: change.gazetteer_id
      ? {
          id: change.gazetteer_id,
          display_name: change.location_name,
        }
      : null,
    evidence: change.candidate_source,
    confidence: change.candidate_score,
    diagnostic_candidates: change.diagnostic_candidates,
    reason: change.reason,
  };
}

async function loadApprovedActions(): Promise<Map<string, UpdatePayload['action']>> {
  if (!APPROVED_MANIFEST_PATH) return new Map();
  const { readFile } = await import('node:fs/promises');
  const parsed = JSON.parse(await readFile(APPROVED_MANIFEST_PATH, 'utf8')) as unknown;
  const actions = Array.isArray(parsed)
    ? parsed
    : (parsed && typeof parsed === 'object' && Array.isArray((parsed as { approved?: unknown }).approved)
      ? (parsed as { approved: unknown[] }).approved
      : null);
  if (
    !actions ||
    actions.some(action =>
      !action ||
      typeof action !== 'object' ||
      typeof (action as ApprovedAction).id !== 'string' ||
      !['update', 'delete'].includes((action as ApprovedAction).action)
    )
  ) {
    throw new Error('[re-geocode] Approved manifest must contain explicit {"id":"...","action":"update|delete"} entries.');
  }
  return new Map((actions as ApprovedAction[]).map(action => [action.id, action.action]));
}

// Batch update

async function batchUpdate(updates: UpdatePayload[]): Promise<number> {
  let totalUpdated = 0;

  for (let i = 0; i < updates.length; i += UPDATE_CHUNK_SIZE) {
    const chunk = updates.slice(i, i + UPDATE_CHUNK_SIZE);

    /*
    Supabase JS doesn't support bulk UPDATE with per-row values in a single call,
    so we run individual updates concurrently within each chunk (bounded parallelism).
    */
    const results = await Promise.allSettled(
      chunk.map(({ id, latitude, longitude, location_name }) =>
        supabase
          .from('events')
          .update({ latitude, longitude, location_name })
          .eq('id', id)
      )
    );

    for (let j = 0; j < results.length; j++) {
      const result = results[j];
      if (result.status === 'rejected') {
        console.error(`  [re-geocode] Update failed for id=${chunk[j].id}:`, result.reason);
      } else if (result.value.error) {
        console.error(`  [re-geocode] Update error for id=${chunk[j].id}:`, result.value.error.message);
      } else {
        totalUpdated++;
      }
    }

    console.log(`  [re-geocode] Chunk ${Math.floor(i / UPDATE_CHUNK_SIZE) + 1}: updated ${chunk.length} rows`);
  }

  return totalUpdated;
}

async function batchDelete(deletions: UpdatePayload[]): Promise<{ deleted: number; bookmarked: string[] }> {
  if (deletions.length === 0) return { deleted: 0, bookmarked: [] };

  const ids = deletions.map(deletion => deletion.id);
  const { data: bookmarkRows, error: bookmarkError } = await supabase
    .from('user_bookmarks')
    .select('event_id')
    .in('event_id', ids);
  if (bookmarkError) throw new Error(`[re-geocode] Bookmark safety check failed: ${bookmarkError.message}`);

  const bookmarked = new Set((bookmarkRows ?? []).map(row => String(row.event_id)));
  const safeIds = ids.filter(id => !bookmarked.has(id));
  let deleted = 0;

  for (let i = 0; i < safeIds.length; i += UPDATE_CHUNK_SIZE) {
    const chunk = safeIds.slice(i, i + UPDATE_CHUNK_SIZE);
    const { error } = await supabase.from('events').delete().in('id', chunk);
    if (error) {
      console.error(`[re-geocode] Delete chunk failed: ${error.message}`);
      continue;
    }
    deleted += chunk.length;
  }

  return { deleted, bookmarked: [...bookmarked] };
}

// Main execution

async function run() {
  const startMs = Date.now();
  console.log('[re-geocode] Seraphim DB Location Re-Geocoder');
  if (!DRY_RUN && !APPROVED_MANIFEST_PATH) {
    throw new Error('[re-geocode] Refusing to write without --approved-manifest. Run --dry-run first and approve explicit IDs.');
  }
  const approvedActions = await loadApprovedActions();
  const cohort = INCLUDE_CORROBORATED ? 'all events' : 'uncorroborated events only';
  console.log(`[re-geocode] Mode: ${DRY_RUN ? 'DRY RUN' : `APPROVED ACTIONS (${approvedActions.size})`} | Scope: ${FULL_RUN ? 'ALL rows' : `${LIMIT} rows`} (${cohort}) | Sort: ${OLDEST ? 'oldest first' : 'newest first'}${START_OFFSET > 0 ? ` | Offset: ${START_OFFSET}` : ''}`);
  console.log('[re-geocode] Initializing geocoding engine...');

  ensureInitialized();
  console.log('[re-geocode] Engine ready.');

  const allUpdates: UpdatePayload[] = [];
  let totalFetched = 0;
  let offset = START_OFFSET;

  // Fetch loop
  while (true) {
    const pageLimit = FULL_RUN ? FETCH_PAGE_SIZE : Math.min(LIMIT - totalFetched, FETCH_PAGE_SIZE);
    if (pageLimit <= 0) break;

    console.log(`\n[re-geocode] Fetching rows ${offset} to ${offset + pageLimit - 1}...`);
    const rows = await fetchEvents(pageLimit, offset);
    if (rows.length === 0) {
      console.log('[re-geocode] No more rows. Done fetching.');
      break;
    }

    totalFetched += rows.length;
    console.log(`[re-geocode] Processing ${rows.length} rows...`);

    // Re-geocode all rows in this page
    const pageUpdates = (
      await Promise.all(rows.map(remapRow))
    ).filter((u): u is UpdatePayload => u !== null);

    // Log what changed
    for (const u of pageUpdates) {
      const newCoords = u.latitude != null ? `(${u.latitude.toFixed(3)}, ${u.longitude!.toFixed(3)})` : '(null)';
      console.log(`  -> ${u.action.toUpperCase()} id=${u.id.slice(0, 8)}... "${u.old_location}" -> "${u.location_name}" ${newCoords}`);
    }

    allUpdates.push(...pageUpdates);
    offset += rows.length;

    if (!FULL_RUN && totalFetched >= LIMIT) break;
    if (rows.length < FETCH_PAGE_SIZE) break; // last page
  }

  // Summary
  console.log(`\n[re-geocode] Results`);
  console.log(`[re-geocode] Rows fetched  : ${totalFetched}`);
  console.log(`[re-geocode] Rows changed  : ${allUpdates.length}`);
  console.log(`[re-geocode] Rows unchanged: ${totalFetched - allUpdates.length}`);

  const { writeFile } = await import('node:fs/promises');
  await writeFile(REPORT_PATH, JSON.stringify({
    generated_at: new Date().toISOString(),
    cohort,
    fetched: totalFetched,
    proposed_changes: allUpdates.map(toReviewRecord),
  }, null, 2));
  console.log(`[re-geocode] Review report : ${REPORT_PATH}`);

  if (allUpdates.length === 0) {
    console.log('[re-geocode] Nothing to update. All locations are current.');
    return;
  }

  if (DRY_RUN) {
    console.log('[re-geocode] DRY RUN - skipping writes. Pass without --dry-run to apply.');
    return;
  }

  const approved = allUpdates.filter(update => approvedActions.get(update.id) === update.action);
  const approvedUpdates = approved.filter(update => update.action === 'update');
  const approvedDeletes = approved.filter(update => update.action === 'delete');
  console.log(`\n[re-geocode] Applying ${approvedUpdates.length} update(s) and ${approvedDeletes.length} deletion(s) from ${approved.length}/${allUpdates.length} matching approved actions...`);
  const totalUpdated = await batchUpdate(approvedUpdates);
  const deletionResult = await batchDelete(approvedDeletes);
  if (deletionResult.bookmarked.length > 0) {
    console.warn(`[re-geocode] Refused to delete ${deletionResult.bookmarked.length} bookmarked event(s): ${deletionResult.bookmarked.join(', ')}`);
  }

  const finalElapsed = ((Date.now() - startMs) / 1000).toFixed(1);
  console.log(`\n[re-geocode] Done in ${finalElapsed}s. Updated ${totalUpdated}; deleted ${deletionResult.deleted}; bookmarked deletions refused ${deletionResult.bookmarked.length}.`);
}

run().catch(err => {
  console.error('[re-geocode] Unhandled error:', err);
  process.exit(1);
});
