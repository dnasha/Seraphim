import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  paymentsEnabled: true,
  siteUrl: "https://seraphim.example",
  getUser: vi.fn(),
  from: vi.fn(),
  createPortalSession: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => ({ auth: { getUser: mocks.getUser } })) }));
vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn(() => ({ from: mocks.from })) }));
vi.mock("@/lib/stripe", () => ({ stripe: { billingPortal: { sessions: { create: mocks.createPortalSession } } } }));
vi.mock("@/lib/security/payments", () => ({
  isPaymentsEnabled: () => mocks.paymentsEnabled,
  getConfiguredSiteUrl: () => mocks.siteUrl,
}));

import { POST } from "@/app/api/stripe/portal/route";

function profileQuery(profile: unknown) {
  const query: Record<string, unknown> = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    single: vi.fn(async () => ({ data: profile })),
  };
  return query;
}

describe("POST /api/stripe/portal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.paymentsEnabled = true;
    mocks.siteUrl = "https://seraphim.example";
    mocks.getUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
    mocks.from.mockReturnValue(profileQuery({ stripe_customer_id: "cus-1" }));
    mocks.createPortalSession.mockResolvedValue({ url: "https://billing.stripe.example/session" });
  });

  it("rejects disabled and unauthenticated portal requests", async () => {
    mocks.paymentsEnabled = false;
    expect((await POST()).status).toBe(503);

    mocks.paymentsEnabled = true;
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
    expect((await POST()).status).toBe(401);
  });

  it("requires a linked Stripe customer and safe site URL", async () => {
    mocks.from.mockReturnValue(profileQuery({ stripe_customer_id: null }));
    expect((await POST()).status).toBe(404);

    mocks.from.mockReturnValue(profileQuery({ stripe_customer_id: "cus-1" }));
    mocks.siteUrl = null as unknown as string;
    expect((await POST()).status).toBe(500);
  });

  it("creates a portal session bound to the authenticated user's customer", async () => {
    const response = await POST();

    expect(await response.json()).toEqual({ url: "https://billing.stripe.example/session" });
    expect(mocks.createPortalSession).toHaveBeenCalledWith({
      customer: "cus-1",
      return_url: "https://seraphim.example/account",
    });
  });
});
