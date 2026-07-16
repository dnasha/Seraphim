import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ createServerClient: vi.fn(), getUser: vi.fn() }));

vi.mock("@supabase/ssr", () => ({ createServerClient: mocks.createServerClient }));

import { proxy } from "@/proxy";

describe("auth session proxy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createServerClient.mockReturnValue({ auth: { getUser: mocks.getUser } });
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
  });

  it("skips Supabase work for guests without auth cookies", async () => {
    const response = await proxy(new NextRequest("https://seraphim.example/"));

    expect(mocks.createServerClient).not.toHaveBeenCalled();
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("refreshes sessions only when Supabase cookies are present", async () => {
    const request = new NextRequest("https://seraphim.example/account", {
      headers: { cookie: "sb-project-auth-token=old" },
    });

    await proxy(request);

    expect(mocks.createServerClient).toHaveBeenCalledOnce();
    expect(mocks.getUser).toHaveBeenCalledOnce();
  });

  it("leaves API authentication to route handlers", async () => {
    const request = new NextRequest("https://seraphim.example/api/news?zoom=4", {
      headers: { cookie: "sb-project-auth-token=old" },
    });

    const response = await proxy(request);

    expect(mocks.createServerClient).not.toHaveBeenCalled();
    expect(mocks.getUser).not.toHaveBeenCalled();
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("returns the refreshed response after Supabase sets session cookies", async () => {
    mocks.createServerClient.mockImplementation((_url: string, _key: string, options: { cookies: { setAll: (cookies: Array<{ name: string; value: string; options: Record<string, unknown> }>) => void } }) => {
      options.cookies.setAll([{ name: "sb-project-auth-token", value: "fresh", options: { path: "/" } }]);
      return { auth: { getUser: mocks.getUser } };
    });
    const request = new NextRequest("https://seraphim.example/account", {
      headers: { cookie: "sb-project-auth-token=old" },
    });

    const response = await proxy(request);

    expect(response.cookies.get("sb-project-auth-token")?.value).toBe("fresh");
  });

  it("clears cookies if session validation fails with refresh token not found", async () => {
    const authError = {
      name: "AuthApiError",
      message: "Invalid Refresh Token: Refresh Token Not Found",
      status: 400,
      code: "refresh_token_not_found",
    };
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: authError });

    const request = new NextRequest("https://seraphim.example/account", {
      headers: { cookie: "sb-project-auth-token=bad-token" },
    });

    const response = await proxy(request);

    // Should delete the cookie from the response (instructing browser to clear it)
    expect(response.cookies.get("sb-project-auth-token")?.value).toBe("");
    
    // Should also delete it from the request object so downstream route handlers don't see it
    expect(request.cookies.get("sb-project-auth-token")).toBeUndefined();
  });
});
