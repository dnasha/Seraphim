import type { NewsResponse, NewsItem } from "@/lib/core/types";
import { getEntitlements, type UserTier } from "@/lib/entitlements";
import {
  regionContains,
  regionReadBounds,
  regionLongitudeDistance,
} from "./geometry";
import { RegionCoverageMismatch, resolveRegionReports } from "./resolveReports";
import {
  filtersAllowed,
  filterKey,
  fingerprint,
  assertCaptureBoundary,
  type SavedCheckpoint,
  type CheckpointSnapshot,
  type EventFingerprint,
  type Coverage,
} from "./checkpoints";

/** Use the entitled feed transport only; never send names, holes, IDs or baselines. */
export async function readRegion(
  checkpoint: SavedCheckpoint,
  tier: UserTier,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<CheckpointSnapshot> {
  const f = checkpoint.filters;
  if (!filtersAllowed(f, tier))
    throw new Error(
      "Saved filters are unavailable on this plan. Use current filters to reset the baseline.",
    );
  const events = new Map<string, EventFingerprint>();
  const coverage: Coverage = {
    capturedAt: "",
    checkedAt: "",
    capped: false,
    stale: false,
    timelineLimited: getEntitlements(tier).timelineSourceLimit !== null,
    readCount: 0,
    observedCount: 0,
    appliedLimits: [] as number[],
    captures: [],
    detailReadCount: 0,
    unresolvedReports: 0,
    reportsComplete: false,
    reportErrors: 0,
  };
  let capturedAt = Infinity;
  for (const bounds of regionReadBounds(checkpoint.region.geometry)) {
    signal.throwIfAborted();
    const params = new URLSearchParams({
      view: "sidebar",
      scope: "viewport",
      force_raw: "true",
      sort: f.sort,
      time_range: f.timeRange,
      limit: String(getEntitlements(tier).eventLimit),
      sources: f.sources.join(","),
      categories: f.categories.join(","),
      credibility: f.credibilityTiers.join(","),
      min_reports: String(f.minVolume),
      minLat: String(bounds.minLat),
      maxLat: String(bounds.maxLat),
      minLng: String(bounds.minLng),
      maxLng: String(bounds.maxLng),
    });
    if (f.query) params.set("query", f.query);
    if (f.timeRange === "custom") {
      params.set("since", new Date(f.customStartDate).toISOString());
      params.set("until", new Date(f.customEndDate).toISOString());
    }
    const response = await fetcher(`/api/news?${params}`, {
      signal,
      cache: "no-store",
      credentials: "same-origin",
    });
    if (!response.ok)
      throw new Error(
        response.status === 403
          ? "Saved filters are unavailable on this plan. Use current filters to reset the baseline."
          : `Region check failed (${response.status}). Previous review is unchanged.`,
      );
    const data = (await response.json()) as NewsResponse;
    signal.throwIfAborted();
    const meta = data.meta;
    if (
      !meta ||
      meta.clustered !== false ||
      meta.scope !== "viewport" ||
      meta.view !== "sidebar" ||
      meta.sort !== f.sort ||
      typeof meta.isCapped !== "boolean" ||
      typeof meta.stale !== "boolean" ||
      !Number.isInteger(meta.appliedLimit) ||
      meta.appliedLimit! < 1 ||
      !Array.isArray(data.items) ||
      data.items.length > meta.appliedLimit! ||
      !Number.isFinite(Date.parse(data.lastUpdated))
    )
      throw new Error(
        "Region coverage could not be verified. Previous review is unchanged.",
      );
    if (meta.appliedLimit !== getEntitlements(tier).eventLimit)
      throw new RegionCoverageMismatch(
        "Server event coverage differs from this plan. Refresh account access, check again, and explicitly establish a compatible baseline.",
      );
    capturedAt = Math.min(capturedAt, Date.parse(data.lastUpdated));
    coverage.readCount++;
    coverage.appliedLimits.push(meta.appliedLimit!);
    coverage.captures!.push({
      scope: JSON.stringify(bounds),
      capturedAt: new Date(Date.parse(data.lastUpdated)).toISOString(),
    });
    coverage.capped ||= meta.isCapped;
    coverage.stale ||= meta.stale;
    for (const item of data.items) {
      validateItem(item);
      // Validate canonical/raw identity before membership: never trust centroids.
      const event = fingerprint({ ...item, sources: undefined });
      event.capturedAt = new Date(Date.parse(data.lastUpdated)).toISOString();
      event.reportsComplete = false;
      if (
        !regionContains(
          checkpoint.region.geometry,
          event.longitude,
          event.latitude,
        )
      )
        continue;
      const prior = events.get(event.id);
      if (prior) {
        if (
          prior.title !== event.title ||
          prior.location !== event.location ||
          regionLongitudeDistance(prior.longitude, event.longitude) > 1e-5 ||
          Math.abs(prior.latitude - event.latitude) > 1e-5
        )
          throw new Error(
            "An event changed between region reads. Check again before reviewing.",
          );
        event.reports = [
          ...new Set([...prior.reports, ...event.reports]),
        ].sort();
        event.reportCount = Math.max(
          prior.reportCount ?? 0,
          event.reportCount ?? 0,
        );
        if (Date.parse(prior.capturedAt!) > Date.parse(event.capturedAt!))
          event.capturedAt = prior.capturedAt;
      }
      events.set(event.id, event);
    }
  }
  coverage.observedCount = events.size;
  coverage.capturedAt = new Date(capturedAt).toISOString();
  const snapshot: CheckpointSnapshot = {
    observationVersion: 2,
    tier,
    filterKey: filterKey(f),
    events: [...events.values()].sort((a, b) => a.id.localeCompare(b.id)),
    coverage,
  };
  assertCaptureBoundary(checkpoint.baseline, snapshot);
  if (!coverage.stale)
    Object.assign(
      coverage,
      await resolveRegionReports(
        snapshot.events,
        checkpoint.region,
        tier,
        checkpoint.baseline,
        signal,
        fetcher,
      ),
    );
  else coverage.unresolvedReports = snapshot.events.length;
  coverage.reportsComplete = coverage.unresolvedReports === 0;
  coverage.checkedAt = new Date().toISOString();
  return snapshot;
}
function validateItem(item: NewsItem): void {
  if (
    !item ||
    typeof item.id !== "string" ||
    (item.originalId != null && typeof item.originalId !== "string") ||
    typeof item.title !== "string" ||
    typeof item.url !== "string" ||
    (item.sourcesCount != null &&
      (!Number.isInteger(item.sourcesCount) ||
        item.sourcesCount < 0 ||
        item.sourcesCount > 1_000_000)) ||
    (item.locationName != null &&
      (typeof item.locationName !== "string" ||
        item.locationName.length > 1000)) ||
    typeof item.latitude !== "number" ||
    typeof item.longitude !== "number" ||
    Math.abs(item.longitude) > 180 ||
    Math.abs(item.latitude) > 90 ||
    (item.sources != null &&
      (!Array.isArray(item.sources) ||
        item.sources.length > 1000 ||
        item.sources.some((s) => !s || typeof s.url !== "string")))
  )
    throw new Error("Invalid event response. Previous review is unchanged.");
}
