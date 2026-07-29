import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  rateLimit: vi.fn().mockResolvedValue({ success: true }),
  resolveEntitlements: vi.fn(),
}));

vi.mock("@/lib/core/supabase-admin", () => ({
  supabaseAdmin: { rpc: mocks.rpc, from: mocks.from },
}));

vi.mock('@/lib/server/entitlements', () => ({
  resolveRequestEntitlements: mocks.resolveEntitlements,
}));

vi.mock("@upstash/redis", () => ({
  Redis: { fromEnv: vi.fn(() => ({})) },
}));

vi.mock("@upstash/ratelimit", () => ({
  Ratelimit: class {
    static slidingWindow = vi.fn(() => ({}));
    limit = mocks.rateLimit;
  },
}));

import { GET } from "@/app/api/news/route";

const eventRow = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "Mapped event",
  url: "https://example.com/event",
  source: "Example",
  source_type: "rss",
  category: "world",
  image_url: null,
  published_at: "2026-01-01T00:00:00.000Z",
  latitude: 10,
  longitude: 20,
  location_name: "Example City",
  impact_score: 5,
  credibility_tier: 2,
  event_count: 3,
};

let requestIpSequence = 0;

function request(query: string, headers: HeadersInit = {}) {
  requestIpSequence = (requestIpSequence % 199) + 1;
  return new Request(`https://seraphim.example/api/news?${query}`, {
    headers: {
      'x-vercel-forwarded-for': `198.51.100.${requestIpSequence}`,
      ...headers,
    },
  });
}

function rawQuery(rows = [eventRow], error: { message: string } | null = null) {
  const result = { data: rows, error };
  const query: Record<string, unknown> = {
    select: vi.fn(() => query),
    order: vi.fn(() => query),
    limit: vi.fn(() => query),
    is: vi.fn(() => query),
    gte: vi.fn(() => query),
    lte: vi.fn(() => query),
    or: vi.fn(() => query),
    then: (resolve: (value: typeof result) => unknown, reject?: (reason: unknown) => unknown) => Promise.resolve(result).then(resolve, reject),
  };
  return query;
}

describe("GET /api/news", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveEntitlements.mockResolvedValue({ tier: 'analyst', entitlements: { eventLimit: 1000 } });
  });

  it("rejects invalid parameters before any database call", async () => {
    const response = await GET(request("minLat=0"));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining("Bounding box requires") });
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("uses the clustering RPC at low zoom and preserves a canonical detail id", async () => {
    mocks.rpc.mockResolvedValue({
      data: [{ ...eventRow, cluster_id: 7, story_count: 4, center_lat: 11, center_lng: 21 }],
      error: null,
    });

    const response = await GET(request("zoom=3&minLat=0&maxLat=20&minLng=10&maxLng=30&limit=10"));
    const body = await response.json();

    expect(mocks.rpc).toHaveBeenCalledWith("get_clustered_events", expect.objectContaining({
      p_zoom_level: 3,
      p_min_lat: -0.00001,
      p_max_lng: 30.00001,
      p_limit: 10,
    }));
    expect(body.meta).toMatchObject({ clustered: true, zoomBucket: 3, appliedLimit: 10 });
    expect(body.items[0]).toMatchObject({
      id: "cluster-z3-11.0000-21.0000-4",
      originalId: eventRow.id,
      latitude: 11,
      longitude: 21,
    });
  });

  it("uses the search RPC for high-zoom searches", async () => {
    mocks.rpc.mockResolvedValue({ data: [eventRow], error: null });

    const response = await GET(request("zoom=8&query=city&sort=hot&limit=12"));
    const body = await response.json();

    expect(mocks.rpc).toHaveBeenCalledWith("search_events", expect.objectContaining({
      p_search_query: "city",
      p_min_lat: null,
      p_max_lng: null,
      p_sort_mode: "hot",
      p_limit: 12,
      p_unmapped_only: false,
    }));
    expect(body.meta).toMatchObject({ clustered: false, scope: "viewport", sort: "hot" });
  });

  it('rejects guest search before cache or database work', async () => {
    mocks.resolveEntitlements.mockResolvedValue({ tier: 'guest', entitlements: { eventLimit: 10 } });

    const response = await GET(request('zoom=8&query=city&limit=10'));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ code: 'feature_required', requiredTier: 'free' });
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('keeps guest, zoom, and force_raw limits monotonic', async () => {
    mocks.resolveEntitlements.mockResolvedValue({ tier: 'guest', entitlements: { eventLimit: 10 } });
    const query = rawQuery([]);
    mocks.from.mockReturnValue(query);

    const response = await GET(request('zoom=8&limit=999&force_raw=true'));

    expect(query.limit).toHaveBeenCalledWith(10);
    await expect(response.json()).resolves.toMatchObject({ meta: { appliedLimit: 10 } });
  });

  it('does not let broad history undo the high-zoom cap', async () => {
    const query = rawQuery([]);
    mocks.from.mockReturnValue(query);

    const response = await GET(request('zoom=8&time_range=1w'));

    expect(query.limit).toHaveBeenCalledWith(250);
    await expect(response.json()).resolves.toMatchObject({ meta: { appliedLimit: 250 } });
  });

  it('coalesces concurrent identical cache misses', async () => {
    mocks.rpc.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      return { data: [eventRow], error: null };
    });
    const queryString = 'zoom=8&query=singleflight-city&limit=12';

    const [first, second] = await Promise.all([GET(request(queryString)), GET(request(queryString))]);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledOnce();
  });

  it('removes a failed in-flight query so a retry can run', async () => {
    mocks.rpc
      .mockRejectedValueOnce(new Error('transient failure'))
      .mockResolvedValueOnce({ data: [eventRow], error: null });
    const queryString = 'zoom=8&query=singleflight-retry&limit=12';

    expect((await GET(request(queryString))).status).toBe(500);
    expect((await GET(request(queryString))).status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
  });

  it("uses direct event reads at high zoom and caches equivalent requests", async () => {
    const query = rawQuery();
    mocks.from.mockReturnValue(query);
    const queryString = "zoom=8&minLat=0&maxLat=20&minLng=10&maxLng=30&sort=hot&limit=13";

    const first = await GET(request(queryString));
    const second = await GET(request(queryString));

    expect(mocks.from).toHaveBeenCalledTimes(1);
    expect(query.order).toHaveBeenCalledWith("impact_score", { ascending: false, nullsFirst: false });
    expect(query.order).toHaveBeenCalledWith("event_count", { ascending: false, nullsFirst: false });
    expect(query.gte).toHaveBeenCalledWith("latitude", -0.00001);
    expect(query.lte).toHaveBeenCalledWith("longitude", 30.00001);
    await expect(first.json()).resolves.toMatchObject({ items: [expect.objectContaining({ id: eventRow.id })] });
    await expect(second.json()).resolves.toMatchObject({ meta: { clustered: false } });
  });

  it("uses a raw bounded-limit query when no viewport is supplied", async () => {
    const query = rawQuery();
    mocks.from.mockReturnValue(query);

    const response = await GET(request("zoom=2&limit=17"));

    expect(response.status).toBe(200);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.from).toHaveBeenCalledWith("events");
    await expect(response.json()).resolves.toMatchObject({
      items: [expect.objectContaining({ id: eventRow.id })],
      meta: { clustered: false },
    });
  });

  it("fails open with an empty feed for database timeouts", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "statement timeout" } });

    const response = await GET(request("zoom=2&minLat=0&maxLat=20&minLng=10&maxLng=30&limit=17"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ items: [], meta: { clustered: true } });
  });

  it('rejects requests without Vercel client identity before database work', async () => {
    const response = await GET(new Request('https://seraphim.example/api/news?zoom=2'));

    expect(response.status).toBe(429);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('does not use client-supplied X-Forwarded-For for rate-limit buckets', async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    const clientIp = '198.51.100.240';

    for (let index = 0; index < 5; index++) {
      await GET(request('zoom=2', {
        'x-vercel-forwarded-for': clientIp,
        'x-forwarded-for': `203.0.113.${index}`,
      }));
    }

    expect(mocks.rateLimit).toHaveBeenCalled();
    expect(mocks.rateLimit.mock.calls.every(([key]) => key === `net:${clientIp}`)).toBe(true);
  });

  it('enforces both network and authenticated-subject buckets', async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    mocks.resolveEntitlements.mockResolvedValue({
      tier: 'analyst',
      entitlements: { eventLimit: 1000 },
      userId: 'user-123',
    });
    const clientIp = '198.51.100.241';

    for (let index = 0; index < 5; index++) {
      await GET(request('zoom=2', { 'x-vercel-forwarded-for': clientIp }));
    }

    expect(mocks.rateLimit).toHaveBeenCalledWith(`net:${clientIp}`);
    expect(mocks.rateLimit).toHaveBeenCalledWith('user:user-123');
  });

  it('enforces the local hard ceiling when Redis is unavailable', async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    mocks.rateLimit.mockRejectedValue(new Error('redis unavailable'));
    const clientIp = '198.51.100.245';

    for (let index = 0; index < 30; index++) {
      expect((await GET(request('zoom=2', { 'x-vercel-forwarded-for': clientIp }))).status).toBe(200);
    }
    const denied = await GET(request('zoom=2', { 'x-vercel-forwarded-for': clientIp }));

    expect(denied.status).toBe(429);
    expect(denied.headers.get('retry-after')).toBeTruthy();
  });

  it('enforces the Free cap and rejects unavailable history before querying data', async () => {
    mocks.resolveEntitlements.mockResolvedValue({ tier: 'free', entitlements: { eventLimit: 50 } });
    mocks.rpc.mockResolvedValue({ data: [], error: null });

    const capped = await GET(request('zoom=2&minLat=0&maxLat=20&minLng=10&maxLng=30&limit=999&time_range=1d'));
    expect(mocks.rpc).toHaveBeenCalledWith('get_clustered_events', expect.objectContaining({ p_limit: 50 }));
    expect((await capped.json()).meta).toMatchObject({ appliedLimit: 50 });

    const historical = await GET(request('zoom=2&minLat=0&maxLat=20&minLng=10&maxLng=30&time_range=1w'));
    expect(historical.status).toBe(403);
    await expect(historical.json()).resolves.toMatchObject({ code: 'feature_required', requiredTier: 'pro' });
  });
});
