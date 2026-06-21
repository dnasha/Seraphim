import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
}));

vi.mock("@/lib/core/supabase", () => ({ supabase: { from: mocks.from } }));

import { GET } from "@/app/api/news/[id]/route";

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

function detailQuery(data: unknown, error: unknown = null) {
  const query: Record<string, unknown> = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    single: vi.fn(async () => ({ data, error })),
  };
  return query;
}

describe("GET /api/news/[id]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects malformed IDs without querying Supabase", async () => {
    const response = await GET(new Request("https://seraphim.example/api/news/not-a-uuid"), params("not-a-uuid"));

    expect(response.status).toBe(400);
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("returns deferred details and preserves coordinates on cache hits", async () => {
    const query = detailQuery({
      description: "Full story",
      sources: [{ name: "Source", url: "https://example.com", source_type: "rss", discovered_at: "2026-01-01T00:00:00Z" }],
      latitude: 1,
      longitude: 2,
    });
    mocks.from.mockReturnValue(query);
    const id = "11111111-1111-4111-8111-111111111111";

    const response = await GET(new Request(`https://seraphim.example/api/news/${id}`), params(id));

    expect(await response.json()).toEqual(expect.objectContaining({ description: "Full story", latitude: 1, longitude: 2 }));
    expect(response.headers.get("cache-control")).toContain("s-maxage=1800");
    expect(query.select).toHaveBeenCalledWith("description, sources, latitude, longitude");

    const cachedResponse = await GET(new Request(`https://seraphim.example/api/news/${id}`), params(id));
    expect(await cachedResponse.json()).toEqual(expect.objectContaining({ latitude: 1, longitude: 2 }));
    expect(mocks.from).toHaveBeenCalledTimes(1);
  });

  it("returns 404 when the event cannot be found", async () => {
    mocks.from.mockReturnValue(detailQuery(null, { message: "not found" }));
    const id = "22222222-2222-4222-8222-222222222222";

    const response = await GET(new Request(`https://seraphim.example/api/news/${id}`), params(id));
    expect(response.status).toBe(404);
  });
});
