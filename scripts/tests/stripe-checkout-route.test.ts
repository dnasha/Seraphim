import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  paymentsEnabled: true,
  siteUrl: "https://seraphim.example",
  getUser: vi.fn(),
  adminFrom: vi.fn(),
  customerCreate: vi.fn(),
  priceRetrieve: vi.fn(),
  checkoutCreate: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ auth: { getUser: mocks.getUser } })),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({ from: mocks.adminFrom })),
}));

vi.mock("@/lib/stripe", () => ({
  ANGEL_MAX_QUANTITY: 100,
  STRIPE_PRICES: {
    pro_monthly: "price_pro_monthly",
    pro_yearly: "price_pro_yearly",
    analyst_monthly: "price_analyst_monthly",
    analyst_yearly: "price_analyst_yearly",
    angel: "price_angel",
  },
  stripe: {
    prices: { retrieve: mocks.priceRetrieve },
    customers: { create: mocks.customerCreate },
    checkout: { sessions: { create: mocks.checkoutCreate } },
  },
}));

vi.mock("@/lib/security/payments", () => ({
  isPaymentsEnabled: () => mocks.paymentsEnabled,
  getConfiguredSiteUrl: () => mocks.siteUrl,
}));

import { POST } from "@/app/api/stripe/checkout/route";

function request(priceKey: string) {
  return new Request("https://seraphim.example/api/stripe/checkout", {
    method: "POST",
    body: JSON.stringify({ priceKey }),
    headers: { "content-type": "application/json" },
  }) as never;
}

function profileQuery(profile: unknown) {
  const query: Record<string, unknown> = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    single: vi.fn(async () => ({ data: profile })),
    update: vi.fn(() => query),
  };
  return query;
}

describe("POST /api/stripe/checkout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.paymentsEnabled = true;
    mocks.siteUrl = "https://seraphim.example";
    mocks.getUser.mockResolvedValue({ data: { user: { id: "user-1", email: "user@example.com" } }, error: null });
    mocks.checkoutCreate.mockResolvedValue({ url: "https://checkout.stripe.example/session" });
    mocks.customerCreate.mockResolvedValue({ id: "cus-new" });
    mocks.priceRetrieve.mockResolvedValue({ product: { metadata: { inventory: "100" } } });
    mocks.adminFrom.mockImplementation((table: string) => {
      if (table === "user_profiles") return profileQuery({ stripe_customer_id: "cus-existing" });
      if (table === "angel_purchases") {
        const query: Record<string, unknown> = { select: vi.fn(async () => ({ count: 0 })) };
        return query;
      }
      throw new Error(`Unexpected table ${table}`);
    });
  });

  it("stops before auth or Stripe calls when payments are disabled", async () => {
    mocks.paymentsEnabled = false;
    const response = await POST(request("pro_monthly"));

    expect(response.status).toBe(503);
    expect(mocks.getUser).not.toHaveBeenCalled();
    expect(mocks.checkoutCreate).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated and invalid-price requests", async () => {
    mocks.getUser.mockResolvedValueOnce({ data: { user: null }, error: null });
    const anonymous = await POST(request("pro_monthly"));
    const invalid = await POST(request("not-a-plan"));

    expect(anonymous.status).toBe(401);
    expect(invalid.status).toBe(400);
    expect(mocks.checkoutCreate).not.toHaveBeenCalled();
  });

  it("creates a monthly Pro subscription with the intended trial and metadata", async () => {
    const response = await POST(request("pro_monthly"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ url: "https://checkout.stripe.example/session" });
    expect(mocks.checkoutCreate).toHaveBeenCalledWith(expect.objectContaining({
      customer: "cus-existing",
      mode: "subscription",
      line_items: [{ price: "price_pro_monthly", quantity: 1 }],
      success_url: "https://seraphim.example/?checkout=success",
      metadata: { supabase_user_id: "user-1", price_key: "pro_monthly" },
      subscription_data: {
        trial_period_days: 7,
        metadata: { supabase_user_id: "user-1", price_key: "pro_monthly" },
      },
    }));
  });

  it("blocks sold-out Angel purchases before creating a customer or checkout session", async () => {
    mocks.adminFrom.mockImplementation((table: string) => {
      if (table === "angel_purchases") {
        const query: Record<string, unknown> = { select: vi.fn(async () => ({ count: 100 })) };
        return query;
      }
      return profileQuery({ stripe_customer_id: null });
    });

    const response = await POST(request("angel"));

    expect(response.status).toBe(410);
    expect(mocks.customerCreate).not.toHaveBeenCalled();
    expect(mocks.checkoutCreate).not.toHaveBeenCalled();
  });

  it("creates an Angel payment session with fulfillment metadata", async () => {
    mocks.adminFrom.mockImplementation((table: string) => {
      if (table === "angel_purchases") {
        const query: Record<string, unknown> = { select: vi.fn(async () => ({ count: 1 })) };
        return query;
      }
      return profileQuery({ stripe_customer_id: "cus-existing" });
    });

    const response = await POST(request("angel"));

    expect(response.status).toBe(200);
    expect(mocks.checkoutCreate).toHaveBeenCalledWith(expect.objectContaining({
      customer: "cus-existing",
      mode: "payment",
      payment_intent_data: { metadata: { supabase_user_id: "user-1", price_key: "angel" } },
    }));
  });
});
