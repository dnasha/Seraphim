import { describe, expect, it, vi } from "vitest";
import type { NewsItem } from "@/lib/core/types";
import {
  assertCaptureBoundary,
  compareSnapshots,
  decodeCheckpoints,
  encodeCheckpoints,
  reviewedSnapshot,
  type SavedCheckpoint,
} from "@/lib/regions/checkpoints";
import { regionFromViewport, type RegionSpec } from "@/lib/regions/geometry";
import { readRegion } from "@/lib/regions/readRegion";
import {
  MAX_REGION_DETAIL_READS,
  REGION_DETAIL_CONCURRENCY,
  RegionCoverageMismatch,
} from "@/lib/regions/resolveReports";

const uuid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const event = (n = 1, extra: Partial<NewsItem> = {}): NewsItem => ({
  id: uuid(n),
  title: `Synthetic event ${n}`,
  url: `https://example.test/${n}`,
  source: "Fixture",
  sourceType: "rss",
  publishedAt: "2000-01-01",
  latitude: 0,
  longitude: 0,
  sourcesCount: 1,
  ...extra,
});
const region = regionFromViewport(
  { minLng: -10, maxLng: 10, minLat: -10, maxLat: 10 },
  "Fixture",
  "fixture",
  "2026-09-30",
);
const saved: SavedCheckpoint = {
  region,
  baseline: null,
  filters: {
    timeRange: "1d",
    customStartDate: "",
    customEndDate: "",
    query: "",
    sources: ["news", "reddit", "x", "telegram", "extra"],
    categories: ["all"],
    credibilityTiers: [1, 2, 3],
    minVolume: 1,
    sort: "hot",
  },
};
const t = (seconds: number) =>
  `2026-09-30T00:00:${String(seconds).padStart(2, "0")}Z`;
const json = (value: unknown) => new Response(JSON.stringify(value));
const feed = (items: NewsItem[], capturedAt = t(0), limit = 1000) =>
  json({
    items,
    lastUpdated: capturedAt,
    meta: {
      clustered: false,
      scope: "viewport",
      view: "sidebar",
      sort: "hot",
      isCapped: false,
      stale: false,
      appliedLimit: limit,
    },
  });
const detail = (item: NewsItem, urls = [item.url], extra = {}) =>
  json({
    event: item,
    sources: urls.map((url) => ({
      url,
      name: "Fixture",
      source_type: "rss",
      discovered_at: "2000-01-01",
    })),
    totalSources: urls.length,
    timelineRestricted: false,
    ...extra,
  });
const fixture = (
  items: NewsItem[],
  resolve = (item: NewsItem) => detail(item),
  capturedAt = t(0),
  limit = 1000,
) =>
  vi.fn<typeof fetch>().mockImplementation(async (url) => {
    const path = new URL(String(url), "https://example.test").pathname;
    return path === "/api/news"
      ? feed(items, capturedAt, limit)
      : resolve(items.find((e) => path.endsWith(e.id))!);
  });
const read = (
  fetcher: typeof fetch,
  checkpoint = saved,
  tier: "pro" | "free" = "pro",
) => readRegion(checkpoint, tier, new AbortController().signal, fetcher);

describe("bounded checkpoint report resolution", () => {
  it("does not turn duplicate tracking aliases into source-count alerts", async () => {
    const baseline = await read(fixture([event()]));
    const next = await read(
      fixture([event(1, { sourcesCount: 2 })], (e) =>
        detail(e, [e.url, `${e.url}?utm_source=fixture`]),
      ),
      { ...saved, baseline },
    );
    expect(next.coverage.reportsComplete).toBe(true);
    expect(next.events[0].reportCount).toBe(1);
    expect(compareSnapshots(baseline, next)).toEqual([]);
  });
  it("quietly establishes a lean-feed baseline, then resolves added report identities and ignores reorder/tracking noise", async () => {
    const baseline = reviewedSnapshot(null, await read(fixture([event()])));
    expect(compareSnapshots(null, baseline)).toEqual([]);
    const next = await read(
      fixture([event(1, { sourcesCount: 2 })], (e) =>
        detail(e, [e.url, "https://other.test/report"]),
      ),
      { ...saved, baseline },
    );
    expect(next.coverage).toMatchObject({
      reportsComplete: true,
      detailReadCount: 1,
      reportErrors: 0,
    });
    expect(compareSnapshots(baseline, next)[0]).toMatchObject({
      kinds: ["sources"],
      addedSources: 1,
    });
    const reviewed = reviewedSnapshot(baseline, next);
    const reorder = await read(
      fixture([event(1, { sourcesCount: 2 })], (e) =>
        detail(e, [
          "https://other.test/report?utm_source=fixture",
          `${e.url}?fbclid=fixture`,
        ]),
      ),
      { ...saved, baseline: reviewed },
    );
    expect(compareSnapshots(reviewed, reorder)).toEqual([]);
    expect(
      decodeCheckpoints(
        encodeCheckpoints([{ ...saved, baseline: reviewed }], "a"),
        "a",
      )[0].baseline,
    ).toEqual(reviewed);
  });
  it("caps detail work, prioritizes source-count increases and discloses unobserved identities", async () => {
    const items = Array.from({ length: 31 }, (_, n) => event(n + 1));
    const first = await read(fixture(items));
    expect(first.coverage).toMatchObject({
      detailReadCount: MAX_REGION_DETAIL_READS,
      unresolvedReports: 7,
      reportsComplete: false,
    });
    const baseline = reviewedSnapshot(null, first);
    items[30] = event(31, { sourcesCount: 2 });
    const fetcher = fixture(items, (e) =>
      detail(
        e,
        e.sourcesCount === 2 ? [e.url, "https://other.test/31"] : [e.url],
      ),
    );
    const next = await read(fetcher, { ...saved, baseline });
    expect(String(fetcher.mock.calls[1][0])).toContain(uuid(31));
    expect(
      compareSnapshots(baseline, next).find((c) => c.event.id === uuid(31)),
    ).toMatchObject({ kinds: ["sources"] });
    expect(fetcher.mock.calls.length).toBe(1 + MAX_REGION_DETAIL_READS);
  });
  it("rotates the bounded detail budget across previously unobserved identities", async () => {
    const items = Array.from({ length: 73 }, (_, n) => event(n + 1));
    const seen = new Set<string>();
    let checkpoint = saved;
    for (let i = 0; i < 4; i++) {
      const next = await read(
        fixture(items, (e) => {
          seen.add(e.id);
          return detail(e);
        }),
        checkpoint,
      );
      checkpoint = {
        ...saved,
        baseline: reviewedSnapshot(checkpoint.baseline, next),
      };
    }
    expect(seen.size).toBe(73);
    expect(checkpoint.baseline?.events.every((e) => e.reportsCheckedAt)).toBe(
      true,
    );
  });
  it("does not silently lose a source-count increase when report detail fails, and refuses review", async () => {
    const baseline = await read(fixture([event()]));
    const next = await read(
      fixture(
        [event(1, { sourcesCount: 2 })],
        () => new Response("", { status: 503 }),
      ),
      { ...saved, baseline },
    );
    expect(compareSnapshots(baseline, next)[0]).toMatchObject({
      kinds: ["source-count"],
      reportedSourceIncrease: 1,
    });
    expect(next.coverage).toMatchObject({
      reportsComplete: false,
      unresolvedReports: 1,
      reportErrors: 1,
    });
    expect(() => reviewedSnapshot(baseline, next)).toThrow(
      /Review is disabled/,
    );
    expect(baseline.events[0].reportCount).toBe(1);
  });
  it("respects Free previews and retains known report keys across limited observations", async () => {
    const first = await read(
      fixture(
        [event(1, { sourcesCount: 3 })],
        (e) =>
          detail(e, [e.url, "https://other.test/old"], {
            timelineRestricted: true,
            totalSources: 3,
          }),
        t(0),
        50,
      ),
      saved,
      "free",
    );
    expect(first.coverage).toMatchObject({
      timelineLimited: true,
      unresolvedReports: 1,
      reportErrors: 0,
    });
    const baseline = reviewedSnapshot(null, first);
    const next = await read(
      fixture(
        [event(1, { sourcesCount: 4 })],
        (e) =>
          detail(e, [e.url, "https://other.test/new"], {
            timelineRestricted: true,
            totalSources: 4,
          }),
        t(1),
        50,
      ),
      { ...saved, baseline },
      "free",
    );
    expect(compareSnapshots(baseline, next)[0].addedSources).toBe(1);
    expect(reviewedSnapshot(baseline, next).events[0].reports).toContain(
      "https://other.test/old",
    );
  });
  it("rejects server limit/timeline drift before claiming compatible Pro coverage", async () => {
    const limited = fixture([event()], undefined, t(0), 50);
    await expect(read(limited)).rejects.toBeInstanceOf(RegionCoverageMismatch);
    expect(limited).toHaveBeenCalledTimes(1);
    await expect(
      read(
        fixture([event()], (e) =>
          detail(e, [e.url], { timelineRestricted: true, totalSources: 3 }),
        ),
      ),
    ).rejects.toBeInstanceOf(RegionCoverageMismatch);
  });
  it("does not resolve outside or hole identities, or substitute a moved/merged detail", async () => {
    const hole: RegionSpec = {
      ...region,
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [-10, -10],
            [10, -10],
            [10, 10],
            [-10, 10],
            [-10, -10],
          ],
          [
            [-1, -1],
            [1, -1],
            [1, 1],
            [-1, 1],
            [-1, -1],
          ],
        ],
      },
    };
    const fetcher = fixture(
      [event(1), event(2, { longitude: 15 }), event(3, { longitude: 5 })],
      (e) => detail({ ...e, id: uuid(99) }),
    );
    const next = await read(fetcher, { ...saved, region: hole });
    expect(next.events.map((e) => e.id)).toEqual([uuid(3)]);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(String(fetcher.mock.calls[1][0])).toContain(uuid(3));
    expect(next.coverage.reportErrors).toBe(1);
    expect(() => reviewedSnapshot(null, next)).toThrow();
    const moved = await read(
      fixture([event()], (e) => detail({ ...e, longitude: 20 })),
    );
    expect(moved.events[0].longitude).toBe(0);
    expect(moved.coverage.reportErrors).toBe(1);
  });
  it("runs at most three details concurrently and cancellation prevents queued reads", async () => {
    const controller = new AbortController();
    let active = 0,
      peak = 0;
    const fetcher = vi.fn<typeof fetch>().mockImplementation((url, options) => {
      if (new URL(String(url), "https://example.test").pathname === "/api/news")
        return Promise.resolve(
          feed(Array.from({ length: 30 }, (_, n) => event(n + 1))),
        );
      active++;
      peak = Math.max(peak, active);
      return new Promise((_resolve, reject) =>
        options!.signal!.addEventListener(
          "abort",
          () => {
            active--;
            reject(options!.signal!.reason);
          },
          { once: true },
        ),
      );
    });
    const pending = readRegion(saved, "pro", controller.signal, fetcher);
    await vi.waitFor(() => expect(active).toBe(REGION_DETAIL_CONCURRENCY));
    controller.abort(new Error("Fixture account switched"));
    await expect(pending).rejects.toThrow(/account switched/);
    expect(peak).toBe(REGION_DETAIL_CONCURRENCY);
    expect(fetcher).toHaveBeenCalledTimes(1 + REGION_DETAIL_CONCURRENCY);
    expect(active).toBe(0);
  });
});

describe("capture and antimeridian regression boundaries", () => {
  it("rejects a newer → older → newer cache sequence without reverting reviewed fingerprints", async () => {
    const baseline = await read(
      fixture([event(1, { title: "Corrected" })], undefined, t(50)),
    );
    const older = await read(fixture([event()], undefined, t(10)));
    expect(() => reviewedSnapshot(baseline, older)).toThrow(/older/);
    expect(compareSnapshots(baseline, older)).toEqual([]);
    await expect(
      read(fixture([event()], undefined, t(10)), { ...saved, baseline }),
    ).rejects.toThrow(/older/);
    const newest = await read(
      fixture([event(1, { title: "Corrected" })], undefined, t(55)),
      { ...saved, baseline },
    );
    expect(compareSnapshots(baseline, newest)).toEqual([]);
  });
  it("tracks each split capture instead of relying on the oldest aggregate timestamp", async () => {
    const wide = regionFromViewport(
      { minLng: -120, maxLng: 120, minLat: -10, maxLat: 10 },
      "Wide",
      "wide",
      "2026-09-30",
    );
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(feed([], t(10)))
      .mockResolvedValueOnce(feed([], t(30)));
    const baseline = await read(fetcher, { ...saved, region: wide });
    const oldPart = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(feed([], t(20)))
      .mockResolvedValueOnce(feed([], t(20)));
    await expect(
      read(oldPart, { ...saved, region: wide, baseline }),
    ).rejects.toThrow(/older/);
  });
  it("retains per-event captures when an overlapping newer observation goes missing", async () => {
    const overlapping: RegionSpec = {
      ...region,
      geometry: {
        type: "MultiPolygon",
        coordinates: [
          region.geometry.type === "Polygon" ? region.geometry.coordinates : [],
          [
            [
              [-5, -5],
              [5, -5],
              [5, 5],
              [-5, 5],
              [-5, -5],
            ],
          ],
        ],
      },
    };
    let feedCount = 0;
    const fetcher = fixture([event()]);
    const baseline = await read(
      vi
        .fn<typeof fetch>()
        .mockImplementation(async (url) =>
          String(url).startsWith("/api/news?")
            ? feed([event()], ++feedCount === 1 ? t(30) : t(10))
            : fetcher(url),
        ),
      { ...saved, region: overlapping },
    );
    feedCount = 0;
    const later = vi
      .fn<typeof fetch>()
      .mockImplementation(async () =>
        ++feedCount === 1
          ? feed([], t(40))
          : feed([event(1, { title: "Old" })], t(20)),
      );
    await expect(
      read(later, { ...saved, region: overlapping, baseline }),
    ).rejects.toThrow(/older/);
    expect(baseline.events[0].capturedAt).toBe(new Date(t(30)).toISOString());
  });
  it("canonicalizes ±180 for changes and dedup, uses circular tolerance, and still detects actual movement", async () => {
    const crossing = regionFromViewport(
      { minLng: 170, maxLng: 190, minLat: -10, maxLat: 10 },
      "Crossing",
      "crossing",
      "2026-09-30",
    );
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(feed([event(1, { longitude: 180 })]))
      .mockResolvedValueOnce(feed([event(1, { longitude: -180 })]))
      .mockResolvedValueOnce(detail(event(1, { longitude: -180 })));
    const baseline = await read(fetcher, { ...saved, region: crossing });
    expect(baseline.events[0].longitude).toBe(-180);
    expect(baseline.coverage).toMatchObject({
      readCount: 2,
      detailReadCount: 1,
    });
    for (const longitude of [180, -180, 179.999999]) {
      const next = structuredClone(baseline);
      next.events[0].longitude = longitude;
      expect(compareSnapshots(baseline, next)).toEqual([]);
    }
    const moved = structuredClone(baseline);
    moved.events[0].longitude = 179.9;
    expect(compareSnapshots(baseline, moved)[0].kinds).toContain("correction");
    const next = structuredClone(baseline);
    next.events[0].longitude = 179.999999;
    const seam = structuredClone(baseline);
    seam.events[0].longitude = -179.999999;
    expect(compareSnapshots(next, seam)).toEqual([]);
  });
  it("validates new coverage metadata and preserves the explicit rebaseline flag on reload", async () => {
    const baseline = await read(fixture([event()]));
    const raw = encodeCheckpoints(
      [{ ...saved, baseline, rebaselineRequired: true }],
      "a",
    );
    expect(decodeCheckpoints(raw, "a")[0].rebaselineRequired).toBe(true);
    for (const bad of [
      { ...baseline.coverage, detailReadCount: 25 },
      { ...baseline.coverage, unresolvedReports: -1 },
      { ...baseline.coverage, captures: [] },
      { ...baseline.coverage, appliedLimits: [50] },
    ])
      expect(() =>
        encodeCheckpoints(
          [{ ...saved, baseline: { ...baseline, coverage: bad } }],
          "a",
        ),
      ).toThrow();
    expect(() => assertCaptureBoundary(baseline, baseline)).not.toThrow();
  });
});
