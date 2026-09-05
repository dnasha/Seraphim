import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  resolveEntitlements: vi.fn(),
  rateLimit: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock("@/lib/core/supabase-admin", () => ({ supabaseAdmin: { from: mocks.from } }));

vi.mock('@/lib/server/entitlements', () => ({
  resolveRequestEntitlements: mocks.resolveEntitlements,
}));

vi.mock('@upstash/redis', () => ({ Redis: { fromEnv: vi.fn(() => ({})) } }));
vi.mock('@upstash/ratelimit', () => ({
  Ratelimit: class {
    static slidingWindow = vi.fn(() => ({}));
    limit = mocks.rateLimit;
  },
}));

import { GET } from "@/app/api/news/[id]/route";

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

function request(id: string, ip = '198.51.100.42') {
  return new Request(`https://seraphim.example/api/news/${id}`, {
    headers: { 'x-vercel-forwarded-for': ip },
  });
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

    const response = await GET(request(id), params(id));

    expect(await response.json()).toEqual(expect.objectContaining({ description: "Full story", latitude: 1, longitude: 2 }));
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get('x-robots-tag')).toContain('noindex');
    expect(query.select).toHaveBeenCalledWith("id, title, description, url, source, source_type, category, image_url, published_at, latitude, longitude, location_name, impact_score, credibility_tier, event_count, sources, primary_discovered_at");

    const cachedResponse = await GET(request(id), params(id));
    expect(await cachedResponse.json()).toEqual(expect.objectContaining({ latitude: 1, longitude: 2 }));
    expect(mocks.from).toHaveBeenCalledTimes(1);
  });

  it("returns 404 when the event cannot be found", async () => {
    mocks.from.mockReturnValue(detailQuery(null, { code: 'PGRST116', message: "not found" }));
    const id = "22222222-2222-4222-8222-222222222222";

    const response = await GET(request(id), params(id));
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
    const response = await GET(request(id), params(id));
    await expect(response.json()).resolves.toMatchObject({
      timelineRestricted: true,
      totalSources: 4,
      sources: [expect.objectContaining({ name: 'Primary' }), expect.objectContaining({ name: 'Latest' })],
      event: expect.objectContaining({ description: 'Story' }),
    });
  });

  it('distinguishes a database outage from a missing event', async () => {
    mocks.from.mockReturnValue(detailQuery(null, { code: '57014', message: 'statement timeout' }));
    const id = '22222222-2222-4222-8222-222222222229';
    expect((await GET(request(id), params(id))).status).toBe(503);
  });

  it('applies each recipient entitlement when the same shared event is cached', async () => {
    const id = '66666666-6666-4666-8666-666666666666';
    mocks.from.mockReturnValue(detailQuery({
      id,
      title: 'Shared event',
      description: 'Story',
      source: 'Primary',
      source_type: 'rss',
      url: 'https://primary.example',
      published_at: '2026-01-03T00:00:00Z',
      sources: [
        { name: 'First', url: 'https://first.example', source_type: 'rss', discovered_at: '2026-01-01T00:00:00Z' },
        { name: 'Middle', url: 'https://middle.example', source_type: 'rss', discovered_at: '2026-01-02T00:00:00Z' },
        { name: 'Latest', url: 'https://latest.example', source_type: 'rss', discovered_at: '2026-01-03T00:00:00Z' },
      ],
      latitude: 1,
      longitude: 2,
    }));

    mocks.resolveEntitlements.mockResolvedValueOnce({
      tier: 'guest',
      entitlements: { timelineSourceLimit: 0 },
      userId: null,
    });
    const guestResponse = await GET(request(id, '198.51.100.60'), params(id));
    await expect(guestResponse.json()).resolves.toMatchObject({
      timelineRestricted: true,
      totalSources: 4,
      sources: [expect.objectContaining({ name: 'Primary' })],
      event: expect.objectContaining({ id, title: 'Shared event' }),
    });

    mocks.resolveEntitlements.mockResolvedValueOnce({
      tier: 'pro',
      entitlements: { timelineSourceLimit: null },
      userId: 'pro-user',
    });
    const proResponse = await GET(request(id, '198.51.100.61'), params(id));
    const proBody = await proResponse.json();
    expect(proBody).toMatchObject({ timelineRestricted: false, totalSources: 4 });
    expect(proBody.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'Primary' }),
      expect.objectContaining({ name: 'First' }),
      expect.objectContaining({ name: 'Middle' }),
      expect.objectContaining({ name: 'Latest' }),
    ]));
    expect(mocks.from).toHaveBeenCalledTimes(1);
  });

  it('rejects exact-event requests without trusted deployment identity', async () => {
    const id = '44444444-4444-4444-8444-444444444444';
    const response = await GET(new Request(`https://seraphim.example/api/news/${id}`), params(id));
    expect(response.status).toBe(429);
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('hard-limits repeated exact-ID reads at the application instance', async () => {
    const id = '55555555-5555-4555-8555-555555555555';
    mocks.from.mockReturnValue(detailQuery({
      id,
      title: 'Shared event',
      description: 'One exact event',
      source: 'Primary',
      source_type: 'rss',
      url: 'https://primary.example/shared',
      published_at: '2026-01-01T00:00:00Z',
      sources: [],
      latitude: 1,
      longitude: 2,
    }));
    for (let index = 0; index < 60; index++) {
      await GET(request(id, '198.51.100.99'), params(id));
    }
    const blocked = await GET(request(id, '198.51.100.99'), params(id));
    expect(blocked.status).toBe(429);
  });
});
