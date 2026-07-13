import { describe, expect, it, vi } from "vitest";
import type { DbEvent } from "@/types";

vi.mock("@/lib/utils/vectorize", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/utils/vectorize")>();
  return {
    ...actual,
    generateEmbeddings: vi.fn(async (texts: string[]) =>
      texts.map(() => Array.from({ length: 384 }, (_, index) => index === 0 ? 1 : 0)),
    ),
  };
});

import { resolveStoryMerges } from "@/scraper/merger";

const incoming = (): DbEvent => ({
  title: "Port facility struck in Example City",
  description: "Officials reported damage at the port after an overnight strike.",
  url: "https://incoming.example/report",
  source: "Incoming",
  source_type: "rss",
  category: "crisis",
  published_at: "2026-07-12T12:00:00.000Z",
  latitude: 10,
  longitude: 20,
  location_name: "Example City",
  credibility_tier: 2,
  event_count: 1,
  sources: [],
});

describe("indexed scraper candidate matching", () => {
  it("uses the batch matcher and fetches full details only for the selected event", async () => {
    const titleQuery = {
      select: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: [], error: null }),
    };
    const detailQuery = {
      select: vi.fn().mockReturnThis(),
      in: vi.fn().mockResolvedValue({
        data: [{
          id: "11111111-1111-4111-8111-111111111111",
          sources: [],
          latitude: 10,
          longitude: 20,
          location_name: "Example City",
          title: "Earlier report from Example City",
          description: "Earlier details.",
          credibility_tier: 2,
          impact_score: 1,
          event_count: 1,
          source: "Existing",
          source_type: "rss",
          url: "https://existing.example/report",
          published_at: "2026-07-12T11:00:00.000Z",
        }],
        error: null,
      }),
    };
    const from = vi.fn()
      .mockReturnValueOnce(titleQuery)
      .mockReturnValueOnce(detailQuery);
    const rpc = vi.fn().mockResolvedValue({
      data: [{
        query_index: 0,
        event_id: "11111111-1111-4111-8111-111111111111",
        similarity: 0.9,
        latitude: 10,
        longitude: 20,
        location_name: "Example City",
      }],
      error: null,
    });

    const result = await resolveStoryMerges([incoming()], { from, rpc } as never);

    expect(rpc).toHaveBeenCalledWith("match_recent_event_candidates", expect.objectContaining({
      p_limit: 12,
      p_queries: [expect.objectContaining({ query_index: 0 })],
    }));
    expect(detailQuery.in).toHaveBeenCalledWith("id", ["11111111-1111-4111-8111-111111111111"]);
    expect(from).toHaveBeenCalledTimes(2);
    expect(result.newEvents).toHaveLength(0);
    expect(result.merges.has("11111111-1111-4111-8111-111111111111")).toBe(true);
  });
});
