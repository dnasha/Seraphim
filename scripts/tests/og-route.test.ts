import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ from: vi.fn() }));

vi.mock("next/og", () => ({
  ImageResponse: class extends Response {
    constructor(_element: unknown, init: ResponseInit) {
      super("image", init);
    }
  },
}));
vi.mock("@/lib/core/supabase", () => ({ supabase: { from: mocks.from } }));

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
});
