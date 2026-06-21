import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  constructEvent: vi.fn(),
  from: vi.fn(),
  rpc: vi.fn(),
  priceRetrieve: vi.fn(),
  retrieveSubscription: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn(() => ({ from: mocks.from, rpc: mocks.rpc })) }));
vi.mock("@/lib/stripe", () => ({
  ANGEL_MAX_QUANTITY: 100,
  STRIPE_PRICES: { angel: "price_angel" },
  intervalFromPriceId: vi.fn(() => "month"),
  tierFromPriceId: vi.fn(() => "pro"),
  stripe: {
    webhooks: { constructEvent: mocks.constructEvent },
    prices: { retrieve: mocks.priceRetrieve },
    subscriptions: { retrieve: mocks.retrieveSubscription },
  },
}));

import { POST } from "@/app/api/stripe/webhook/route";

function webhookRequest(signature: string | null) {
  return new Request("https://seraphim.example/api/stripe/webhook", {
    method: "POST",
    body: "signed payload",
    headers: signature ? { "stripe-signature": signature } : {},
  }) as never;
}

describe("POST /api/stripe/webhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.from.mockImplementation(() => ({
      insert: vi.fn(async () => ({ error: null })),
    }));
    mocks.rpc.mockResolvedValue({ data: true, error: null });
    mocks.priceRetrieve.mockResolvedValue({ product: { metadata: { inventory: "50" } } });
    mocks.retrieveSubscription.mockResolvedValue({
      id: "sub-1",
      status: "active",
      customer: "cus-1",
      cancel_at_period_end: false,
      trial_end: null,
      metadata: { supabase_user_id: "user-1" },
      items: { data: [{ price: { id: "price-pro" }, current_period_end: 1_800_000_000 }] },
    });
  });

  it("rejects unsigned requests before parsing a Stripe event", async () => {
    const response = await POST(webhookRequest(null));

    expect(response.status).toBe(400);
    expect(mocks.constructEvent).not.toHaveBeenCalled();
  });

  it("rejects a bad Stripe signature without claiming an event", async () => {
    mocks.constructEvent.mockImplementation(() => { throw new Error("bad signature"); });

    const response = await POST(webhookRequest("bad"));

    expect(response.status).toBe(400);
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("handles an already-claimed event idempotently", async () => {
    mocks.constructEvent.mockReturnValue({ id: "evt-duplicate", type: "invoice.payment_succeeded", data: { object: {} } });
    mocks.from.mockReturnValue({ insert: vi.fn(async () => ({ error: { code: "23505" } })) });

    const response = await POST(webhookRequest("valid"));

    expect(await response.json()).toEqual({ received: true, duplicate: true });
  });

  it("fulfills a paid Angel checkout exactly through the atomic database RPC", async () => {
    mocks.constructEvent.mockReturnValue({
      id: "evt-angel",
      type: "checkout.session.completed",
      data: { object: {
        id: "cs-angel",
        mode: "payment",
        payment_status: "paid",
        payment_intent: "pi-1",
        customer: "cus-1",
        metadata: { supabase_user_id: "user-1", price_key: "angel" },
      } },
    });

    const response = await POST(webhookRequest("valid"));

    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("fulfill_angel_purchase", {
      p_user_id: "user-1",
      p_stripe_payment_intent_id: "pi-1",
      p_stripe_customer_id: "cus-1",
      p_max_quantity: 50,
    });
  });

  it("syncs a completed subscription checkout to the matching user profile", async () => {
    const profileUpdate = vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) }));
    mocks.from.mockImplementation((table: string) => {
      if (table === "stripe_processed_events") return { insert: vi.fn(async () => ({ error: null })) };
      if (table === "user_profiles") return { update: profileUpdate };
      throw new Error(`Unexpected table: ${table}`);
    });
    mocks.constructEvent.mockReturnValue({
      id: "evt-subscription",
      type: "checkout.session.completed",
      data: { object: {
        id: "cs-subscription",
        mode: "subscription",
        subscription: "sub-1",
        customer: "cus-1",
        metadata: { supabase_user_id: "user-1", price_key: "pro_monthly" },
      } },
    });

    const response = await POST(webhookRequest("valid"));

    expect(response.status).toBe(200);
    expect(mocks.retrieveSubscription).toHaveBeenCalledWith("sub-1");
    expect(profileUpdate).toHaveBeenCalledWith(expect.objectContaining({
      tier: "pro",
      stripe_customer_id: "cus-1",
      stripe_subscription_id: "sub-1",
      subscription_status: "active",
      billing_interval: "month",
    }));
  });

  it("does not grant a paid tier for an incomplete subscription", async () => {
    const profileUpdate = vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) }));
    mocks.from.mockImplementation((table: string) => {
      if (table === "stripe_processed_events") return { insert: vi.fn(async () => ({ error: null })) };
      if (table === "user_profiles") return { update: profileUpdate };
      throw new Error(`Unexpected table: ${table}`);
    });
    mocks.retrieveSubscription.mockResolvedValue({
      id: "sub-incomplete",
      status: "incomplete",
      customer: "cus-1",
      cancel_at_period_end: false,
      trial_end: null,
      metadata: { supabase_user_id: "user-1" },
      items: { data: [{ price: { id: "price-pro" }, current_period_end: null }] },
    });
    mocks.constructEvent.mockReturnValue({
      id: "evt-incomplete",
      type: "checkout.session.completed",
      data: { object: {
        id: "cs-incomplete",
        mode: "subscription",
        subscription: "sub-incomplete",
        customer: "cus-1",
        metadata: { supabase_user_id: "user-1", price_key: "pro_monthly" },
      } },
    });

    const response = await POST(webhookRequest("valid"));

    expect(response.status).toBe(200);
    expect(profileUpdate).toHaveBeenCalledWith(expect.objectContaining({
      tier: "free",
      subscription_status: "incomplete",
    }));
  });

  it("releases an idempotency claim when event processing fails", async () => {
    const releaseEq = vi.fn(async () => ({ error: null }));
    const releaseDelete = vi.fn(() => ({ eq: releaseEq }));
    mocks.from.mockImplementation((table: string) => {
      if (table === "stripe_processed_events") {
        return {
          insert: vi.fn(async () => ({ error: null })),
          delete: releaseDelete,
        };
      }
      if (table === "user_profiles") return { update: vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) })) };
      throw new Error(`Unexpected table: ${table}`);
    });
    mocks.retrieveSubscription.mockRejectedValue(new Error("Stripe lookup failed"));
    mocks.constructEvent.mockReturnValue({
      id: "evt-failure",
      type: "checkout.session.completed",
      data: { object: {
        id: "cs-failure",
        mode: "subscription",
        subscription: "sub-failure",
        customer: "cus-1",
        metadata: { supabase_user_id: "user-1", price_key: "pro_monthly" },
      } },
    });

    const response = await POST(webhookRequest("valid"));

    expect(response.status).toBe(500);
    expect(releaseDelete).toHaveBeenCalled();
    expect(releaseEq).toHaveBeenCalledWith("event_id", "evt-failure");
  });
});
