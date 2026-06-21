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
});
