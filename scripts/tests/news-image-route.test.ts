import { beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";

const mocks = vi.hoisted(() => ({
  maybeSingle: vi.fn(),
  fetchPublicImage: vi.fn(),
}));

vi.mock("@/lib/core/supabase-admin", () => ({
  supabaseAdmin: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: mocks.maybeSingle,
        })),
      })),
    })),
  },
}));

vi.mock("@/lib/security/clientIdentity", () => ({
  getTrustedClientIp: vi.fn(() => "203.0.113.10"),
}));

vi.mock("@/lib/security/ogImage", () => ({
  fetchPublicImage: mocks.fetchPublicImage,
}));

import { GET } from "@/app/api/news-image/[id]/route";

const UUID = "4dd43334-01da-4d2f-a56b-48ec061b2b80";

describe("GET /api/news-image/[id]", () => {
  beforeEach(() => {
    mocks.maybeSingle.mockReset();
    mocks.fetchPublicImage.mockReset();
  });

  it("rejects non-event identifiers before touching the database", async () => {
    const response = await GET(
      new Request("https://www.seraphi.me/api/news-image/not-an-event?w=176"),
      { params: Promise.resolve({ id: "not-an-event" }) },
    );

    expect(response.status).toBe(404);
    expect(mocks.maybeSingle).not.toHaveBeenCalled();
  });

  it("returns a bounded, cacheable WebP for a stored event image", async () => {
    const source = await sharp({
      create: {
        width: 400,
        height: 300,
        channels: 3,
        background: { r: 40, g: 80, b: 120 },
      },
    }).png().toBuffer();
    const sourceArrayBuffer = source.buffer.slice(
      source.byteOffset,
      source.byteOffset + source.byteLength,
    );
    mocks.maybeSingle.mockResolvedValue({
      data: { image_url: "https://publisher.example/large.png" },
      error: null,
    });
    mocks.fetchPublicImage.mockResolvedValue({
      contentType: "image/png",
      arrayBuffer: sourceArrayBuffer,
    });

    const response = await GET(
      new Request(`https://www.seraphi.me/api/news-image/${UUID}?w=176&v=test`),
      { params: Promise.resolve({ id: UUID }) },
    );
    const output = Buffer.from(await response.arrayBuffer());
    const metadata = await sharp(output).metadata();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/webp");
    expect(response.headers.get("cache-control")).toContain("s-maxage=604800");
    expect(metadata).toMatchObject({ width: 176, height: 132, format: "webp" });
    expect(output.byteLength).toBeLessThan(source.byteLength);
  });

  it("fails closed for SVG input", async () => {
    mocks.maybeSingle.mockResolvedValue({
      data: { image_url: "https://publisher.example/vector.svg" },
      error: null,
    });
    mocks.fetchPublicImage.mockResolvedValue({
      contentType: "image/svg+xml",
      arrayBuffer: new TextEncoder().encode("<svg/>").buffer,
    });

    const response = await GET(
      new Request(`https://www.seraphi.me/api/news-image/${UUID}?w=176`),
      { params: Promise.resolve({ id: UUID }) },
    );

    expect(response.status).toBe(404);
  });
});
