import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cookies: vi.fn(),
  createClient: vi.fn(),
  resolveEffectiveProfile: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/server/effectiveProfile", () => ({ resolveEffectiveProfile: mocks.resolveEffectiveProfile }));

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

  it("revalidates profile tiers on subsequent requests", async () => {
    const client = {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "performance-user" } } }) },
    };
    mocks.cookies.mockResolvedValue({
      getAll: () => [{ name: "sb-project-auth-token", value: "token" }],
    });
    mocks.createClient.mockResolvedValue(client);
    mocks.resolveEffectiveProfile.mockResolvedValue({ effectiveTier: 'pro' });

    const first = await resolveRequestEntitlements();
    mocks.resolveEffectiveProfile.mockResolvedValue({ effectiveTier: 'free' });
    const second = await resolveRequestEntitlements();

    expect(first.tier).toBe("pro");
    expect(second.tier).toBe("free");
    expect(client.auth.getUser).toHaveBeenCalledTimes(2);
    expect(mocks.resolveEffectiveProfile).toHaveBeenCalledTimes(2);
  });
});
