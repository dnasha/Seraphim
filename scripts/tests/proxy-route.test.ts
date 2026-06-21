import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rateLimit: vi.fn().mockResolvedValue({ success: true }) }));

vi.mock("@upstash/redis", () => ({ Redis: { fromEnv: vi.fn(() => ({})) } }));
vi.mock("@upstash/ratelimit", () => ({
  Ratelimit: class {
    static slidingWindow = vi.fn(() => ({}));
    limit = mocks.rateLimit;
  },
}));

import { GET } from "@/app/api/proxy/[...path]/route";

function call(path: string[], query = "") {
  return GET(new Request(`https://seraphim.example/api/proxy/${path.join("/")}${query}`) as never, {
    params: Promise.resolve({ path }),
  });
}

describe("GET /api/proxy/[...path]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects missing and unknown services without making an upstream request", async () => {
    const missing = await call([]);
    const unknown = await call(["unknown"]);

    expect(missing.status).toBe(400);
    expect(unknown.status).toBe(404);
  });

  it("validates flight coordinates before calling the ADS-B providers", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await call(["flights"], "?lat=100&lng=10");

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("returns the static ship feed with cache headers", async () => {
    const response = await call(["ships"]);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("max-age=3600");
    expect(body).toMatchObject({ type: "FeatureCollection" });
    expect(body.features.length).toBeGreaterThan(0);
  });

  it("rejects malformed Safecast tile paths", async () => {
    const response = await call(["safecast", "3", "99", "5.png"]);
    expect(response.status).toBe(400);
  });
});
