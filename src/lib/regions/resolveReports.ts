import type { NewsItem } from "@/lib/core/types";
import { getEntitlements, type UserTier } from "@/lib/entitlements";
import {
  fingerprint,
  type CheckpointSnapshot,
  type EventFingerprint,
} from "./checkpoints";
import {
  regionContains,
  regionLongitudeDistance,
  type RegionSpec,
} from "./geometry";

export const MAX_REGION_DETAIL_READS = 24;
export const REGION_DETAIL_CONCURRENCY = 3;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export class RegionCoverageMismatch extends Error {}

/** Resolve only identities observed inside the entitled saved feed scope. */
export async function resolveRegionReports(
  events: EventFingerprint[],
  region: RegionSpec,
  tier: UserTier,
  baseline: CheckpointSnapshot | null,
  signal: AbortSignal,
  fetcher: typeof fetch,
): Promise<{
  detailReadCount: number;
  unresolvedReports: number;
  timelineLimited: boolean;
  reportErrors: number;
}> {
  const known = new Map(baseline?.events.map((e) => [e.id, e]));
  // Count increases get the first opportunity for identity resolution under the budget.
  const priority = (e: EventFingerprint) => {
    const old = known.get(e.id);
    return old && (e.reportCount ?? 0) > (old.reportCount ?? old.reports.length)
      ? 0
      : 1;
  };
  const queue = [...events]
    .filter((e) => uuid.test(e.id))
    .sort(
      (a, b) =>
        priority(a) - priority(b) ||
        (known.get(a.id)?.reportsCheckedAt ?? "").localeCompare(
          known.get(b.id)?.reportsCheckedAt ?? "",
        ) ||
        a.id.localeCompare(b.id),
    )
    .slice(0, MAX_REGION_DETAIL_READS);
  const sourceLimit = getEntitlements(tier).timelineSourceLimit;
  const work = new AbortController();
  const abort = () => work.abort(signal.reason);
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  let cursor = 0,
    detailReadCount = 0,
    reportErrors = 0,
    timelineLimited = sourceLimit !== null;
  const worker = async () => {
    while (cursor < queue.length) {
      work.signal.throwIfAborted();
      const event = queue[cursor++];
      detailReadCount++;
      try {
        const response = await fetcher(
          `/api/news/${encodeURIComponent(event.id)}?refresh=true`,
          {
            signal: work.signal,
            cache: "no-store",
            credentials: "same-origin",
          },
        );
        work.signal.throwIfAborted();
        if (!response.ok) {
          reportErrors++;
          continue;
        }
        const data = await response.json();
        work.signal.throwIfAborted();
        if (
          !data ||
          typeof data.timelineRestricted !== "boolean" ||
          !Number.isInteger(data.totalSources) ||
          data.totalSources < 0 ||
          data.totalSources > 1_000_000 ||
          !Array.isArray(data.sources) ||
          data.sources.length > 1000 ||
          data.sources.some(
            (s: { url?: unknown } | null) => !s || typeof s.url !== "string",
          ) ||
          !data.event ||
          typeof data.event.url !== "string" ||
          (typeof data.event.locationName !== "string" &&
            data.event.locationName != null)
        ) {
          reportErrors++;
          continue;
        }
        if (data.timelineRestricted && sourceLimit === null) {
          throw new RegionCoverageMismatch(
            "Server source coverage differs from this plan. Refresh account access, check again, and explicitly establish a compatible baseline.",
          );
        }
        const item = data.event as NewsItem;
        if (
          typeof item.id !== "string" ||
          (item.originalId != null && typeof item.originalId !== "string") ||
          !Number.isFinite(item.longitude) ||
          Math.abs(item.longitude!) > 180 ||
          !Number.isFinite(item.latitude) ||
          Math.abs(item.latitude!) > 90
        ) {
          reportErrors++;
          continue;
        }
        const detail = fingerprint({
          ...item,
          sources: data.sources.map((s: { url: string }) => ({
            url: s.url,
            name: "",
            sourceType: "rss",
            discoveredAt: "",
          })),
        });
        // Do not substitute a moved/merged event or bypass geometry with exact-ID lookup.
        if (
          detail.id !== event.id ||
          !regionContains(region.geometry, detail.longitude, detail.latitude) ||
          detail.title !== event.title ||
          detail.location !== event.location ||
          regionLongitudeDistance(detail.longitude, event.longitude) > 1e-5 ||
          Math.abs(detail.latitude - event.latitude) > 1e-5
        ) {
          reportErrors++;
          continue;
        }
        if (sourceLimit !== null && data.sources.length > sourceLimit) {
          reportErrors++;
          continue;
        }
        if (data.totalSources < detail.reports.length) {
          reportErrors++;
          continue;
        }
        event.reports = detail.reports;
        event.reportsComplete =
          !data.timelineRestricted && data.totalSources === data.sources.length;
        event.reportsCheckedAt = new Date().toISOString();
        // Full timelines can contain tracking aliases of the same report. Once
        // resolved, count canonical identities rather than raw feed/source rows.
        event.reportCount = event.reportsComplete
          ? detail.reports.length
          : Math.max(event.reportCount ?? 0, data.totalSources);
        timelineLimited ||= data.timelineRestricted;
      } catch (error) {
        if (error instanceof RegionCoverageMismatch) {
          work.abort(error);
          throw error;
        }
        if (work.signal.aborted) throw work.signal.reason ?? error;
        reportErrors++;
        // Missing, invalid, throttled or unavailable detail stays explicitly unresolved.
      }
    }
  };
  try {
    const results = await Promise.allSettled(
      Array.from(
        { length: Math.min(REGION_DETAIL_CONCURRENCY, queue.length) },
        worker,
      ),
    );
    if (work.signal.reason instanceof RegionCoverageMismatch)
      throw work.signal.reason;
    const failed = results.find((r) => r.status === "rejected");
    if (failed?.status === "rejected") throw failed.reason;
    signal.throwIfAborted();
    return {
      detailReadCount,
      unresolvedReports: events.filter((e) => !e.reportsComplete).length,
      timelineLimited,
      reportErrors,
    };
  } finally {
    signal.removeEventListener("abort", abort);
  }
}
