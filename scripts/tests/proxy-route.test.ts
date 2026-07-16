import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rateLimit: vi.fn().mockResolvedValue({ success: true }),
  resolveEntitlements: vi.fn(),
}));

vi.mock("@/lib/server/entitlements", () => ({
  resolveRequestEntitlements: mocks.resolveEntitlements,
}));
vi.mock("@upstash/redis", () => ({ Redis: { fromEnv: vi.fn(() => ({})) } }));
vi.mock("@upstash/ratelimit", () => ({
  Ratelimit: class {
    static slidingWindow = vi.fn(() => ({}));
    limit = mocks.rateLimit;
  },
}));

import { GET } from "@/app/api/proxy/[...path]/route";
import { clearOverlayCacheForTests } from '@/lib/server/overlayCache';

function call(path: string[], query = "", headers: HeadersInit = {}) {
  return GET(new Request(`https://seraphim.example/api/proxy/${path.join("/")}${query}`, {
    headers: { 'x-vercel-forwarded-for': '198.51.100.10', ...headers },
  }) as never, {
    params: Promise.resolve({ path }),
  });
}

describe("GET /api/proxy/[...path]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearOverlayCacheForTests();
    mocks.resolveEntitlements.mockResolvedValue({ tier: "analyst", entitlements: {} });
  });

  it("rejects missing and unknown services without making an upstream request", async () => {
    const missing = await call([]);
    const unknown = await call(["unknown"]);

    expect(missing.status).toBe(400);
    expect(unknown.status).toBe(404);
  });

  it('rejects requests without Vercel client identity', async () => {
    const response = await GET(new Request('https://seraphim.example/api/proxy/ships') as never, {
      params: Promise.resolve({ path: ['ships'] }),
    });
    expect(response.status).toBe(429);
  });

  it('does not use client-supplied X-Forwarded-For for proxy rate-limit buckets', async () => {
    for (let index = 0; index < 8; index++) {
      await call(['ships'], '', {
        'x-vercel-forwarded-for': '198.51.100.242',
        'x-forwarded-for': `203.0.113.${index}`,
      });
    }

    expect(mocks.rateLimit).toHaveBeenCalled();
    expect(mocks.rateLimit.mock.calls.every(([key]) => key === 'net:198.51.100.242')).toBe(true);
  });

  it('enforces network and authenticated-subject buckets for premium traffic', async () => {
    mocks.resolveEntitlements.mockResolvedValue({ tier: 'analyst', entitlements: {}, userId: 'user-456' });
    const fetchMock = vi.fn().mockImplementation(() => new Response(JSON.stringify({ ac: [] })));
    vi.stubGlobal('fetch', fetchMock);

    for (let index = 0; index < 8; index++) {
      await call(['flights'], '?lat=10&lng=20', { 'x-vercel-forwarded-for': '198.51.100.243' });
    }

    expect(mocks.rateLimit).toHaveBeenCalledWith('net:198.51.100.243');
    expect(mocks.rateLimit).toHaveBeenCalledWith('user:user-456');
    expect(fetchMock).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });

  it("validates flight coordinates before calling the ADS-B providers", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await call(["flights"], "?lat=100&lng=10");

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("does not expose the retired static ship feed", async () => {
    const response = await call(["ships"]);
    expect(response.status).toBe(404);
  });

  it("rejects malformed Safecast tile paths", async () => {
    const response = await call(["safecast", "3", "99", "5.png"]);
    expect(response.status).toBe(400);
  });
});
