import type { NewsItem } from "@/lib/core/types";
import { canonicalNewsId } from "@/lib/utils/ranking";
import { reportIdentityKey } from "@/lib/utils/reportIdentity";
import {
  canUseTimeRange,
  getEntitlements,
  hasFeature,
  type UserTier,
  type TimeRangeKey,
} from "@/lib/entitlements";
import { NEWS_SOURCES, NEWS_CATEGORIES } from "@/lib/utils/newsFilterParams";
import {
  normalizeRegionLongitude,
  regionLongitudeDistance,
  validateRegionSpec,
  type RegionSpec,
} from "./geometry";

export interface RegionFilters {
  timeRange: TimeRangeKey;
  customStartDate: string;
  customEndDate: string;
  query: string;
  sources: string[];
  categories: string[];
  credibilityTiers: number[];
  minVolume: number;
  sort: "new" | "hot";
}
export interface EventFingerprint {
  id: string;
  title: string;
  location: string;
  longitude: number;
  latitude: number;
  reports: string[];
  reportCount?: number;
  reportsComplete?: boolean;
  capturedAt?: string;
  reportsCheckedAt?: string;
}
export interface Coverage {
  capturedAt: string;
  checkedAt: string;
  capped: boolean;
  stale: boolean;
  timelineLimited: boolean;
  readCount: number;
  observedCount: number;
  appliedLimits: number[];
  captures?: { scope: string; capturedAt: string }[];
  detailReadCount?: number;
  unresolvedReports?: number;
  reportsComplete?: boolean;
  reportErrors?: number;
}
export interface CheckpointSnapshot {
  observationVersion?: 2;
  tier: UserTier;
  filterKey: string;
  events: EventFingerprint[];
  coverage: Coverage;
}
export interface SavedCheckpoint {
  region: RegionSpec;
  filters: RegionFilters;
  baseline: CheckpointSnapshot | null;
  rebaselineRequired?: boolean;
}
export type ChangeKind =
  "event" | "sources" | "source-count" | "correction" | "identity";
export interface RegionChange {
  event: EventFingerprint;
  kinds: ChangeKind[];
  addedSources: number;
  reportedSourceIncrease?: number;
  previous?: EventFingerprint;
}
export const MAX_REGIONS = 8;
export const MAX_KNOWN_EVENTS = 4000;
export const MAX_REPORT_KEYS = 20_000;
export const MAX_STORAGE_BYTES = 2 * 1024 * 1024;
export const checkpointStorageKey = (account: string) =>
  `seraphim:experiment:region-checkpoints:v1:${encodeURIComponent(account)}`;
export const filterKey = (f: RegionFilters) =>
  JSON.stringify({
    ...f,
    sources: [...f.sources].sort(),
    categories: [...f.categories].sort(),
    credibilityTiers: [...f.credibilityTiers].sort(),
    sort: undefined,
  });
const text = (s: string) => s.trim().replace(/\s+/g, " ");
export function validateFilters(value: unknown): RegionFilters {
  if (!value || typeof value !== "object")
    throw new Error("Invalid saved filters.");
  const f = value as RegionFilters;
  const strings = (v: unknown, allowed: readonly string[]) =>
    Array.isArray(v) &&
    v.length <= allowed.length &&
    v.every((s) => typeof s === "string" && allowed.includes(s)) &&
    new Set(v).size === v.length;
  if (
    !["1d", "3d", "1w", "1m", "custom"].includes(f.timeRange) ||
    typeof f.query !== "string" ||
    f.query.length > 160 ||
    !strings(f.sources, NEWS_SOURCES) ||
    !strings(f.categories, NEWS_CATEGORIES) ||
    !Array.isArray(f.credibilityTiers) ||
    f.credibilityTiers.length > 3 ||
    !f.credibilityTiers.every((n) => [1, 2, 3].includes(n)) ||
    !Number.isInteger(f.minVolume) ||
    f.minVolume < 1 ||
    f.minVolume > 100000 ||
    !["new", "hot"].includes(f.sort) ||
    typeof f.customStartDate !== "string" ||
    f.customStartDate.length > 40 ||
    typeof f.customEndDate !== "string" ||
    f.customEndDate.length > 40 ||
    (f.timeRange === "custom" &&
      (!Number.isFinite(Date.parse(f.customStartDate)) ||
        !Number.isFinite(Date.parse(f.customEndDate)) ||
        Date.parse(f.customStartDate) > Date.parse(f.customEndDate)))
  )
    throw new Error("Invalid saved filters.");
  return structuredClone(f);
}
export function filtersAllowed(f: RegionFilters, tier: UserTier): boolean {
  return (
    tier !== "guest" &&
    canUseTimeRange(tier, f.timeRange) &&
    (!f.query || hasFeature(tier, "search")) &&
    (hasFeature(tier, "advancedFilters") ||
      (f.minVolume === 1 && f.credibilityTiers.length === 3))
  );
}
export function fingerprint(item: NewsItem): EventFingerprint {
  const id = canonicalNewsId(item);
  if (
    !id ||
    id.startsWith("cluster-z") ||
    (item.storyCount ?? 1) > 1 ||
    typeof item.title !== "string" ||
    item.title.length > 1000 ||
    !Number.isFinite(item.longitude) ||
    !Number.isFinite(item.latitude)
  )
    throw new Error(
      "The response did not contain individual events. No checkpoint was advanced.",
    );
  const reports = [
    ...new Set(
      [item.url, ...(item.sources ?? []).map((s) => s.url)]
        .filter(Boolean)
        .map((url) => reportIdentityKey(url)),
    ),
  ].sort();
  if (
    id.length > 500 ||
    reports.some((s) => s.length > 2048) ||
    reports.length > 1000
  )
    throw new Error(
      "Event exceeds checkpoint limits. No checkpoint was advanced.",
    );
  return {
    id,
    title: text(item.title),
    location: text(item.locationName ?? ""),
    longitude: normalizeRegionLongitude(item.longitude!),
    latitude: item.latitude!,
    reports,
    reportCount:
      Number.isInteger(item.sourcesCount) && item.sourcesCount! >= 0
        ? item.sourcesCount
        : reports.length,
  };
}
export function snapshotsCompatible(
  a: CheckpointSnapshot,
  b: CheckpointSnapshot,
): boolean {
  return (
    a.tier === b.tier &&
    a.filterKey === b.filterKey &&
    a.observationVersion === b.observationVersion &&
    a.coverage.appliedLimits.every(
      (limit) => limit === getEntitlements(b.tier).eventLimit,
    )
  );
}
/** Capture time, rather than publication or check time, bounds comparable observations. */
export function assertCaptureBoundary(
  baseline: CheckpointSnapshot | null,
  next: CheckpointSnapshot,
): void {
  if (
    !baseline ||
    baseline.tier !== next.tier ||
    baseline.filterKey !== next.filterKey
  )
    return;
  const fail = () => {
    throw new Error(
      "Region data is older than the last reviewed capture. Check again; the previous review is unchanged.",
    );
  };
  const previousCaptures = new Map(
    baseline.coverage.captures?.map((c) => [c.scope, Date.parse(c.capturedAt)]),
  );
  if (next.coverage.captures?.length) {
    for (const c of next.coverage.captures) {
      const boundary =
        previousCaptures.get(c.scope) ??
        Date.parse(baseline.coverage.capturedAt);
      if (Date.parse(c.capturedAt) < boundary) fail();
    }
  } else if (
    Date.parse(next.coverage.capturedAt) <
    Date.parse(baseline.coverage.capturedAt)
  )
    fail();
  const known = new Map(baseline.events.map((e) => [e.id, e]));
  for (const e of next.events) {
    const prior = known.get(e.id);
    if (
      prior &&
      Date.parse(e.capturedAt ?? next.coverage.capturedAt) <
        Date.parse(prior.capturedAt ?? baseline.coverage.capturedAt)
    )
      fail();
  }
}
export function compareSnapshots(
  baseline: CheckpointSnapshot | null,
  next: CheckpointSnapshot,
): RegionChange[] {
  if (!baseline || !snapshotsCompatible(baseline, next)) return [];
  try {
    assertCaptureBoundary(baseline, next);
  } catch {
    return [];
  }
  const known = new Map(baseline.events.map((e) => [e.id, e]));
  const reportOwners = new Map<string, Set<string>>();
  for (const e of baseline.events)
    for (const r of e.reports) {
      const owners = reportOwners.get(r) ?? new Set();
      owners.add(e.id);
      reportOwners.set(r, owners);
    }
  return next.events.flatMap((event) => {
    const previous = known.get(event.id);
    if (!previous) {
      const overlap = event.reports.some((r) => reportOwners.has(r));
      return [
        {
          event,
          kinds: [overlap ? "identity" : "event"] as ChangeKind[],
          addedSources: 0,
        },
      ];
    }
    const kinds: ChangeKind[] = [];
    const addedSources = event.reports.filter(
      (r) => !previous.reports.includes(r),
    ).length;
    if (addedSources) kinds.push("sources");
    const reportedSourceIncrease = Math.max(
      0,
      (event.reportCount ?? event.reports.length) -
        (previous.reportCount ?? previous.reports.length),
    );
    if (reportedSourceIncrease > addedSources && !event.reportsComplete)
      kinds.push("source-count");
    if (
      event.title !== previous.title ||
      event.location !== previous.location ||
      regionLongitudeDistance(event.longitude, previous.longitude) > 1e-5 ||
      Math.abs(event.latitude - previous.latitude) > 1e-5
    )
      kinds.push("correction");
    return kinds.length
      ? [{ event, kinds, addedSources, reportedSourceIncrease, previous }]
      : [];
  });
}
/** Retain observed identities/sources even when results age out or coverage is capped. */
export function reviewedSnapshot(
  baseline: CheckpointSnapshot | null,
  displayed: CheckpointSnapshot,
): CheckpointSnapshot {
  if (displayed.coverage.stale)
    throw new Error("Stale results cannot be marked reviewed.");
  if (displayed.coverage.reportErrors)
    throw new Error(
      "Report details are unavailable. Review is disabled; the previous baseline is unchanged.",
    );
  assertCaptureBoundary(baseline, displayed);
  const compatible = baseline && snapshotsCompatible(baseline, displayed);
  if (baseline && !compatible)
    throw new Error(
      "Coverage changed. Explicitly establish a compatible baseline before reviewing changes.",
    );
  const events = new Map(
    (compatible ? baseline!.events : []).map((e) => [e.id, e]),
  );
  for (const event of displayed.events)
    events.set(event.id, {
      ...event,
      longitude: normalizeRegionLongitude(event.longitude),
      reportsCheckedAt:
        event.reportsCheckedAt ?? events.get(event.id)?.reportsCheckedAt,
      reportCount: Math.max(
        events.get(event.id)?.reportCount ?? 0,
        event.reportCount ?? event.reports.length,
      ),
      reports: [
        ...new Set([
          ...(events.get(event.id)?.reports ?? []),
          ...event.reports,
        ]),
      ].sort(),
    });
  if (
    events.size > MAX_KNOWN_EVENTS ||
    [...events.values()].reduce((sum, e) => sum + e.reports.length, 0) >
      MAX_REPORT_KEYS
  )
    throw new Error(
      "Checkpoint memory is full. Delete or reset this region to start a new baseline.",
    );
  return { ...structuredClone(displayed), events: [...events.values()] };
}
interface StoredCheckpoints {
  version: 1;
  account: string;
  regions: SavedCheckpoint[];
}
function validateSnapshot(s: CheckpointSnapshot): void {
  if (
    !s ||
    !["free", "pro", "analyst", "angel"].includes(s.tier) ||
    typeof s.filterKey !== "string" ||
    s.filterKey.length > 4000 ||
    !Array.isArray(s.events) ||
    s.events.length > MAX_KNOWN_EVENTS ||
    !s.coverage
  )
    throw new Error("Invalid checkpoint snapshot.");
  const c = s.coverage;
  if (s.observationVersion != null && s.observationVersion !== 2)
    throw new Error("Invalid observation version.");
  if (
    s.observationVersion === 2 &&
    (!Array.isArray(c.captures) ||
      c.captures.length !== c.readCount ||
      c.captures.some(
        (v) =>
          !v ||
          typeof v.scope !== "string" ||
          v.scope.length > 256 ||
          !Number.isFinite(Date.parse(v.capturedAt)),
      ) ||
      new Set(c.captures.map((v) => v.scope)).size !== c.captures.length ||
      !Number.isInteger(c.detailReadCount) ||
      c.detailReadCount! < 0 ||
      c.detailReadCount! > 24 ||
      !Number.isInteger(c.unresolvedReports) ||
      c.unresolvedReports! < 0 ||
      c.unresolvedReports! > c.observedCount ||
      typeof c.reportsComplete !== "boolean" ||
      c.reportsComplete !== (c.unresolvedReports === 0) ||
      c.reportErrors !== 0 ||
      c.appliedLimits.some(
        (limit) => limit !== getEntitlements(s.tier).eventLimit,
      ))
  )
    throw new Error("Invalid checkpoint report coverage.");
  if (
    ![c.capturedAt, c.checkedAt].every(
      (t) => typeof t === "string" && Number.isFinite(Date.parse(t)),
    ) ||
    typeof c.capped !== "boolean" ||
    c.stale !== false ||
    typeof c.timelineLimited !== "boolean" ||
    !Number.isInteger(c.readCount) ||
    c.readCount < 1 ||
    c.readCount > 16 ||
    !Number.isInteger(c.observedCount) ||
    c.observedCount < 0 ||
    c.observedCount > 16000 ||
    !Array.isArray(c.appliedLimits) ||
    c.appliedLimits.length !== c.readCount ||
    c.appliedLimits.some((n) => !Number.isInteger(n) || n < 1 || n > 1000)
  )
    throw new Error("Invalid checkpoint coverage.");
  let reports = 0;
  const ids = new Set();
  for (const e of s.events) {
    if (
      s.observationVersion === 2 &&
      (typeof e.capturedAt !== "string" ||
        !Number.isFinite(Date.parse(e.capturedAt)) ||
        typeof e.reportsComplete !== "boolean" ||
        !Number.isInteger(e.reportCount) ||
        e.reportCount! < 0 ||
        e.reportCount! > 1_000_000 ||
        (e.reportsCheckedAt != null &&
          (typeof e.reportsCheckedAt !== "string" ||
            !Number.isFinite(Date.parse(e.reportsCheckedAt)))))
    )
      throw new Error("Invalid event observation coverage.");
    if (
      !e ||
      typeof e.id !== "string" ||
      !e.id ||
      e.id.length > 500 ||
      e.id.startsWith("cluster-z") ||
      ids.has(e.id) ||
      typeof e.title !== "string" ||
      e.title.length > 1000 ||
      typeof e.location !== "string" ||
      e.location.length > 1000 ||
      !Number.isFinite(e.longitude) ||
      Math.abs(e.longitude) > 180 ||
      !Number.isFinite(e.latitude) ||
      Math.abs(e.latitude) > 90 ||
      !Array.isArray(e.reports) ||
      e.reports.length > 1000 ||
      e.reports.some((r) => typeof r !== "string" || !r || r.length > 2048)
    )
      throw new Error("Invalid checkpoint event.");
    ids.add(e.id);
    reports += e.reports.length;
  }
  if (reports > MAX_REPORT_KEYS) throw new Error("Checkpoint memory is full.");
}
export function decodeCheckpoints(
  raw: string | null,
  account: string,
): SavedCheckpoint[] {
  if (raw === null) return [];
  if (new TextEncoder().encode(raw).length > MAX_STORAGE_BYTES)
    throw new Error(
      "Saved checkpoints exceed the local quota. Clear local checkpoints to recover.",
    );
  const data = JSON.parse(raw) as StoredCheckpoints;
  if (
    !data ||
    data.version !== 1 ||
    data.account !== account ||
    !Array.isArray(data.regions) ||
    data.regions.length > MAX_REGIONS
  )
    throw new Error(
      "Saved checkpoints are incompatible. Clear local checkpoints to recover.",
    );
  const ids = new Set();
  return data.regions.map((r) => {
    const region = validateRegionSpec(r.region),
      filters = validateFilters(r.filters);
    if (
      r.rebaselineRequired != null &&
      typeof r.rebaselineRequired !== "boolean"
    )
      throw new Error("Invalid baseline compatibility.");
    if (ids.has(region.id)) throw new Error("Duplicate saved region.");
    ids.add(region.id);
    if (r.baseline !== null) {
      validateSnapshot(r.baseline);
      if (r.baseline.filterKey !== filterKey(filters))
        throw new Error("Saved filters and baseline differ.");
    }
    return {
      region,
      filters,
      baseline: r.baseline,
      ...(r.rebaselineRequired == null
        ? {}
        : { rebaselineRequired: r.rebaselineRequired }),
    };
  });
}
export function encodeCheckpoints(
  regions: SavedCheckpoint[],
  account: string,
): string {
  const raw = JSON.stringify({ version: 1, account, regions });
  decodeCheckpoints(raw, account);
  return raw;
}
