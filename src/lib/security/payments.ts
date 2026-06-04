type EnvLike = Record<string, string | undefined>;

export function isPaymentsEnabled(env: EnvLike = process.env) {
  return env.PAYMENTS_ENABLED === "true";
}

export function getConfiguredSiteUrl(env: EnvLike = process.env) {
  const raw = env.SITE_URL || env.NEXT_PUBLIC_SITE_URL;
  if (!raw) return null;

  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.hostname !== "localhost") return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function canFulfillAngelCheckout(input: {
  mode: string | null;
  priceKey: string | null | undefined;
  paymentStatus: string | null;
  paymentIntent: unknown;
}) {
  return (
    input.mode === "payment" &&
    input.priceKey === "angel" &&
    input.paymentStatus === "paid" &&
    typeof input.paymentIntent === "string" &&
    input.paymentIntent.length > 0
  );
}
