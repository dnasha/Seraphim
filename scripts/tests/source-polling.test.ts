import { describe, expect, it } from "vitest";
import {
  BASE_POLL_INTERVAL_MS,
  expandedItemLimit,
  isPollDue,
  rssPollTier,
  selectDueSources,
  selectRecentFeedItems,
  socialPollTier,
} from "@/lib/api/sourcePolling";

describe("source polling policy", () => {
  it("polls fast, normal, and slow sources on deterministic 15-minute slots", () => {
    expect(isPollDue("fast", BASE_POLL_INTERVAL_MS)).toBe(true);
    expect(isPollDue("normal", BASE_POLL_INTERVAL_MS)).toBe(false);
    expect(isPollDue("slow", BASE_POLL_INTERVAL_MS)).toBe(false);
    expect(isPollDue("normal", BASE_POLL_INTERVAL_MS * 2)).toBe(true);
    expect(isPollDue("slow", BASE_POLL_INTERVAL_MS * 4)).toBe(true);
  });

  it("keeps crisis and high-yield sources fast while slowing analysis feeds", () => {
    expect(rssPollTier({ name: "USGS Earthquakes", category: "crisis" })).toBe("fast");
    expect(rssPollTier({ name: "CFR", category: "world" })).toBe("slow");
    expect(rssPollTier({ name: "Ordinary Regional", category: "world" })).toBe("normal");
    expect(socialPollTier({ name: "Example Telegram", platform: "telegram" })).toBe("fast");
    expect(socialPollTier({ name: "Michael Kofman (X)", platform: "x" })).toBe("normal");
  });

  it("rejects stale and future-dated entries while retaining undated feed items", () => {
    const now = Date.parse("2026-01-02T00:00:00Z");
    const selected = selectRecentFeedItems([
      { id: "recent", date: "2026-01-01T23:00:00Z" },
      { id: "future", date: "2026-01-02T02:00:00Z" },
      { id: "stale", date: "2025-12-20T00:00:00Z" },
      { id: "undated" },
    ], (item) => item.date, { limit: 10, maxAgeMs: 48 * 60 * 60 * 1000, now });

    expect(selected.map((item) => item.id)).toEqual(["recent", "undated"]);
  });

  it("selects only sources due in the current slot", () => {
    const sources = ["fast", "normal", "slow"] as const;
    expect(selectDueSources(sources, (tier) => tier, BASE_POLL_INTERVAL_MS * 2))
      .toEqual(["fast", "normal"]);
  });

  it('stagger-distributes normal and slow sources across their polling windows', () => {
    const sources = Array.from({ length: 12 }, (_, index) => ({ name: `Source ${index}` }));
    const normalCounts = new Map(sources.map((source) => [source.name, 0]));
    const slowCounts = new Map(sources.map((source) => [source.name, 0]));
    for (let slot = 0; slot < 2; slot++) {
      for (const source of selectDueSources(sources, () => 'normal', BASE_POLL_INTERVAL_MS * slot)) {
        normalCounts.set(source.name, normalCounts.get(source.name)! + 1);
      }
    }
    for (let slot = 0; slot < 4; slot++) {
      for (const source of selectDueSources(sources, () => 'slow', BASE_POLL_INTERVAL_MS * slot)) {
        slowCounts.set(source.name, slowCounts.get(source.name)! + 1);
      }
    }
    expect([...normalCounts.values()]).toEqual(Array(12).fill(1));
    expect([...slowCounts.values()]).toEqual(Array(12).fill(1));
  });

  it("forces all sources and moderately expands item counts in emergency mode", () => {
    const sources = ["fast", "normal", "slow"] as const;
    expect(selectDueSources(sources, (tier) => tier, BASE_POLL_INTERVAL_MS, true))
      .toEqual(sources);
    expect(expandedItemLimit(10, true)).toBe(15);
    expect(expandedItemLimit(10)).toBe(10);
  });
});
