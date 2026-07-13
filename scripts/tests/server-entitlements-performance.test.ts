import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cookies: vi.fn(),
  createClient: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));

import { resolveRequestEntitlements } from "@/lib/server/entitlements";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("request entitlement performance", () => {
  it("resolves guests without creating a Supabase client or calling Auth", async () => {
    mocks.cookies.mockResolvedValue({ getAll: () => [] });

    await expect(resolveRequestEntitlements()).resolves.toMatchObject({ tier: "guest", userId: null });
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("coalesces repeated profile-tier lookups after verified authentication", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: { tier: "pro" }, error: null });
    const query = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle,
    };
    const client = {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "performance-user" } } }) },
      from: vi.fn().mockReturnValue(query),
    };
    mocks.cookies.mockResolvedValue({
      getAll: () => [{ name: "sb-project-auth-token", value: "token" }],
    });
    mocks.createClient.mockResolvedValue(client);

    const first = await resolveRequestEntitlements();
    const second = await resolveRequestEntitlements();

    expect(first.tier).toBe("pro");
    expect(second.tier).toBe("pro");
    expect(client.auth.getUser).toHaveBeenCalledTimes(2);
    expect(maybeSingle).toHaveBeenCalledTimes(1);
  });
});
