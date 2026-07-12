import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  resolveEntitlements: vi.fn(),
}));

vi.mock("@/lib/core/supabase-admin", () => ({ supabaseAdmin: { from: mocks.from } }));

vi.mock('@/lib/server/entitlements', () => ({
  resolveRequestEntitlements: mocks.resolveEntitlements,
}));

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
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveEntitlements.mockResolvedValue({ tier: 'analyst', entitlements: { timelineSourceLimit: null } });
  });

  it("rejects malformed IDs without querying Supabase", async () => {
    const response = await GET(new Request("https://seraphim.example/api/news/not-a-uuid"), params("not-a-uuid"));

    expect(response.status).toBe(400);
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("returns deferred details and preserves coordinates on cache hits", async () => {
    const query = detailQuery({
      description: "Full story",
      source: "Primary",
      source_type: "rss",
      url: "https://primary.example",
      primary_discovered_at: "2025-12-31T00:00:00Z",
      published_at: "2026-01-01T00:00:00Z",
      sources: [{ name: "Source", url: "https://example.com", source_type: "rss", discovered_at: "2026-01-01T00:00:00Z" }],
      latitude: 1,
      longitude: 2,
    });
    mocks.from.mockReturnValue(query);
    const id = "11111111-1111-4111-8111-111111111111";

    const response = await GET(new Request(`https://seraphim.example/api/news/${id}`), params(id));

    expect(await response.json()).toEqual(expect.objectContaining({ description: "Full story", latitude: 1, longitude: 2 }));
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(query.select).toHaveBeenCalledWith("description, sources, source, source_type, url, primary_discovered_at, published_at, latitude, longitude");

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

  it('returns a Free timeline preview instead of every corroborating source', async () => {
    mocks.resolveEntitlements.mockResolvedValue({ tier: 'free', entitlements: { timelineSourceLimit: 2 } });
    mocks.from.mockReturnValue(detailQuery({
      description: 'Story',
      source: 'Primary',
      source_type: 'rss',
      url: 'https://primary.example',
      primary_discovered_at: '2025-12-31T00:00:00Z',
      published_at: '2026-01-03T00:00:00Z',
      sources: [
        { name: 'First', url: 'https://first.example', source_type: 'rss', discovered_at: '2026-01-01T00:00:00Z' },
        { name: 'Middle', url: 'https://middle.example', source_type: 'rss', discovered_at: '2026-01-02T00:00:00Z' },
        { name: 'Latest', url: 'https://latest.example', source_type: 'rss', discovered_at: '2026-01-03T00:00:00Z' },
      ],
      latitude: 1,
      longitude: 2,
    }));

    const id = '33333333-3333-4333-8333-333333333333';
    const response = await GET(new Request(`https://seraphim.example/api/news/${id}`), params(id));
    await expect(response.json()).resolves.toMatchObject({
      timelineRestricted: true,
      totalSources: 4,
      sources: [expect.objectContaining({ name: 'Primary' }), expect.objectContaining({ name: 'Latest' })],
    });
  });
});
