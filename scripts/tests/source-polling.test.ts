import { describe, expect, it } from "vitest";
import {
  BASE_POLL_INTERVAL_MS,
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
});
