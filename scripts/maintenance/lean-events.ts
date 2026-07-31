/*
  Resumable, service-role maintenance for Seraphim's event archive.

  Safe defaults:
    bun run scripts/maintenance/lean-events.ts --phase all --limit 1000

  Apply explicitly:
    bun run scripts/maintenance/lean-events.ts --phase vectors --apply
    bun run scripts/maintenance/lean-events.ts --phase cleanup --apply
    bun run scripts/maintenance/lean-events.ts --phase duplicates --apply

  Non-vector phases refuse to write until stale vectors are gone and the small
  active-vector HNSW index has been rebuilt. All writes are bounded batches.
*/

import { createClient } from "@supabase/supabase-js";
import { mkdir, writeFile } from "node:fs/promises";
import type { DbEventSource } from "@/types";
import {
  canonicalizeEventUrl,
  cleanAndCapDescription,
  isClearlyNonEvent,
  normalizeTitleFingerprint,
} from "@/scraper/utils/content";

type Phase = "vectors" | "cleanup" | "duplicates" | "all";

interface MaintenanceStatus {
  rows: number;
  stale_vectors: number;
  active_vectors: number;
  self_linked_events: number;
  oversized_descriptions: number;
  expired_low_signal: number;
  table_bytes: number;
  heap_bytes: number;
  index_bytes: number;
  embedding_index_bytes: number;
  has_embedding_index: boolean;
}

interface EventRow {
  id: string;
  title: string;
  description: string | null;
  url: string;
  source: string;
  source_type: "gnews" | "rss" | "social";
  category: string | null;
  published_at: string;
  created_at: string | null;
  primary_discovered_at: string | null;
  latitude: number;
  longitude: number;
  location_name: string | null;
  credibility_tier: number;
  event_count: number;
  impact_score: number;
  sources: DbEventSource[] | null;
}

interface DuplicateScanRow {
  id: string;
  title: string;
  published_at: string;
  latitude: number;
  longitude: number;
  location_name: string | null;
}

interface MaintenanceUpdate {
  id: string;
  title?: string;
  description?: string;
  source?: string;
  source_type?: string;
  url?: string;
  credibility_tier?: number;
  published_at?: string;
  primary_discovered_at?: string;
  sources?: DbEventSource[];
  event_count?: number;
  impact_score?: number;
}

const REMOVED_PRIMARY_SOURCES = new Set([
  "Bloomberg (Telegram)",
  "Kyiv Independent (Telegram)",
  "Reddit GlobalConflict",
  "The Intel Crab (X)",
  "Bridge Michigan",
  "Cook Islands News",
  "InSight Crime",
  "Aurora Intel (X)",
  "Oliver Alexander (X)",
  "IsraelWarRoom (X)",
  "Clash Report (X)",
]);

const DEGRADED_EMPTY_SUMMARY_SOURCES = new Set([
  "Indian Express",
  "Nikkei Asia",
  "Romania Insider",
  "Nature",
]);

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const phaseValue = args[args.indexOf("--phase") + 1] ?? "all";
if (!["vectors", "cleanup", "duplicates", "all"].includes(phaseValue)) {
  throw new Error("--phase must be vectors, cleanup, duplicates, or all");
}
const PHASE = phaseValue as Phase;
const limitArg = args.indexOf("--limit");
const LIMIT = limitArg >= 0 ? Number(args[limitArg + 1]) : Number.POSITIVE_INFINITY;
const batchArg = args.indexOf("--batch-size");
const BATCH_SIZE = batchArg >= 0 ? Number(args[batchArg + 1]) : 500;
const pauseArg = args.indexOf("--pause-ms");
const PAUSE_MS = pauseArg >= 0 ? Number(args[pauseArg + 1]) : 75;

if (!Number.isFinite(BATCH_SIZE) || BATCH_SIZE < 25 || BATCH_SIZE > 1000) {
  throw new Error("--batch-size must be between 25 and 1000");
}

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");

const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const report = {
  started_at: new Date().toISOString(),
  apply: APPLY,
  phase: PHASE,
  before: null as MaintenanceStatus | null,
  after: null as MaintenanceStatus | null,
  vectors_expired: 0,
  rows_scanned: 0,
  rows_updated: 0,
  rows_deleted: 0,
  removed_source_rows: 0,
  legacy_quality_rows: 0,
  obvious_gnews_non_events: 0,
  self_links_removed: 0,
  descriptions_capped: 0,
  duplicate_groups: 0,
  duplicate_rows_removed: 0,
  skipped_bookmarked_duplicate_groups: 0,
  samples: [] as Array<{ id: string; action: string; title: string; source: string }>,
};

async function status(): Promise<MaintenanceStatus> {
  const { data, error } = await db.rpc("get_lean_maintenance_status");
  if (error) throw new Error(`Maintenance status failed: ${error.message}`);
  return data as MaintenanceStatus;
}

async function applyBatch(updates: MaintenanceUpdate[], deleteIds: string[]) {
  if (!APPLY || (updates.length === 0 && deleteIds.length === 0)) return;
  const { data, error } = await db.rpc("apply_event_maintenance_batch", {
    p_updates: updates,
    p_delete_ids: deleteIds,
  });
  if (error) throw new Error(`Maintenance batch failed: ${error.message}`);
  const result = (data as Array<{ updated_count: number; deleted_count: number }> | null)?.[0];
  report.rows_updated += result?.updated_count ?? 0;
  report.rows_deleted += result?.deleted_count ?? 0;
}

async function expireVectors() {
  if (!APPLY) return;
  let iteration = 0;
  while (true) {
    const { data, error } = await db.rpc("expire_event_embeddings_batch", { p_batch_size: 5000 });
    if (error) throw new Error(`Vector expiry failed: ${error.message}`);
    const changed = Number(data ?? 0);
    report.vectors_expired += changed;
    iteration++;
    if (iteration % 10 === 0 || changed === 0) {
      console.log(`[lean-events] vectors: ${report.vectors_expired.toLocaleString()} expired`);
    }
    if (changed === 0) break;
    await wait(PAUSE_MS);
  }

  const { data, error } = await db.rpc("rebuild_event_embedding_index");
  if (error) throw new Error(`Vector index rebuild failed: ${error.message}`);
  console.log(`[lean-events] active-vector HNSW rebuilt (${Number(data).toLocaleString()} bytes)`);
}

function normalizedSources(row: EventRow): { sources: DbEventSource[]; primaryDiscoveredAt: string; removedSelf: boolean } {
  const primaryUrl = canonicalizeEventUrl(row.url);
  const unique = new Map<string, DbEventSource>();
  let selfTimestamp: string | null = null;

  for (const source of row.sources ?? []) {
    const sourceUrl = canonicalizeEventUrl(source.url);
    if (!sourceUrl) continue;
    if (sourceUrl === primaryUrl) {
      selfTimestamp ??= source.discovered_at;
      continue;
    }
    if (!unique.has(sourceUrl)) unique.set(sourceUrl, { ...source, url: sourceUrl });
  }

  return {
    sources: [...unique.values()],
    primaryDiscoveredAt: row.primary_discovered_at ?? selfTimestamp ?? row.created_at ?? row.published_at,
    removedSelf: selfTimestamp !== null,
  };
}

function shouldDeleteHistoricalRow(
  row: EventRow,
  cleanedDescription: string,
  corroboratorCount: number,
): string | null {
  if (corroboratorCount > 0) return null;
  if (REMOVED_PRIMARY_SOURCES.has(row.source)) return "removed_source";
  if (DEGRADED_EMPTY_SUMMARY_SOURCES.has(row.source)) {
    const words = cleanedDescription.split(/\s+/).filter(Boolean).length;
    if (cleanedDescription.length < 80 || words < 12) return "legacy_quality";
  }
  if (row.source_type === "gnews" && row.category === "general" && isClearlyNonEvent({
    title: row.title,
    description: cleanedDescription,
  })) return "obvious_gnews_non_event";
  return null;
}

async function scanRows(onPage: (rows: EventRow[]) => Promise<void>) {
  let cursor: string | null = null;
  while (report.rows_scanned < LIMIT) {
    const pageSize = Math.min(BATCH_SIZE, LIMIT - report.rows_scanned);
    let query = db.from("events")
      .select("id,title,description,url,source,source_type,category,published_at,created_at,primary_discovered_at,latitude,longitude,location_name,credibility_tier,event_count,impact_score,sources")
      .order("id", { ascending: true })
      .limit(pageSize);
    if (cursor) query = query.gt("id", cursor);
    const { data, error } = await query;
    if (error) throw new Error(`Event page failed: ${error.message}`);
    const rows = (data ?? []) as EventRow[];
    if (rows.length === 0) break;
    await onPage(rows);
    report.rows_scanned += rows.length;
    cursor = rows[rows.length - 1].id;
    if (report.rows_scanned % 10_000 < BATCH_SIZE) {
      console.log(`[lean-events] scanned ${report.rows_scanned.toLocaleString()} rows`);
    }
    await wait(PAUSE_MS);
  }
}

async function scanDuplicateRows(onPage: (rows: DuplicateScanRow[]) => Promise<void>) {
  let cursor: string | null = null;
  while (report.rows_scanned < LIMIT) {
    const pageSize = Math.min(BATCH_SIZE, LIMIT - report.rows_scanned);
    let query = db.from("events")
      .select("id,title,published_at,latitude,longitude,location_name")
      .order("id", { ascending: true })
      .limit(pageSize);
    if (cursor) query = query.gt("id", cursor);
    const { data, error } = await query;
    if (error) throw new Error(`Duplicate candidate page failed: ${error.message}`);
    const rows = (data ?? []) as DuplicateScanRow[];
    if (rows.length === 0) break;
    await onPage(rows);
    report.rows_scanned += rows.length;
    cursor = rows[rows.length - 1].id;
    if (report.rows_scanned % 10_000 < BATCH_SIZE) {
      console.log(`[lean-events] scanned ${report.rows_scanned.toLocaleString()} duplicate candidates`);
    }
    await wait(PAUSE_MS);
  }
}

async function cleanArchive() {
  await scanRows(async (rows) => {
    const updates: MaintenanceUpdate[] = [];
    const deleteIds: string[] = [];

    for (const row of rows) {
      const cleanedDescription = cleanAndCapDescription(row.description);
      const normalized = normalizedSources(row);
      const deletionReason = shouldDeleteHistoricalRow(
        row,
        cleanedDescription,
        normalized.sources.length,
      );
      if (deletionReason) {
        deleteIds.push(row.id);
        if (deletionReason === "removed_source") report.removed_source_rows++;
        if (deletionReason === "legacy_quality") report.legacy_quality_rows++;
        if (deletionReason === "obvious_gnews_non_event") report.obvious_gnews_non_events++;
        if (report.samples.length < 50) report.samples.push({ id: row.id, action: `delete:${deletionReason}`, title: row.title, source: row.source });
        continue;
      }

      const sourcesChanged = JSON.stringify(normalized.sources) !== JSON.stringify(row.sources ?? []);
      const descriptionChanged = cleanedDescription !== (row.description ?? "");
      const count = 1 + normalized.sources.length;
      const countChanged = count !== row.event_count;
      const primaryTimeChanged = normalized.primaryDiscoveredAt !== row.primary_discovered_at;
      if (normalized.removedSelf) report.self_links_removed++;
      if (descriptionChanged) report.descriptions_capped++;

      if (sourcesChanged || descriptionChanged || countChanged || primaryTimeChanged) {
        updates.push({
          id: row.id,
          ...(sourcesChanged ? { sources: normalized.sources } : {}),
          ...(descriptionChanged ? { description: cleanedDescription } : {}),
          ...(countChanged ? {
            event_count: count,
            impact_score: count * (5 - (row.credibility_tier || 3)),
          } : {}),
          ...(primaryTimeChanged ? { primary_discovered_at: normalized.primaryDiscoveredAt } : {}),
        });
      }
    }

    await applyBatch(updates, deleteIds);
  });
}

function duplicateGroupKey(row: DuplicateScanRow): string | null {
  const fingerprint = normalizeTitleFingerprint(row.title);
  if (fingerprint.length < 32) return null;
  const place = (row.location_name ?? `${row.latitude.toFixed(2)},${row.longitude.toFixed(2)}`).toLocaleLowerCase("en-US");
  return `${fingerprint}\u0000${place}`;
}

async function collapseExactDuplicates() {
  const groups = new Map<string, DuplicateScanRow[]>();
  report.rows_scanned = 0;
  await scanDuplicateRows(async (rows) => {
    for (const row of rows) {
      const key = duplicateGroupKey(row);
      if (!key) continue;
      const group = groups.get(key) ?? [];
      group.push(row);
      groups.set(key, group);
    }
  });

  const candidateGroups = [...groups.values()].filter((group) => group.length > 1);
  const candidateIds = [...new Set(candidateGroups.flatMap((group) => group.map((row) => row.id)))];
  groups.clear();
  const bookmarked = new Set<string>();
  const fullRows = new Map<string, EventRow>();
  const LOOKUP_BATCH_SIZE = 500;
  for (let offset = 0; offset < candidateIds.length; offset += LOOKUP_BATCH_SIZE) {
    const ids = candidateIds.slice(offset, offset + LOOKUP_BATCH_SIZE);
    const [{ data: bookmarks, error: bookmarkError }, { data: events, error: eventError }] = await Promise.all([
      db.from("user_bookmarks").select("event_id").in("event_id", ids),
      db.from("events")
        .select("id,title,description,url,source,source_type,category,published_at,created_at,primary_discovered_at,latitude,longitude,location_name,credibility_tier,event_count,impact_score,sources")
        .in("id", ids),
    ]);
    if (bookmarkError) throw new Error(`Bookmark lookup failed: ${bookmarkError.message}`);
    if (eventError) throw new Error(`Duplicate detail lookup failed: ${eventError.message}`);
    for (const row of bookmarks ?? []) bookmarked.add(row.event_id as string);
    for (const row of (events ?? []) as EventRow[]) fullRows.set(row.id, row);
  }

  for (const candidates of candidateGroups) {
    const group = candidates
      .map((candidate) => fullRows.get(candidate.id))
      .filter((row): row is EventRow => row !== undefined);
    if (group.length < 2) continue;
    group.sort((a, b) => new Date(a.published_at).getTime() - new Date(b.published_at).getTime());

    let cluster: EventRow[] = [];
    const flush = async () => {
      if (cluster.length < 2) { cluster = []; return; }
      const distinctUrls = new Set(cluster.map((row) => canonicalizeEventUrl(row.url)));
      if (distinctUrls.size < 2) { cluster = []; return; }
      if (cluster.some((row) => bookmarked.has(row.id))) {
        report.skipped_bookmarked_duplicate_groups++;
        cluster = [];
        return;
      }

      const ranked = [...cluster].sort((a, b) =>
        a.credibility_tier - b.credibility_tier ||
        b.event_count - a.event_count ||
        (b.description?.length ?? 0) - (a.description?.length ?? 0),
      );
      const winner = ranked[0];
      const unique = new Map<string, DbEventSource>();
      for (const row of cluster) {
        const primaryUrl = canonicalizeEventUrl(row.url);
        if (row.id !== winner.id && primaryUrl && !unique.has(primaryUrl)) {
          unique.set(primaryUrl, {
            name: row.source,
            url: primaryUrl,
            source_type: row.source_type,
            discovered_at: row.primary_discovered_at ?? row.published_at,
          });
        }
        for (const source of row.sources ?? []) {
          const sourceUrl = canonicalizeEventUrl(source.url);
          if (sourceUrl && sourceUrl !== canonicalizeEventUrl(winner.url) && !unique.has(sourceUrl)) {
            unique.set(sourceUrl, { ...source, url: sourceUrl });
          }
        }
      }
      unique.delete(canonicalizeEventUrl(winner.url));
      const sources = [...unique.values()];
      const count = 1 + sources.length;
      await applyBatch([{
        id: winner.id,
        sources,
        event_count: count,
        impact_score: count * (5 - (winner.credibility_tier || 3)),
        primary_discovered_at: winner.primary_discovered_at ?? winner.published_at,
      }], cluster.filter((row) => row.id !== winner.id).map((row) => row.id));
      report.duplicate_groups++;
      report.duplicate_rows_removed += cluster.length - 1;
      cluster = [];
      await wait(PAUSE_MS);
    };

    for (const row of group) {
      const previous = cluster[cluster.length - 1];
      if (previous && new Date(row.published_at).getTime() - new Date(previous.published_at).getTime() > 72 * 60 * 60 * 1000) {
        await flush();
      }
      cluster.push(row);
    }
    await flush();
  }
}

async function main() {
  report.before = await status();
  console.log("[lean-events] before", report.before);
  if (!APPLY) console.log("[lean-events] DRY RUN — no writes will be made");

  if (PHASE === "vectors" || PHASE === "all") await expireVectors();

  if (PHASE === "cleanup" || PHASE === "duplicates" || PHASE === "all") {
    let current = await status();
    // A feed can publish an old-dated item between the initial vector pass and
    // this phase. Clear that tiny race in one bounded call instead of forcing
    // an unnecessary full index rebuild.
    if (APPLY && current.stale_vectors > 0 && current.has_embedding_index) {
      const { error } = await db.rpc("expire_event_embeddings_batch", { p_batch_size: 5000 });
      if (error) throw new Error(`Preflight vector expiry failed: ${error.message}`);
      current = await status();
    }
    if (APPLY && (current.stale_vectors > 0 || !current.has_embedding_index)) {
      throw new Error("Refusing historical writes until stale vectors are removed and the active-vector index is rebuilt. Run --phase vectors --apply first.");
    }
  }

  if (PHASE === "cleanup" || PHASE === "all") await cleanArchive();
  if (PHASE === "duplicates" || PHASE === "all") await collapseExactDuplicates();

  report.after = await status();
  const path = `scripts/results/lean-events-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  await mkdir("scripts/results", { recursive: true });
  await writeFile(path, JSON.stringify({ ...report, finished_at: new Date().toISOString() }, null, 2));
  console.log("[lean-events] after", report.after);
  console.log(`[lean-events] report: ${path}`);
}

main().catch((error) => {
  console.error("[lean-events] failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
