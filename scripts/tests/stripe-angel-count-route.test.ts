import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  paymentsEnabled: true,
  from: vi.fn(),
  retrievePrice: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn(() => ({ from: mocks.from })) }));
vi.mock("@/lib/stripe", () => ({
  ANGEL_MAX_QUANTITY: 100,
  STRIPE_PRICES: { angel: "price_angel" },
  stripe: { prices: { retrieve: mocks.retrievePrice } },
}));
vi.mock("@/lib/security/payments", () => ({ isPaymentsEnabled: () => mocks.paymentsEnabled }));

import { GET } from "@/app/api/stripe/angel-count/route";

describe("GET /api/stripe/angel-count", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.paymentsEnabled = true;
    mocks.retrievePrice.mockResolvedValue({ product: { metadata: { inventory: "80" } } });
    mocks.from.mockReturnValue({ select: vi.fn(async () => ({ count: 12 })) });
  });

  it("does not expose inventory while payments are disabled", async () => {
    mocks.paymentsEnabled = false;
    const response = await GET();

    expect(response.status).toBe(503);
    expect(mocks.retrievePrice).not.toHaveBeenCalled();
  });

  it("uses the bounded Stripe inventory and database purchase count", async () => {
    const response = await GET();

    expect(await response.json()).toEqual({ remaining: 68, total: 80 });
    expect(mocks.retrievePrice).toHaveBeenCalledWith("price_angel", { expand: ["product"] });
    expect(mocks.from).toHaveBeenCalledWith("angel_purchases");
  });

  it("falls back to the app maximum when Stripe inventory lookup fails", async () => {
    mocks.retrievePrice.mockRejectedValue(new Error("Stripe unavailable"));
    mocks.from.mockReturnValue({ select: vi.fn(async () => ({ count: 2 })) });

    const response = await GET();

    expect(await response.json()).toEqual({ remaining: 98, total: 100 });
  });
});
