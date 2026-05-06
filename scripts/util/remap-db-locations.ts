/*
Seraphim Database Location Remapper
Re-geocodes existing DB events using the current local geocoding engine
and updates only the rows whose location changed.

Pipeline:
1. Fetch events in pages (SELECT id, title, description, latitude, longitude, location_name).
2. Re-run extractLocation + geocodeLocation on each row.
3. Diff old vs new coords (using COORD_EPSILON tolerance).
4. Batch UPDATE only the changed rows (chunked, service-role key).

Usage:
# Test on 10 rows first (default, most recent)
$env:IS_BENCHMARK="true"; bun run scripts/util/remap-db-locations.ts

# Dry-run: shows what would change without writing to DB
$env:IS_BENCHMARK="true"; bun run scripts/util/remap-db-locations.ts --dry-run

# Test oldest 10 rows (more likely to have stale geocoding)
$env:IS_BENCHMARK="true"; bun run scripts/util/remap-db-locations.ts --oldest --dry-run

# Process 50 rows starting from row 100
$env:IS_BENCHMARK="true"; bun run scripts/util/remap-db-locations.ts --limit 50 --offset 100

# Full run across ALL events (use after validating)
$env:IS_BENCHMARK="true"; bun run scripts/util/remap-db-locations.ts --all

Flags:
--dry-run       Show changes without writing to DB
--all           Process all rows (ignores --limit)
--limit N       Process N rows (default: 10)
--offset N      Start from row N (default: 0)
--oldest        Sort ascending (targets oldest/most stale rows first)

Environment (loaded from .env.local by Bun automatically):
SUPABASE_URL               - Supabase project URL
SUPABASE_SERVICE_ROLE_KEY  - Service-role key (bypasses RLS for writes)
*/

import { createClient } from '@supabase/supabase-js';
import { extractLocation, geocodeLocation, ensureInitialized } from '../../src/lib/geocoding/engine';

// Configuration

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('[remap] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
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

let LIMIT = 10; // default: safe test batch
const limitIdx = args.indexOf('--limit');
if (limitIdx !== -1 && args[limitIdx + 1]) {
  LIMIT = parseInt(args[limitIdx + 1], 10);
  if (isNaN(LIMIT) || LIMIT <= 0) {
    console.error('[remap] --limit must be a positive integer');
    process.exit(1);
  }
}

let START_OFFSET = 0;
const offsetIdx = args.indexOf('--offset');
if (offsetIdx !== -1 && args[offsetIdx + 1]) {
  START_OFFSET = parseInt(args[offsetIdx + 1], 10);
  if (isNaN(START_OFFSET) || START_OFFSET < 0) {
    console.error('[remap] --offset must be a non-negative integer');
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
}

interface UpdatePayload {
  id: string;
  latitude: number | null;
  longitude: number | null;
  location_name: string | null;
  old_location: string | null;  // for logging only
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
  const { data, error } = await supabase
    .from('events')
    .select('id, title, description, latitude, longitude, location_name')
    .order('published_at', { ascending: OLDEST }) // --oldest = stale rows first
    .range(offset, offset + limit - 1);

  if (error) {
    throw new Error(`[remap] Fetch failed (offset=${offset}): ${error.message}`);
  }
  return (data as EventRow[]) ?? [];
}

// Re-geocode a single row

async function remapRow(row: EventRow): Promise<UpdatePayload | null> {
  const title       = row.title ?? '';
  const description = row.description ?? '';

  const { match } = extractLocation(title, description);
  if (!match) {
    /* 
    Engine found nothing. Never downgrade an existing location to null -
    the old value may be from a source-default or enricher fallback that
    the content-only engine can't reproduce.
    */
    return null;
  }

  const geo = await geocodeLocation(match);
  if (!geo) {
    // Extracted a name but can't resolve coords - don't downgrade existing data.
    return null;
  }

  const nameChanged = locationNameChanged(row.location_name, geo.displayName);

  /*
  If the location name is the same, skip - coord differences are just ingestion jitter.
  We only want to update rows where the engine resolves a genuinely different place.
  */
  if (!nameChanged) return null;

  return {
    id: row.id,
    latitude: geo.lat,
    longitude: geo.lon,
    location_name: geo.displayName,
    old_location: row.location_name,
  };
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
        console.error(`  [remap] Update failed for id=${chunk[j].id}:`, result.reason);
      } else if (result.value.error) {
        console.error(`  [remap] Update error for id=${chunk[j].id}:`, result.value.error.message);
      } else {
        totalUpdated++;
      }
    }

    console.log(`  [remap] Chunk ${Math.floor(i / UPDATE_CHUNK_SIZE) + 1}: updated ${chunk.length} rows`);
  }

  return totalUpdated;
}

// Main execution

async function run() {
  const startMs = Date.now();
  console.log('[remap] Seraphim DB Location Remapper');
  console.log(`[remap] Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'} | Scope: ${FULL_RUN ? 'ALL rows' : `${LIMIT} rows`} | Sort: ${OLDEST ? 'oldest first' : 'newest first'}${START_OFFSET > 0 ? ` | Offset: ${START_OFFSET}` : ''}`);
  console.log('[remap] Initializing geocoding engine...');

  ensureInitialized();
  console.log('[remap] Engine ready.');

  const allUpdates: UpdatePayload[] = [];
  let totalFetched = 0;
  let offset = START_OFFSET;

  // Fetch loop
  while (true) {
    const pageLimit = FULL_RUN ? FETCH_PAGE_SIZE : Math.min(LIMIT - totalFetched, FETCH_PAGE_SIZE);
    if (pageLimit <= 0) break;

    console.log(`\n[remap] Fetching rows ${offset} to ${offset + pageLimit - 1}...`);
    const rows = await fetchEvents(pageLimit, offset);
    if (rows.length === 0) {
      console.log('[remap] No more rows. Done fetching.');
      break;
    }

    totalFetched += rows.length;
    console.log(`[remap] Processing ${rows.length} rows...`);

    // Re-geocode all rows in this page
    const pageUpdates = (
      await Promise.all(rows.map(remapRow))
    ).filter((u): u is UpdatePayload => u !== null);

    // Log what changed
    for (const u of pageUpdates) {
      const newCoords = u.latitude != null ? `(${u.latitude.toFixed(3)}, ${u.longitude!.toFixed(3)})` : '(null)';
      console.log(`  -> id=${u.id.slice(0, 8)}... "${u.old_location}" -> "${u.location_name}" ${newCoords}`);
    }

    allUpdates.push(...pageUpdates);
    offset += rows.length;

    if (!FULL_RUN && totalFetched >= LIMIT) break;
    if (rows.length < FETCH_PAGE_SIZE) break; // last page
  }

  // Summary
  console.log(`\n[remap] Results`);
  console.log(`[remap] Rows fetched  : ${totalFetched}`);
  console.log(`[remap] Rows changed  : ${allUpdates.length}`);
  console.log(`[remap] Rows unchanged: ${totalFetched - allUpdates.length}`);

  if (allUpdates.length === 0) {
    console.log('[remap] Nothing to update. All locations are current.');
    return;
  }

  if (DRY_RUN) {
    console.log('[remap] DRY RUN - skipping writes. Pass without --dry-run to apply.');
    return;
  }

  // Write updates
  console.log(`\n[remap] Writing ${allUpdates.length} updates to Supabase...`);
  const totalUpdated = await batchUpdate(allUpdates);

  const finalElapsed = ((Date.now() - startMs) / 1000).toFixed(1);
  console.log(`\n[remap] Done in ${finalElapsed}s. Successfully updated ${totalUpdated}/${allUpdates.length} rows.`);
}

run().catch(err => {
  console.error('[remap] Unhandled error:', err);
  process.exit(1);
});

