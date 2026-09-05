import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DbEvent } from "@/types";

const vectorMocks = vi.hoisted(() => ({
  generateEmbeddings: vi.fn(async (texts: string[]) =>
    texts.map(() => Array.from({ length: 384 }, (_, index) => index === 0 ? 1 : 0)),
  ),
}));

vi.mock("@/lib/utils/vectorize", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/utils/vectorize")>();
  return {
    ...actual,
    generateEmbeddings: vectorMocks.generateEmbeddings,
  };
});

import { resolveStoryMerges } from "@/scraper/merger";

const incoming = (overrides: Partial<DbEvent> = {}): DbEvent => ({
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
  image_url: "https://incoming.example/new.jpg",
  ...overrides,
});

describe("indexed scraper candidate matching", () => {
  it('merges matching vectors within the incoming batch without requiring an existing row', async () => {
    const query = { select: vi.fn().mockReturnThis(), gte: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(), range: vi.fn().mockResolvedValue({ data: [], error: null }) };
    const db = { from: () => query, rpc: vi.fn().mockResolvedValue({ data: [], error: null }) };
    const result = await resolveStoryMerges([
      incoming(), incoming({ title: 'Overnight strike damages Example City port facility', url: 'https://second.example/story', source: 'Second' }),
    ], db as never);
    expect(result.newEvents).toHaveLength(1);
    expect(result.newEvents[0].event_count).toBe(2);
  });
  beforeEach(() => {
    vectorMocks.generateEmbeddings.mockClear();
  });

  it("uses the batch matcher and fetches full details only for the selected event", async () => {
    const titleQuery = {
      select: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      range: vi.fn().mockResolvedValue({ data: [], error: null }),
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
          image_url: "https://existing.example/old.jpg",
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

    const result = await resolveStoryMerges([incoming({
      published_at: "2026-07-13T00:00:00.000Z",
    })], { from, rpc } as never);

    expect(rpc).toHaveBeenCalledWith("match_recent_event_candidates", expect.objectContaining({
      p_limit: 12,
      p_queries: [expect.objectContaining({ query_index: 0 })],
    }));
    expect(detailQuery.in).toHaveBeenCalledWith("id", ["11111111-1111-4111-8111-111111111111"]);
    expect(detailQuery.select).toHaveBeenCalledWith(expect.stringContaining("image_url"));
    expect(from).toHaveBeenCalledTimes(2);
    expect(result.newEvents).toHaveLength(0);
    expect(result.merges.has("11111111-1111-4111-8111-111111111111")).toBe(true);
    expect(result.merges.get("11111111-1111-4111-8111-111111111111")).toMatchObject({
      image_url: "https://incoming.example/new.jpg",
    });
  });

  it("carries an image promotion through an exact-title merge within the same run", async () => {
    const titleQuery = {
      select: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      range: vi.fn().mockResolvedValue({ data: [], error: null }),
    };
    const from = vi.fn().mockReturnValueOnce(titleQuery);
    const rpc = vi.fn().mockResolvedValue({ data: [], error: null });

    const first = incoming({
      url: "https://first.example/report",
      image_url: "https://first.example/old.jpg",
      published_at: "2026-07-12T11:00:00.000Z",
    });
    const second = incoming({
      url: "https://second.example/report",
      image_url: "https://second.example/new.jpg",
      published_at: "2026-07-13T00:00:00.000Z",
    });

    const result = await resolveStoryMerges([first, second], { from, rpc } as never);

    expect(result.merges.size).toBe(0);
    expect(result.newEvents).toHaveLength(1);
    expect(result.newEvents[0]).toMatchObject({
      url: "https://second.example/report",
      image_url: "https://second.example/new.jpg",
      event_count: 2,
    });
  });

  it("does not embed an incoming event that already has an exact database title match", async () => {
    const existingId = "11111111-1111-4111-8111-111111111111";
    const titleQuery = {
      select: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      range: vi.fn().mockResolvedValue({
        data: [{ id: existingId, title: incoming().title, published_at: "2026-07-12T11:00:00.000Z" }],
        error: null,
      }),
    };
    const detailQuery = {
      select: vi.fn().mockReturnThis(),
      in: vi.fn().mockResolvedValue({
        data: [{
          id: existingId, sources: [], latitude: 10, longitude: 20,
          location_name: "Example City", title: incoming().title,
          description: "Earlier details.", credibility_tier: 2, impact_score: 1,
          event_count: 1, source: "Existing", source_type: "rss",
          url: "https://existing.example/report", published_at: "2026-07-12T11:00:00.000Z",
        }],
        error: null,
      }),
    };
    const from = vi.fn().mockReturnValueOnce(titleQuery).mockReturnValueOnce(detailQuery);
    const rpc = vi.fn();

    const result = await resolveStoryMerges([incoming()], { from, rpc } as never);

    expect(vectorMocks.generateEmbeddings).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
    expect(result.merges.has(existingId)).toBe(true);
  });

  it("embeds and semantically rematches when an exact-title row disappears", async () => {
    const vanishedId = "11111111-1111-4111-8111-111111111111";
    const fallbackId = "22222222-2222-4222-8222-222222222222";
    const titleQuery = {
      select: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      range: vi.fn().mockResolvedValue({
        data: [{ id: vanishedId, title: incoming().title, published_at: "2026-07-12T11:00:00.000Z" }],
        error: null,
      }),
    };
    const vanishedDetailQuery = {
      select: vi.fn().mockReturnThis(),
      in: vi.fn().mockResolvedValue({ data: [], error: null }),
    };
    const fallbackDetailQuery = {
      select: vi.fn().mockReturnThis(),
      in: vi.fn().mockResolvedValue({
        data: [{
          id: fallbackId, sources: [], latitude: 10, longitude: 20,
          location_name: "Example City", title: "Related report from Example City",
          description: "Earlier details.", credibility_tier: 2, impact_score: 1,
          event_count: 1, source: "Existing", source_type: "rss",
          url: "https://existing.example/related", published_at: "2026-07-12T11:00:00.000Z",
        }],
        error: null,
      }),
    };
    const from = vi.fn()
      .mockReturnValueOnce(titleQuery)
      .mockReturnValueOnce(vanishedDetailQuery)
      .mockReturnValueOnce(fallbackDetailQuery);
    const rpc = vi.fn().mockResolvedValue({
      data: [{
        query_index: 0, event_id: fallbackId, similarity: 0.9,
        latitude: 10, longitude: 20, location_name: "Example City",
      }],
      error: null,
    });

    const result = await resolveStoryMerges([incoming()], { from, rpc } as never);

    expect(vectorMocks.generateEmbeddings).toHaveBeenCalledOnce();
    expect(result.merges.has(fallbackId)).toBe(true);
    expect(result.newEvents).toHaveLength(0);
  });

  it("keeps successive dated templates from one publisher as separate events", async () => {
    const existingId = "33333333-3333-4333-8333-333333333333";
    const titleQuery = {
      select: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      range: vi.fn().mockResolvedValue({ data: [], error: null }),
    };
    const detailQuery = {
      select: vi.fn().mockReturnThis(),
      in: vi.fn().mockResolvedValue({
        data: [{
          id: existingId,
          sources: [],
          latitude: -23.55,
          longitude: -46.63,
          location_name: "São Paulo",
          title: "São Paulo Nightlife Tonight — August 14, 2026",
          description: "The previous dated nightlife listing.",
          credibility_tier: 2,
          impact_score: 1.5,
          event_count: 1,
          source: "The Rio Times",
          source_type: "rss",
          url: "https://www.riotimesonline.com/sao-paulo-nightlife-tonight-august-14-2026",
          published_at: "2026-08-14T15:00:00.000Z",
        }],
        error: null,
      }),
    };
    const from = vi.fn().mockReturnValueOnce(titleQuery).mockReturnValueOnce(detailQuery);
    const rpc = vi.fn().mockResolvedValue({
      data: [{
        query_index: 0,
        event_id: existingId,
        similarity: 0.98,
        latitude: -23.55,
        longitude: -46.63,
        location_name: "São Paulo",
      }],
      error: null,
    });

    const result = await resolveStoryMerges([incoming({
      title: "São Paulo Nightlife Tonight — August 15, 2026",
      description: "The next dated nightlife listing.",
      source: "The Rio Times",
      url: "https://www.riotimesonline.com/sao-paulo-nightlife-tonight-august-15-2026",
      published_at: "2026-08-15T15:00:00.000Z",
      latitude: -23.55,
      longitude: -46.63,
      location_name: "São Paulo",
    })], { from, rpc } as never);

    expect(result.merges.size).toBe(0);
    expect(result.newEvents).toHaveLength(1);
  });
});
