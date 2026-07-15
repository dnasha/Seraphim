import type { RSSSource, SocialSource } from "@/data/sources";

export type PollTier = "fast" | "normal" | "slow";

export const BASE_POLL_INTERVAL_MS = 15 * 60 * 1000;
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;

const FAST_RSS_SOURCES = new Set([
  "BBC World", "Al Jazeera", "SCMP", "CNA Asia", "The Hindu",
  "BBC Africa", "Africanews", "BBC Middle East", "Al Arabiya English",
  "Times of Israel", "Middle East Eye", "USGS Earthquakes",
  "ISW Daily Updates", "ACLED", "NDTV India", "ABC Australia",
  "Vanguard News", "Anadolu Agency", "Yonhap News", "Dawn Pakistan",
  "ANTARA News", "Premium Times Nigeria", "NJ.com", "Global News Canada",
]);

const SLOW_RSS_SOURCES = new Set([
  "War on the Rocks", "Foreign Affairs", "CFR", "Chatham House", "ECFR",
  "The Diplomat", "Geopolitical Futures", "Bellingcat", "ICG CrisisWatch",
]);

const FAST_X_SOURCES = new Set([
  "IDF (X)", "OSINTtechnical (X)", "ELINT News (X)",
  "OSINTdefender (X)", "BRICSinfo (X)", "Breaking911 (X)",
]);

const TIER_DIVISOR: Record<PollTier, number> = { fast: 1, normal: 2, slow: 4 };
const TIER_ITEM_LIMIT: Record<PollTier, number> = { fast: 15, normal: 12, slow: 8 };
const TIER_MAX_AGE_MS: Record<PollTier, number> = {
  fast: 36 * 60 * 60 * 1000,
  normal: 48 * 60 * 60 * 1000,
  slow: 96 * 60 * 60 * 1000,
};

export function rssPollTier(source: Pick<RSSSource, "name" | "category">): PollTier {
  if (FAST_RSS_SOURCES.has(source.name) || source.category === "crisis") return "fast";
  if (
    SLOW_RSS_SOURCES.has(source.name) ||
    ["business", "technology", "science", "health"].includes(source.category)
  ) return "slow";
  return "normal";
}

export function socialPollTier(source: Pick<SocialSource, "name" | "platform">): PollTier {
  if (source.platform === "telegram" || FAST_X_SOURCES.has(source.name)) return "fast";
  return "normal";
}

export function isPollDue(tier: PollTier, now = Date.now()): boolean {
  const slot = Math.floor(now / BASE_POLL_INTERVAL_MS);
  return slot % TIER_DIVISOR[tier] === 0;
}

export function selectDueSources<T>(
  sources: readonly T[],
  getTier: (source: T) => PollTier,
  now = Date.now(),
): T[] {
  return sources.filter((source) => isPollDue(getTier(source), now));
}

export function itemLimitForTier(tier: PollTier): number {
  return TIER_ITEM_LIMIT[tier];
}

export function selectRecentFeedItems<T>(
  items: readonly T[],
  getPublishedAt: (item: T) => string | undefined | null,
  options: { tier?: PollTier; limit?: number; maxAgeMs?: number; now?: number } = {},
): T[] {
  const tier = options.tier ?? "normal";
  const limit = options.limit ?? TIER_ITEM_LIMIT[tier];
  const maxAgeMs = options.maxAgeMs ?? TIER_MAX_AGE_MS[tier];
  const now = options.now ?? Date.now();

  const selected: T[] = [];
  for (const item of items) {
    const rawDate = getPublishedAt(item);
    if (rawDate) {
      const publishedMs = new Date(rawDate).getTime();
      if (!Number.isFinite(publishedMs)) continue;
      if (publishedMs > now + MAX_FUTURE_SKEW_MS) continue;
      if (publishedMs < now - maxAgeMs) continue;
    }

    selected.push(item);
    if (selected.length >= limit) break;
  }
  return selected;
}
