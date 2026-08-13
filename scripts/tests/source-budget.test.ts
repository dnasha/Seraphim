import { describe, expect, it } from "vitest";
import { applySourceNoveltyLimits } from "@/scraper/sourceBudget";
import type { NewsItem } from "@/lib/core/types";

const item = (id: number, source = "Noisy"): NewsItem => ({
  id: String(id), title: `Event ${id}`, url: `https://example.com/${id}`,
  source, sourceType: "rss", publishedAt: "2026-01-01T00:00:00Z",
});

describe("adaptive source novelty budget", () => {
  it("applies a permissive source-specific cap without affecting other sources", () => {
    const result = applySourceNoveltyLimits(
      [...Array.from({ length: 25 }, (_, i) => item(i)), item(99, "Healthy")],
      new Map([["Noisy", 20]]),
    );
    expect(result.accepted).toHaveLength(21);
    expect(result.cappedBySource).toEqual({ Noisy: 5 });
  });

  it("uses a conservative default cap for unclassified sources", () => {
    const result = applySourceNoveltyLimits(
      Array.from({ length: 25 }, (_, i) => item(i, "Unknown")),
      new Map(),
    );
    expect(result.accepted).toHaveLength(20);
    expect(result.cappedBySource).toEqual({ Unknown: 5 });
  });

  it("raises source caps by 50 percent for emergency recovery", () => {
    const result = applySourceNoveltyLimits(
      Array.from({ length: 35 }, (_, i) => item(i)),
      new Map([["Noisy", 20]]),
      1.5,
    );
    expect(result.accepted).toHaveLength(30);
    expect(result.cappedBySource).toEqual({ Noisy: 5 });
  });
});
