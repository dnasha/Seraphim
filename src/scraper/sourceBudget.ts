import type { SupabaseClient } from "@supabase/supabase-js";
import type { NewsItem } from "@/lib/core/types";

const DEFAULT_PER_SOURCE_LIMIT = 20;
const MIN_PER_SOURCE_LIMIT = 8;

export interface SourceBudgetResult {
  accepted: NewsItem[];
  cappedBySource: Record<string, number>;
}

export async function loadSourceNoveltyLimits(
  db: SupabaseClient,
): Promise<Map<string, number>> {
  const { data, error } = await db.rpc("get_source_novelty_limits");
  if (error) {
    console.warn("[scraper] Source budgets unavailable; using permissive safety cap:", error.message);
    return new Map();
  }

  const limits = new Map<string, number>();
  for (const row of (data ?? []) as Array<{ source_name: string; max_new_events: number }>) {
    limits.set(
      row.source_name,
      Math.max(MIN_PER_SOURCE_LIMIT, Number(row.max_new_events) || DEFAULT_PER_SOURCE_LIMIT),
    );
  }
  return limits;
}

export function applySourceNoveltyLimits(
  items: NewsItem[],
  limits: Map<string, number>,
  limitMultiplier = 1,
): SourceBudgetResult {
  const accepted: NewsItem[] = [];
  const seen = new Map<string, number>();
  const cappedBySource: Record<string, number> = {};

  for (const item of items) {
    const baseLimit = limits.get(item.source) ?? DEFAULT_PER_SOURCE_LIMIT;
    const limit = Math.ceil(baseLimit * limitMultiplier);
    const count = seen.get(item.source) ?? 0;
    if (count >= limit) {
      cappedBySource[item.source] = (cappedBySource[item.source] ?? 0) + 1;
      continue;
    }
    seen.set(item.source, count + 1);
    accepted.push(item);
  }

  return { accepted, cappedBySource };
}
