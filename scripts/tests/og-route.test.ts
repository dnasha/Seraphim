import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  fetchPublicImage: vi.fn(),
  rateLimit: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock("next/og", () => ({
  ImageResponse: class extends Response {
    constructor(_element: unknown, init: ResponseInit) {
      super("image", {
        ...init,
        headers: { ...init.headers, 'Content-Type': 'image/png' },
      });
    }
  },
}));
vi.mock("@/lib/core/supabase-admin", () => ({ supabaseAdmin: { from: mocks.from } }));
vi.mock('@upstash/redis', () => ({ Redis: { fromEnv: vi.fn(() => ({})) } }));
vi.mock('@upstash/ratelimit', () => ({
  Ratelimit: class {
    static slidingWindow = vi.fn(() => ({}));
    limit = mocks.rateLimit;
  },
}));
vi.mock('@/lib/security/ogImage', () => ({
  fetchPublicImage: mocks.fetchPublicImage,
  safeReadImageResponse: vi.fn(async () => ({
    contentType: 'image/png',
    arrayBuffer: new Uint8Array([1]).buffer,
  })),
}));

import { GET } from "@/app/api/og/route";
import { GET as GET_PUBLIC_OG } from "@/app/og/[eventId]/route";

describe("GET /api/og", () => {
  beforeEach(() => vi.clearAllMocks());

  function request(eventId: string, ip: string) {
    return new Request(`https://seraphim.example/api/og?eventId=${eventId}`, {
      headers: { 'x-vercel-forwarded-for': ip },
    });
  }

  it("requires an event id before touching Supabase or image fetching", async () => {
    const response = await GET(new Request("https://seraphim.example/api/og"));

    expect(response.status).toBe(400);
    await expect(response.text()).resolves.toBe("Missing eventId");
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("rejects non-UUID event identifiers before database access", async () => {
    const response = await GET(new Request("https://seraphim.example/api/og?eventId=../../../etc/passwd"));

    expect(response.status).toBe(400);
    await expect(response.text()).resolves.toBe("Invalid UUID format");
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('serves event cards from the crawlable public route', async () => {
    const eventId = '88888888-8888-4888-8888-888888888888';
    mocks.from.mockReturnValue({
      select: () => ({ eq: () => ({ single: async () => ({ data: { image_url: null } }) }) }),
    });
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => new Response('brand', {
      headers: { 'content-type': 'image/png' },
    })));

    const response = await GET_PUBLIC_OG(
      new Request(`https://seraphim.example/og/${eventId}`, {
        headers: { 'x-vercel-forwarded-for': '198.51.100.88' },
      }),
      { params: Promise.resolve({ eventId }) },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('content-disposition')).toContain('seraphim-event.png');
    expect(response.headers.get('x-robots-tag')).toBeNull();
    vi.unstubAllGlobals();
  });

  it('renders the branded fallback when the external event image is rejected', async () => {
    mocks.fetchPublicImage.mockResolvedValue(null);
    mocks.from.mockReturnValue({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: { image_url: 'http://[::1]/image.png' } }),
        }),
      }),
    });
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => new Response('brand')));

    const response = await GET(request('11111111-1111-4111-8111-111111111111', '198.51.100.20'));

    expect(response.status).toBe(200);
    expect(mocks.fetchPublicImage).toHaveBeenCalledWith('http://[::1]/image.png', { timeoutMs: 1500 });
    vi.unstubAllGlobals();
  });

  it('redirects a rate-limited render before database or image work', async () => {
    mocks.from.mockReturnValue({
      select: () => ({ eq: () => ({ single: async () => ({ data: { image_url: null } }) }) }),
    });
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => new Response('brand')));
    const eventId = '22222222-2222-4222-8222-222222222222';

    for (let index = 0; index < 60; index++) {
      expect((await GET(request(eventId, '198.51.100.21'))).status).toBe(200);
    }
    const dbCallsBeforeLimit = mocks.from.mock.calls.length;
    const fetchCallsBeforeLimit = vi.mocked(fetch).mock.calls.length;
    const response = await GET(request(eventId, '198.51.100.21'));

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('https://seraphim.example/Seraphim_OG_Dynamic.png');
    expect(mocks.from).toHaveBeenCalledTimes(dbCallsBeforeLimit);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(fetchCallsBeforeLimit);
    vi.unstubAllGlobals();
  });

  it('coalesces identical event image downloads', async () => {
    const eventImage = 'https://images.example/coalesced.png';
    mocks.from.mockReturnValue({
      select: () => ({ eq: () => ({ single: async () => ({ data: { image_url: eventImage } }) }) }),
    });
    mocks.fetchPublicImage.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      return { contentType: 'image/png', arrayBuffer: new Uint8Array([1]).buffer };
    });
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => new Response('brand')));

    await Promise.all([
      GET(request('33333333-3333-4333-8333-333333333333', '198.51.100.22')),
      GET(request('33333333-3333-4333-8333-333333333333', '198.51.100.23')),
    ]);

    expect(mocks.fetchPublicImage).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it('clears completed misses and prunes old image entries', async () => {
    let eventImage = 'https://images.example/miss.png';
    mocks.from.mockReturnValue({
      select: () => ({ eq: () => ({ single: async () => ({ data: { image_url: eventImage } }) }) }),
    });
    mocks.fetchPublicImage.mockResolvedValue(null);
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => new Response('brand')));

    await GET(request('55555555-5555-4555-8555-555555555555', '198.51.100.25'));
    await GET(request('55555555-5555-4555-8555-555555555555', '198.51.100.26'));
    expect(mocks.fetchPublicImage).toHaveBeenCalledTimes(2);

    mocks.fetchPublicImage.mockImplementation(async (url: string) => ({
      contentType: 'image/png',
      arrayBuffer: new TextEncoder().encode(url).buffer,
    }));
    for (let index = 0; index < 9; index++) {
      eventImage = `https://images.example/prune-${index}.png`;
      await GET(request(`66666666-6666-4666-8666-66666666666${index}`, `198.51.100.${30 + index}`));
    }
    eventImage = 'https://images.example/prune-0.png';
    await GET(request('77777777-7777-4777-8777-777777777777', '198.51.100.39'));

    expect(mocks.fetchPublicImage).toHaveBeenCalledTimes(12);
    vi.unstubAllGlobals();
  });

  it('does not reveal internal render failures', async () => {
    mocks.from.mockImplementation(() => {
      throw new Error('database secret detail');
    });

    const response = await GET(request('44444444-4444-4444-8444-444444444444', '198.51.100.24'));

    expect(response.status).toBe(500);
    await expect(response.text()).resolves.toBe('Failed to generate image');
  });
});
