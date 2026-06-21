import { describe, expect, it } from "vitest";
import { applyClientJitter } from "@/components/map/utils";
import type { NewsItem } from "@/lib/core/types";

const story = (id: string, overrides: Partial<NewsItem> = {}): NewsItem => ({
  id,
  title: id,
  url: `https://example.com/${id}`,
  source: "Example",
  sourceType: "rss",
  publishedAt: "2026-01-01T00:00:00.000Z",
  latitude: 40,
  longitude: -74,
  ...overrides,
});

describe("applyClientJitter", () => {
  it("is deterministic and spreads overlapping raw markers", () => {
    const input = [story("b"), story("a"), story("c")];
    const first = applyClientJitter(input);
    const second = applyClientJitter(input);

    expect(first).toEqual(second);
    expect(new Set(first.map((entry) => `${entry.latitude},${entry.longitude}`)).size).toBe(3);
    expect(first).not.toEqual(input);
  });

  it("uses the selected canonical item as the first spiral position", () => {
    const [selected, other] = applyClientJitter([story("a"), story("b")], "b");
    const distance = (entry: NewsItem) => Math.hypot(entry.latitude! - 40, entry.longitude! + 74);

    expect(selected.id).toBe("a");
    expect(distance(other)).toBeLessThan(distance(selected));
  });

  it("does not move unmapped, unique, or server-clustered items", () => {
    const unique = story("unique", { latitude: 1, longitude: 2 });
    const unmapped = story("unmapped", { latitude: undefined, longitude: undefined });
    const cluster = story("cluster", { storyCount: 2 });
    const result = applyClientJitter([unique, unmapped, cluster]);

    expect(result).toEqual([unique, unmapped, cluster]);
  });

  it("wraps jittered markers around the dateline", () => {
    const result = applyClientJitter([story("a", { longitude: 179.99999 }), story("b", { longitude: 179.99999 })]);
    expect(result.every((entry) => entry.longitude! >= -180 && entry.longitude! < 180)).toBe(true);
  });
});
