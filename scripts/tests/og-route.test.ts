import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ from: vi.fn(), fetchPublicImage: vi.fn() }));

vi.mock("next/og", () => ({
  ImageResponse: class extends Response {
    constructor(_element: unknown, init: ResponseInit) {
      super("image", init);
    }
  },
}));
vi.mock("@/lib/core/supabase", () => ({ supabase: { from: mocks.from } }));
vi.mock('@/lib/security/ogImage', () => ({
  fetchPublicImage: mocks.fetchPublicImage,
  safeReadImageResponse: vi.fn(async () => ({
    contentType: 'image/png',
    arrayBuffer: new Uint8Array([1]).buffer,
  })),
}));

import { GET } from "@/app/api/og/route";

describe("GET /api/og", () => {
  beforeEach(() => vi.clearAllMocks());

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

    const response = await GET(new Request('https://seraphim.example/api/og?eventId=11111111-1111-4111-8111-111111111111'));

    expect(response.status).toBe(200);
    expect(mocks.fetchPublicImage).toHaveBeenCalledWith('http://[::1]/image.png', { timeoutMs: 1500 });
    vi.unstubAllGlobals();
  });
});
