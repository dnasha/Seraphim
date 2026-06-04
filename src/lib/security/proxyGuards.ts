export const PROXY_CACHE_HEADERS = {
  flights: "public, max-age=5, stale-while-revalidate=5",
  safecast: "public, max-age=3600, stale-while-revalidate=600",
  wildfires: "public, max-age=1800, stale-while-revalidate=300",
  eonet: "public, max-age=3600, stale-while-revalidate=600",
  ships: "public, max-age=3600, stale-while-revalidate=600",
} as const;

const toInteger = (value: string | undefined) => {
  if (!value || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
};

export function parseProxyCoordinate(value: string | null, min: number, max: number) {
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) return null;
  return parsed;
}

export function validateTilePath(zRaw: string | undefined, xRaw: string | undefined, yRaw: string | undefined) {
  const z = toInteger(zRaw);
  const x = toInteger(xRaw);
  const y = toInteger(yRaw?.replace(/\.png$/i, ""));
  if (z === null || x === null || y === null) return null;
  if (z < 0 || z > 16) return null;
  const maxTile = 2 ** z - 1;
  if (x < 0 || x > maxTile || y < 0 || y > maxTile) return null;
  return { z, x, y };
}

export async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = 5000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}
