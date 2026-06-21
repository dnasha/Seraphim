import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  exchangeCodeForSession: vi.fn(),
  createClient: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: mocks.createClient,
}));

import { GET } from "@/app/auth/callback/route";

describe("GET /auth/callback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createClient.mockResolvedValue({ auth: { exchangeCodeForSession: mocks.exchangeCodeForSession } });
  });

  it("exchanges a code and redirects to a safe local destination", async () => {
    mocks.exchangeCodeForSession.mockResolvedValue({ error: null });
    const response = await GET(new Request("https://seraphim.example/auth/callback?code=abc&next=%2Faccount"));

    expect(mocks.exchangeCodeForSession).toHaveBeenCalledWith("abc");
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://seraphim.example/account");
  });

  it("does not turn an OAuth callback into an open redirect", async () => {
    mocks.exchangeCodeForSession.mockResolvedValue({ error: null });
    const response = await GET(new Request("https://seraphim.example/auth/callback?code=abc&next=https%3A%2F%2Fevil.example"));

    expect(response.headers.get("location")).toBe("https://seraphim.example/");
  });

  it("returns to the root error state when code exchange fails or is absent", async () => {
    mocks.exchangeCodeForSession.mockResolvedValue({ error: new Error("expired") });
    const failed = await GET(new Request("https://seraphim.example/auth/callback?code=abc"));
    const missing = await GET(new Request("https://seraphim.example/auth/callback"));

    expect(failed.headers.get("location")).toBe("https://seraphim.example/?auth_error=true");
    expect(missing.headers.get("location")).toBe("https://seraphim.example/?auth_error=true");
  });
});
