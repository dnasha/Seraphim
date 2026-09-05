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

function rpcResult(rows = [eventRow], isCapped = false) {
  return { data: { items: rows, is_capped: isCapped }, error: null };
}

describe("GET /api/news", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.rpc.mockReset().mockResolvedValue(rpcResult());
    mocks.resolveEntitlements.mockResolvedValue({ tier: 'analyst', entitlements: { eventLimit: 1000 } });
  });

  it('passes authorized filters before the cap and trusts explicit truncation', async () => {
    mocks.resolveEntitlements.mockResolvedValue({ tier: 'free', entitlements: { eventLimit: 50 } });
    mocks.rpc.mockResolvedValue(rpcResult(Array.from({ length: 50 }, () => eventRow), false));
    const body = await (await GET(request('sources=news&categories=crisis&limit=500&force_raw=true'))).json();
    expect(mocks.rpc).toHaveBeenCalledWith('query_news_v2', expect.objectContaining({ p_sources: ['news'], p_categories: ['crisis'], p_limit: 50 }));
    expect(body.meta.isCapped).toBe(false);
  });

  it('rejects forged guest and Free filters before querying', async () => {
    mocks.resolveEntitlements.mockResolvedValue({ tier: 'guest', entitlements: { eventLimit: 10 } });
    expect((await GET(request('sources=news'))).status).toBe(403);
    mocks.resolveEntitlements.mockResolvedValue({ tier: 'free', entitlements: { eventLimit: 50 } });
    expect((await GET(request('credibility=1&min_reports=3'))).status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('keeps guest ranking on Hot even with a forged New request', async () => {
    mocks.resolveEntitlements.mockResolvedValue({ tier: 'guest', entitlements: { eventLimit: 10 } });
    const body = await (await GET(request('sort=new&force_raw=true&limit=9'))).json();
    expect(body.meta.sort).toBe('hot');
    expect(mocks.rpc).toHaveBeenCalledWith('query_news_v2', expect.objectContaining({ p_sort_mode: 'hot', p_limit: 9 }));
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
      data: { items: [{ ...eventRow, cluster_id: 0, story_count: 4, center_lat: 11, center_lng: 21 }], is_capped: false },
      error: null,
    });

    const response = await GET(request("zoom=3&minLat=0&maxLat=20&minLng=10&maxLng=30&limit=10"));
    const body = await response.json();

    expect(mocks.rpc).toHaveBeenCalledWith("query_news_v2", expect.objectContaining({
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
    mocks.rpc.mockResolvedValue(rpcResult());

    const response = await GET(request("zoom=8&query=city&sort=hot&limit=12"));
    const body = await response.json();

    expect(mocks.rpc).toHaveBeenCalledWith("query_news_v2", expect.objectContaining({
      p_search_query: "city",
      p_min_lat: null,
      p_max_lng: null,
      p_sort_mode: "hot",
      p_limit: 12,
      p_cluster: false,
    }));
    expect(body.meta).toMatchObject({ clustered: false, scope: "viewport", sort: "hot" });
  });

  it('does not mark an empty small-limit response as capped', async () => {
    mocks.rpc.mockResolvedValue(rpcResult([]));
    const body = await (await GET(request('zoom=9&limit=1&time_range=3d'))).json();
    expect(body.meta.isCapped).toBe(false);
  });

  it('ignores boxes consistently for globally cached raw and search requests', async () => {
    mocks.rpc.mockResolvedValue(rpcResult());
    const base = 'scope=global&zoom=9&limit=73&time_range=1w';
    await GET(request(base + '&minLat=0&maxLat=20&minLng=10&maxLng=30'));
    await GET(request(base + '&minLat=40&maxLat=60&minLng=100&maxLng=120'));
    expect(mocks.rpc).toHaveBeenCalledWith('query_news_v2', expect.objectContaining({ p_min_lat: null }));
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    mocks.rpc.mockResolvedValue(rpcResult());
    await GET(request(base + '&query=global-audit&minLat=0&maxLat=20&minLng=10&maxLng=30'));
    expect(mocks.rpc).toHaveBeenCalledWith('query_news_v2', expect.objectContaining({ p_min_lat: null, p_max_lat: null, p_min_lng: null, p_max_lng: null }));
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
    mocks.rpc.mockResolvedValue(rpcResult([]));

    const response = await GET(request('zoom=8&limit=999&force_raw=true'));

    expect(mocks.rpc).toHaveBeenCalledWith('query_news_v2', expect.objectContaining({ p_limit: 10 }));
    await expect(response.json()).resolves.toMatchObject({ meta: { appliedLimit: 10 } });
  });

  it('does not let broad history undo the high-zoom cap', async () => {
    mocks.rpc.mockResolvedValue(rpcResult([]));

    const response = await GET(request('zoom=8&time_range=1w'));

    expect(mocks.rpc).toHaveBeenCalledWith('query_news_v2', expect.objectContaining({ p_limit: 250 }));
    await expect(response.json()).resolves.toMatchObject({ meta: { appliedLimit: 250 } });
  });

  it('coalesces concurrent identical cache misses', async () => {
    mocks.rpc.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      return rpcResult();
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
      .mockResolvedValueOnce(rpcResult());
    const queryString = 'zoom=8&query=singleflight-retry&limit=12';

    expect((await GET(request(queryString))).status).toBe(500);
    expect((await GET(request(queryString))).status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
  });

  it("uses unclustered filtered reads at high zoom and caches equivalent requests", async () => {
    mocks.rpc.mockResolvedValue(rpcResult());
    const queryString = "zoom=8&minLat=0&maxLat=20&minLng=10&maxLng=30&sort=hot&limit=13";

    const first = await GET(request(queryString));
    const second = await GET(request(queryString));

    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith('query_news_v2', expect.objectContaining({ p_sort_mode: 'hot', p_min_lat: -0.00001, p_max_lng: 30.00001 }));
    await expect(first.json()).resolves.toMatchObject({ items: [expect.objectContaining({ id: eventRow.id })] });
    await expect(second.json()).resolves.toMatchObject({ meta: { clustered: false } });
  });

  it("uses a raw bounded-limit query when no viewport is supplied", async () => {
    mocks.rpc.mockResolvedValue(rpcResult());

    const response = await GET(request("zoom=2&limit=17"));

    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith('query_news_v2', expect.objectContaining({ p_cluster: false, p_limit: 17 }));
    await expect(response.json()).resolves.toMatchObject({
      items: [expect.objectContaining({ id: eventRow.id })],
      meta: { clustered: false },
    });
  });

  it("reports unavailability instead of an authoritative empty feed on timeout", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "statement timeout" } });

    const response = await GET(request("zoom=2&minLat=0&maxLat=20&minLng=10&maxLng=30&limit=17"));
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toMatchObject({ error: 'Failed to fetch news' });
  });

  it('rejects requests without Vercel client identity before database work', async () => {
    const response = await GET(new Request('https://seraphim.example/api/news?zoom=2'));

    expect(response.status).toBe(429);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('does not use client-supplied X-Forwarded-For for rate-limit buckets', async () => {
    mocks.rpc.mockResolvedValue(rpcResult([]));
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
    mocks.rpc.mockResolvedValue(rpcResult([]));
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
    mocks.rpc.mockResolvedValue(rpcResult([]));
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
    mocks.rpc.mockResolvedValue(rpcResult([]));

    const capped = await GET(request('zoom=2&minLat=0&maxLat=20&minLng=10&maxLng=30&limit=999&time_range=1d'));
    expect(mocks.rpc).toHaveBeenCalledWith('query_news_v2', expect.objectContaining({ p_limit: 50 }));
    expect((await capped.json()).meta).toMatchObject({ appliedLimit: 50 });

    const historical = await GET(request('zoom=2&minLat=0&maxLat=20&minLng=10&maxLng=30&time_range=1w'));
    expect(historical.status).toBe(403);
    await expect(historical.json()).resolves.toMatchObject({ code: 'feature_required', requiredTier: 'pro' });
  });
});
