import { describe, expect, it, vi } from "vitest";
import {
  checkpointStorageKey,
  compareSnapshots,
  decodeCheckpoints,
  encodeCheckpoints,
  filterKey,
  fingerprint,
  filtersAllowed,
  MAX_REGIONS,
  reviewedSnapshot,
  type CheckpointSnapshot,
  type RegionFilters,
  type SavedCheckpoint,
} from "@/lib/regions/checkpoints";
import {
  regionContains,
  regionFromViewport,
  regionReadBounds,
  validateRegionSpec,
  type RegionSpec,
} from "@/lib/regions/geometry";
import { readRegion } from "@/lib/regions/readRegion";
import type { NewsItem, NewsResponse } from "@/lib/core/types";

export const filters: RegionFilters = {
  timeRange: "1d",
  customStartDate: "",
  customEndDate: "",
  query: "",
  sources: ["news", "reddit", "x", "telegram", "extra"],
  categories: ["all"],
  credibilityTiers: [1, 2, 3],
  minVolume: 1,
  sort: "hot",
};
const region = regionFromViewport(
  { minLng: -10, maxLng: 10, minLat: -10, maxLat: 10 },
  "Test region",
  "test",
  "2026-09-30T00:00:00Z",
);
const saved: SavedCheckpoint = { region, filters, baseline: null };
const event = (id: string, extra: Partial<NewsItem> = {}): NewsItem => ({
  id,
  title: `Test event ${id}`,
  url: `https://example.test/${id}`,
  source: "Test Publisher",
  sourceType: "rss",
  publishedAt: "2000-01-01T00:00:00Z",
  longitude: 0,
  latitude: 0,
  ...extra,
});
const snapshot = (
  items: NewsItem[],
  extra: Partial<CheckpointSnapshot["coverage"]> = {},
): CheckpointSnapshot => ({
  tier: "free",
  filterKey: filterKey(filters),
  events: items.map(fingerprint),
  coverage: {
    capturedAt: "2026-09-30T00:00:00Z",
    checkedAt: "2026-09-30T00:01:00Z",
    capped: false,
    stale: false,
    timelineLimited: true,
    readCount: 1,
    observedCount: items.length,
    appliedLimits: [50],
    ...extra,
  },
});
const response = (
  items: NewsItem[],
  meta: Partial<NonNullable<NewsResponse["meta"]>> = {},
): NewsResponse => ({
  items,
  lastUpdated: "2026-09-30T00:00:00Z",
  meta: {
    sort: "hot",
    view: "sidebar",
    scope: "viewport",
    clustered: false,
    isCapped: false,
    stale: false,
    appliedLimit: 50,
    zoomBucket: null,
    ...meta,
  },
  sources: { gnews: null, rss: null, social: null },
});
const fetchResult = (data: NewsResponse) =>
  vi
    .fn<typeof fetch>()
    .mockImplementation(async () => new Response(JSON.stringify(data)));

describe("region checkpoint observation and review", () => {
  it("first check establishes baseline, reload preserves it, late old-published arrivals are new observations", () => {
    const first = snapshot([event("a")]);
    expect(compareSnapshots(null, first)).toEqual([]);
    const baseline = reviewedSnapshot(null, first);
    const reloaded = decodeCheckpoints(
      encodeCheckpoints([{ ...saved, baseline }], "account-a"),
      "account-a",
    )[0];
    const next = snapshot([event("a"), event("late")]);
    expect(
      compareSnapshots(reloaded.baseline, next).map((c) => c.event.id),
    ).toEqual(["late"]);
    expect(compareSnapshots(reloaded.baseline, next)[0].kinds).toEqual([
      "event",
    ]);
  });
  it("mark reviewed uses the displayed snapshot rather than subsequent arrivals", () => {
    const baseline = snapshot([event("a")]);
    const displayed = snapshot([event("a"), event("b")]);
    const later = snapshot([event("a"), event("b"), event("c")]);
    const reviewed = reviewedSnapshot(baseline, displayed);
    displayed.events[0].reports.push("mutation");
    expect(reviewed.events[0].reports).not.toContain("mutation");
    expect(compareSnapshots(reviewed, later).map((c) => c.event.id)).toEqual([
      "c",
    ]);
  });
  it("ignores source reorder, tracking URL noise and mutable publication timestamps", () => {
    const sources = [
      {
        name: "Test",
        url: "https://example.test/report",
        sourceType: "rss",
        discoveredAt: "2026-01-01",
      },
      {
        name: "Other",
        url: "https://other.test/report",
        sourceType: "rss",
        discoveredAt: "2026-01-01",
      },
    ];
    const a = event("a", { sources });
    const b = event("a", {
      url: `${a.url}?utm_source=test#fragment`,
      publishedAt: "2026-09-30",
      sources: [...sources]
        .reverse()
        .map((s) => ({ ...s, url: `${s.url}?fbclid=test` })),
    });
    expect(compareSnapshots(snapshot([a]), snapshot([b]))).toEqual([]);
  });
  it("detects added reports and observable title/location corrections together", () => {
    const a = snapshot([event("a")]);
    const b = snapshot([
      event("a", {
        title: "Corrected test headline",
        longitude: 2,
        locationName: "Test location",
        sources: [
          {
            name: "Another",
            url: "https://other.test/a",
            sourceType: "rss",
            discoveredAt: "",
          },
        ],
      }),
    ]);
    expect(compareSnapshots(a, b)[0]).toMatchObject({
      kinds: ["sources", "correction"],
      addedSources: 1,
    });
  });
  it("canonicalizes raw/single representative identity and refuses multi-event centroids", () => {
    const a = snapshot([
      event("a", { originalId: "a", id: "cluster-z3-0-0-1" }),
    ]);
    expect(a.events[0].id).toBe("a");
    expect(compareSnapshots(a, snapshot([event("a")]))).toEqual([]);
    expect(() => fingerprint(event("cluster-z3-0-0-2"))).toThrow();
    expect(() =>
      fingerprint(event("a", { originalId: "a", storyCount: 2 })),
    ).toThrow();
  });
  it("labels shared-report identity changes uncertain without claiming merge lineage", () => {
    const before = snapshot([event("a")]);
    const after = snapshot([event("b", { url: event("a").url })]);
    expect(compareSnapshots(before, after)[0].kinds).toEqual(["identity"]);
  });
  it("retains missing identities and sources under capped and complete coverage", () => {
    const a = snapshot([event("a"), event("b")]);
    const capped = snapshot([event("a", { url: "https://new.test/report" })], {
      capped: true,
    });
    const review = reviewedSnapshot(a, capped);
    expect(review.events.map((e) => e.id)).toEqual(["a", "b"]);
    expect(review.events[0].reports).toContain(event("a").url);
    expect(compareSnapshots(review, a)).toEqual([]);
    expect(reviewedSnapshot(review, snapshot([])).events).toEqual(
      review.events,
    );
  });
  it("stale results cannot advance and incompatible plan/filter resets rebaseline", () => {
    const a = snapshot([event("a")]);
    expect(() => reviewedSnapshot(a, snapshot([], { stale: true }))).toThrow(
      /Stale/,
    );
    const changedTier = { ...snapshot([event("b")]), tier: "pro" as const };
    expect(compareSnapshots(a, changedTier)).toEqual([]);
    expect(() => reviewedSnapshot(a, changedTier)).toThrow(
      /compatible baseline/,
    );
    expect(reviewedSnapshot(null, changedTier).events.map((e) => e.id)).toEqual(
      ["b"],
    );
    const changedFilters = {
      ...snapshot([event("b")]),
      filterKey: filterKey({ ...filters, categories: ["world"] }),
    };
    expect(compareSnapshots(a, changedFilters)).toEqual([]);
    expect(
      filterKey({
        ...filters,
        sources: [...filters.sources].reverse(),
        sort: "new",
      }),
    ).toBe(filterKey(filters));
    expect(filtersAllowed({ ...filters, timeRange: "1m" }, "free")).toBe(false);
    expect(filtersAllowed(filters, "guest")).toBe(false);
  });
  it("validates versioned account storage, quotas, canonical IDs and deletion", () => {
    expect(checkpointStorageKey("a")).not.toBe(checkpointStorageKey("b"));
    expect(decodeCheckpoints(null, "a")).toEqual([]);
    const raw = encodeCheckpoints([saved], "a");
    expect(() => decodeCheckpoints(raw, "b")).toThrow();
    expect(() =>
      decodeCheckpoints(raw.replace('"version":1', '"version":2'), "a"),
    ).toThrow();
    expect(() => decodeCheckpoints("bad json", "a")).toThrow();
    expect(() =>
      encodeCheckpoints(
        Array.from({ length: MAX_REGIONS + 1 }, () => saved),
        "a",
      ),
    ).toThrow();
    expect(() =>
      encodeCheckpoints(
        [
          {
            ...saved,
            baseline: {
              ...snapshot([event("a")]),
              events: [{ ...fingerprint(event("a")), id: "cluster-z4-bad" }],
            },
          },
        ],
        "a",
      ),
    ).toThrow();
  });
});

describe("bounded region geometry", () => {
  const crossing: RegionSpec = {
    ...region,
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [170, -10],
          [-170, -10],
          [-170, 10],
          [170, 10],
          [170, -10],
        ],
        [
          [175, -2],
          [-175, -2],
          [-175, 2],
          [175, 2],
          [175, -2],
        ],
      ],
    },
  };
  it("uses lon/lat membership, excludes holes including their boundaries, and handles the antimeridian", () => {
    validateRegionSpec(crossing);
    expect(regionContains(crossing.geometry, 172, 0)).toBe(true);
    expect(regionContains(crossing.geometry, -172, 0)).toBe(true);
    expect(regionContains(crossing.geometry, 179, 0)).toBe(false);
    expect(regionContains(crossing.geometry, 175, 0)).toBe(false);
    expect(regionContains(crossing.geometry, 0, 0)).toBe(false);
    expect(regionContains(crossing.geometry, 180, 8)).toBe(true);
    expect(regionReadBounds(crossing.geometry)).toEqual([
      { minLat: -10, maxLat: 10, minLng: 170, maxLng: 180 },
      { minLat: -10, maxLat: 10, minLng: -180, maxLng: -170 },
    ]);
  });
  it("splits a captured wide viewport instead of interpreting its long edges as short crossings", () => {
    const world = regionFromViewport(
      { minLng: -180, maxLng: 180, minLat: -80, maxLat: 80 },
      "World",
      "world",
      region.createdAt,
    );
    for (const x of [-179, -100, 0, 100, 179])
      expect(regionContains(world.geometry, x, 0)).toBe(true);
    const viewport = regionFromViewport(
      { minLng: 170, maxLng: 190, minLat: -10, maxLat: 10 },
      "Crossing",
      "crossing",
      region.createdAt,
    );
    expect(regionContains(viewport.geometry, -175, 0)).toBe(true);
    expect(regionContains(viewport.geometry, 0, 0)).toBe(false);
  });
  it("rejects malformed, self-crossing, oversized geometry and invalid holes", () => {
    for (const coordinates of [
      [],
      [
        [
          [0, 0],
          [1, 1],
          [1, 0],
          [0, 1],
          [0, 0],
        ],
      ],
      [
        [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 1],
        ],
      ],
      [
        [
          [181, 0],
          [182, 0],
          [182, 1],
          [181, 0],
        ],
      ],
      [
        region.geometry.type === "Polygon"
          ? region.geometry.coordinates[0]
          : [],
        [
          [20, 20],
          [21, 20],
          [21, 21],
          [20, 20],
        ],
      ],
    ]) {
      expect(() =>
        validateRegionSpec({
          ...region,
          geometry: { type: "Polygon", coordinates },
        }),
      ).toThrow();
    }
    expect(() =>
      validateRegionSpec({
        ...crossing,
        geometry: {
          type: "MultiPolygon",
          coordinates: Array(9).fill(
            crossing.geometry.type === "Polygon"
              ? crossing.geometry.coordinates
              : [],
          ),
        },
      }),
    ).toThrow();
  });
});

describe("entitled raw reads", () => {
  it("reads the saved scope independently, omits private metadata, splits/dedups and filters holes", async () => {
    const crossing = validateRegionSpec({
      ...region,
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [170, -10],
            [-170, -10],
            [-170, 10],
            [170, 10],
            [170, -10],
          ],
          [
            [175, -2],
            [-175, -2],
            [-175, 2],
            [175, 2],
            [175, -2],
          ],
        ],
      },
    });
    const fetcher = fetchResult(
      response([
        event("a", { longitude: 172 }),
        event("hole", { longitude: 179 }),
        event("outside", { longitude: 0 }),
      ]),
    );
    const result = await readRegion(
      { ...saved, region: crossing },
      "free",
      new AbortController().signal,
      fetcher,
    );
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(result.events.map((e) => e.id)).toEqual(["a"]);
    expect(result.coverage).toMatchObject({
      observedCount: 1,
      readCount: 2,
      timelineLimited: true,
    });
    const [url, options] = fetcher.mock.calls[0];
    const params = new URL(String(url), "https://example.test").searchParams;
    expect(params.get("force_raw")).toBe("true");
    expect(params.get("scope")).toBe("viewport");
    expect(params.get("limit")).toBe("50");
    expect(String(url)).not.toContain("Test region");
    expect(String(url)).not.toContain("baseline");
    expect(options?.cache).toBe("no-store");
  });
  it.each([
    { clustered: true },
    { stale: undefined },
    { scope: "global" as const },
    { isCapped: undefined },
    { appliedLimit: 1000 },
  ])("rejects unverifiable coverage %j", async (meta) => {
    await expect(
      readRegion(
        saved,
        "free",
        new AbortController().signal,
        fetchResult(response([event("a")], meta)),
      ),
    ).rejects.toThrow(/coverage/);
  });
  it("propagates capped/stale and errors; abort cancels multi-read work", async () => {
    const result = await readRegion(
      saved,
      "free",
      new AbortController().signal,
      fetchResult(response([event("a")], { stale: true, isCapped: true })),
    );
    expect(result.coverage).toMatchObject({ stale: true, capped: true });
    const fail = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("", { status: 503 }));
    await expect(
      readRegion(saved, "free", new AbortController().signal, fail),
    ).rejects.toThrow(/503/);
    const controller = new AbortController();
    controller.abort();
    const fetcher = fetchResult(response([]));
    await expect(
      readRegion(saved, "free", controller.signal, fetcher),
    ).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
});
