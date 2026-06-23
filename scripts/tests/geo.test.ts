import { describe, expect, it } from "vitest";
import { isWithinBBox, snapBBox } from "@/lib/utils/geo";
import type { BBox, NewsItem } from "@/lib/core/types";

const item = (overrides: Partial<NewsItem> = {}): NewsItem => ({
  id: "event-1",
  title: "Event",
  url: "https://example.com/event",
  source: "Example",
  sourceType: "rss",
  publishedAt: "2026-01-01T00:00:00.000Z",
  latitude: 10,
  longitude: 10,
  ...overrides,
});

const bbox = (overrides: Partial<BBox> = {}): BBox => ({
  minLat: -10,
  maxLat: 20,
  minLng: -20,
  maxLng: 20,
  zoom: 8,
  ...overrides,
});

describe("snapBBox", () => {
  it("uses a full-world request at low zoom", () => {
    expect(snapBBox(bbox({ zoom: 2.4, minLat: 12, maxLat: 14, minLng: 30, maxLng: 40 }))).toMatchObject({
      minLat: -90,
      maxLat: 90,
      minLng: -180,
      maxLng: 180,
      zoom: 2,
    });
  });

  it("snaps to the zoom-specific grid without exceeding latitude limits", () => {
    expect(snapBBox(bbox({ zoom: 8.2, minLat: -88.1, maxLat: 89.2, minLng: 1.2, maxLng: 9.1 }))).toMatchObject({
      minLat: -90,
      maxLat: 90,
      minLng: 0,
      maxLng: 10,
      zoom: 8,
    });
  });

  it("normalizes a snapped antimeridian request", () => {
    expect(snapBBox(bbox({ zoom: 11, minLng: 178.1, maxLng: 181.1 }))).toMatchObject({
      minLng: 178,
      maxLng: -178,
    });
  });

  it("treats a viewport wider than the world as a full-world longitude query", () => {
    expect(snapBBox(bbox({ zoom: 8, minLng: -220, maxLng: 220 }))).toMatchObject({
      minLng: -180,
      maxLng: 180,
    });
  });
});

describe("isWithinBBox", () => {
  it("handles antimeridian-crossing viewports", () => {
    const pacific = bbox({ minLng: 170, maxLng: -170 });
    expect(isWithinBBox(item({ longitude: 179 }), pacific)).toBe(true);
    expect(isWithinBBox(item({ longitude: -179 }), pacific)).toBe(true);
    expect(isWithinBBox(item({ longitude: 0 }), pacific)).toBe(false);
  });

  it("checks query text before spatial matching", () => {
    const scoped = bbox({ query: "kyiv" });
    expect(isWithinBBox(item({ title: "Kyiv update" }), scoped)).toBe(true);
    expect(isWithinBBox(item({ title: "Elsewhere", locationName: "Kyiv" }), scoped)).toBe(true);
    expect(isWithinBBox(item({ title: "Elsewhere", description: "Report from Kyiv" }), scoped)).toBe(true);
    expect(isWithinBBox(item({ title: "Elsewhere" }), scoped)).toBe(false);
  });

  it("rejects items without a complete coordinate pair", () => {
    expect(isWithinBBox(item({ latitude: undefined, longitude: undefined }), bbox())).toBe(false);
  });

  it("skips longitude filtering for a global low-zoom viewport while preserving latitude bounds", () => {
    const world = bbox({ zoom: 2, minLat: -30, maxLat: 30, minLng: 170, maxLng: -170 });
    expect(isWithinBBox(item({ latitude: 20, longitude: 0 }), world)).toBe(true);
    expect(isWithinBBox(item({ latitude: 45, longitude: 0 }), world)).toBe(false);
  });
});
