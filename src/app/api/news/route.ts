/**
 * Primary News Feed API
 * 
 * Orchestrates event retrieval from Supabase with support for geographic 
 * bounding boxes, server-side clustering, and temporal filtering.
 * Implements a resilient multi-tier rate limiting and fail-open caching strategy.
 */

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/core/supabase-admin";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { NewsItem, NewsResponse } from "@/lib/core/types";
import { DbEvent, dbEventToNewsItem } from "@/types";
import { sortNewsItems } from "@/lib/utils/ranking";
import { validateNewsSearchParams, NEWS_DEFAULT_LIMIT } from "@/lib/security/newsParams";
import { canUseTimeRange, hasFeature } from '@/lib/entitlements';
import { resolveRequestEntitlements } from '@/lib/server/entitlements';
import { getRateLimitKeys, getTrustedClientIp } from '@/lib/security/clientIdentity';
import { createLocalFixedWindowLimiter, createThrottledDiagnostic } from '@/lib/security/localRateLimit';
import { createSingleFlight } from '@/lib/server/singleFlight';

/**
 * Global L2 rate limiter using Upstash Redis for cross-instance state.
 */
const distributedRateLimitConfigured = process.env.NODE_ENV === 'test' || Boolean(
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN,
);
const ratelimit = distributedRateLimitConfigured
  ? new Ratelimit({
      redis: Redis.fromEnv(),
      limiter: Ratelimit.slidingWindow(120, "1 m"),
      analytics: true,
      prefix: "@upstash/ratelimit/seraphim",
    })
  : null;

/**
 * Local L1 rate limiter (Memory) to minimize network overhead for high-frequency 
 * clients. Short-circuits requests before hitting the L2 Redis limiter.
 */
const localRateLimit = createLocalFixedWindowLimiter({ limit: 30, windowMs: 10_000 });
const reportRateLimitUnavailable = createThrottledDiagnostic(() => {
  console.error('[api/news] Distributed rate limiter unavailable; local hard ceiling remains active.');
});

/**
 * Server-side cache for news aggregates.
 * Keys are derived from serialized query parameters to ensure granular hit rates.
 */
const sourceCache = new Map<string, { data: NewsItem[]; isCapped: boolean; timestamp: number }>();
const SOURCE_CACHE_MAX_ENTRIES = 250;
const sourceSingleFlight = createSingleFlight(SOURCE_CACHE_MAX_ENTRIES);

const refreshThrottle = new Map<string, number>();
const REFRESH_COOLDOWN = 60000;

const RAW_LIMIT = NEWS_DEFAULT_LIMIT;

/**
 * Optimized column selection. 
 * Heavy JSONB and text columns (like description) are omitted for list views 
 * to reduce egress costs and improve parsing speed.
 */
const LIST_SELECT =
  "id, title, url, source, source_type, category, image_url, published_at, latitude, longitude, location_name, impact_score, credibility_tier, event_count";

function pruneSourceCache() {
  if (sourceCache.size <= SOURCE_CACHE_MAX_ENTRIES) return;
  const overflow = sourceCache.size - SOURCE_CACHE_MAX_ENTRIES;
  for (const key of sourceCache.keys()) {
    sourceCache.delete(key);
    if (sourceCache.size <= SOURCE_CACHE_MAX_ENTRIES - overflow) break;
  }
}

export async function GET(request: Request) {
  const now = Date.now();
  const { searchParams } = new URL(request.url);
  const validated = validateNewsSearchParams(searchParams);
  if (!validated.ok) {
    return NextResponse.json({ error: validated.error }, { status: 400 });
  }

  const clientIp = getTrustedClientIp(request.headers);
  if (!clientIp) {
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: 429, headers: { 'Retry-After': '10' } },
    );
  }

  let forceRefresh = validated.params.forceRefresh;
  const {
    viewMode,
    scopeMode,
    hasBBox,
    minLat,
    maxLat,
    minLng,
    maxLng,
    searchQuery,
    zoom,
    sort,
    hasRequestedLimit,
    requestedLimit,
    sinceStr,
    untilStr,
    forceRaw,
    timeRange,
  } = validated.params;

  const access = await resolveRequestEntitlements();
  const rateLimitKeys = getRateLimitKeys(clientIp, access.userId);
  if (searchQuery && !hasFeature(access.tier, 'search')) {
    return NextResponse.json(
      {
        error: 'Search requires a free account',
        code: 'feature_required',
        requiredTier: 'free',
      },
      { status: 403 },
    );
  }
  if (!canUseTimeRange(access.tier, timeRange)) {
    return NextResponse.json(
      {
        error: 'This time range requires an upgraded plan',
        code: 'feature_required',
        requiredTier: timeRange === 'custom' ? 'analyst' : 'pro',
      },
      { status: 403 },
    );
  }

  const presetRangeMs: Record<Exclude<typeof timeRange, 'custom'>, number> = {
    '1d': 24 * 60 * 60 * 1000,
    '3d': 3 * 24 * 60 * 60 * 1000,
    '1w': 7 * 24 * 60 * 60 * 1000,
    '1m': 30 * 24 * 60 * 60 * 1000,
  };
  // Presets are normalized server-side so a forged `since` value cannot turn a
  // 24-hour button into an archive query. Custom ranges remain Analyst-only.
  const normalizedSince = timeRange === 'custom'
    ? sinceStr
    : new Date(now - presetRangeMs[timeRange]).toISOString();
  const cacheSinceKey = timeRange === 'custom' ? normalizedSince : timeRange;

  /**
   * Numerical stability epsilon to prevent edge-case exclusion of markers 
   * exactly on the bounding box boundary.
   */
  const EPSILON = 0.00001;

  const isGlobalBBox =
    hasBBox &&
    minLat! <= -89 &&
    maxLat! >= 89 &&
    minLng! <= -179 &&
    maxLng! >= 179;

  const ignoreBBox = scopeMode === 'global' || isGlobalBBox;

  let zoomLimit = Number.POSITIVE_INFINITY;

  /**
   * Dynamic Capping Logic
   * Higher zoom levels return fewer items to optimize client-side rendering 
   * of high-density areas. Lower zoom levels use larger limits to populate 
   * the global view.
   */
  if (zoom !== null && !searchQuery) {
    if (zoom >= 6.5) {
      zoomLimit = 250;
    } else if (zoom >= 4) {
      zoomLimit = 500;
    }
  }

  let requestedQueryLimit = requestedLimit;
  // Broad historical queries may use the full tier allowance only when the
  // client did not explicitly choose a smaller limit.
  if (normalizedSince && !hasRequestedLimit) {
    const sinceTime = new Date(normalizedSince).getTime();
    const untilTime = untilStr ? new Date(untilStr).getTime() : now;
    if (untilTime - sinceTime > 24 * 60 * 60 * 1000 + 5000) {
      requestedQueryLimit = 1000;
    }
  }
  const effectiveLimit = Math.min(
    requestedQueryLimit,
    access.entitlements.eventLimit,
    zoomLimit,
  );

  /**
   * Clustering Strategy
   * Zoom < 5: Server-side clustering via PostGIS RPC to handle massive 
   * datasets efficiently.
   * Zoom >= 5: Raw event streaming to allow client-side Supercluster 
   * to provide smooth, organic transitions.
   */
  const useServerClustering = !forceRaw && (zoom === null || zoom < 5);
  const isClusteredQuery = useServerClustering && hasBBox && !ignoreBBox;

  const bboxKeyPart = ignoreBBox
    ? "global"
    : `${minLat},${maxLat},${minLng},${maxLng}`;
  const cacheKey =
    hasBBox || ignoreBBox
      ? `tier:${access.tier},view:${viewMode},scope:${scopeMode},bbox:${bboxKeyPart}${isClusteredQuery ? `,cluster,z:${Math.floor(zoom!)}` : ""}${cacheSinceKey ? `,s:${cacheSinceKey}` : ""}${untilStr ? `,u:${untilStr}` : ""}${searchQuery ? `,q:${searchQuery}` : ""}${sort !== "hot" ? `,sort:${sort}` : ""}${effectiveLimit !== RAW_LIMIT ? `,l:${effectiveLimit}` : ""}`
      : `tier:${access.tier},view:${viewMode},scope:${scopeMode},events${cacheSinceKey ? `,s:${cacheSinceKey}` : ""}${untilStr ? `,u:${untilStr}` : ""}${searchQuery ? `,q:${searchQuery}` : ""}${sort !== "hot" ? `,sort:${sort}` : ""}${effectiveLimit !== RAW_LIMIT ? `,l:${effectiveLimit}` : ""}`;
  const canUseCache = true;
  const cacheTtlMs = !hasBBox ? 300000 : 60000;

  if (forceRefresh) {
    const lastRefresh = refreshThrottle.get("global") || 0;
    if (now - lastRefresh < REFRESH_COOLDOWN) {
      forceRefresh = false;
    } else {
      refreshThrottle.set("global", now);
    }
  }

  try {
    const localResult = localRateLimit.check(rateLimitKeys, now);
    if (!localResult.success) {
      return NextResponse.json(
        { error: 'Too many requests' },
        { status: 429, headers: { 'Retry-After': String(localResult.retryAfterSeconds) } },
      );
    }
    const checkDistributed = localResult.counts.some((count) => count > 15 || count % 5 === 0);
    if (checkDistributed) {
      if (!ratelimit) {
        reportRateLimitUnavailable(now);
      } else {
        try {
          const results = await Promise.all(rateLimitKeys.map((key) => ratelimit.limit(key)));
          const denied = results.filter(({ success }) => !success);
          if (denied.length > 0) {
            const retryAfter = Math.max(1, ...denied.map((result) => Math.ceil((result.reset - now) / 1_000)));
            return NextResponse.json(
              { error: "Too many requests" },
              { status: 429, headers: { 'Retry-After': String(retryAfter) } },
            );
          }
        } catch {
          reportRateLimitUnavailable(now);
        }
      }
    }

    let result: { data: NewsItem[]; isCapped: boolean };
    const cached = sourceCache.get(cacheKey);

    if (
      canUseCache &&
      !forceRefresh &&
      cached &&
      now - cached.timestamp < cacheTtlMs
    ) {
      result = { data: cached.data, isCapped: cached.isCapped };
    } else {
      result = await sourceSingleFlight.run(cacheKey, async () => {
        let rows: unknown[] | null = null;
        let error: { message?: string } | null = null;
        let normMinLng: number | null = null;
        let normMaxLng: number | null = null;

        if (!ignoreBBox && hasBBox) {
          normMinLng = minLng! - EPSILON;
          normMaxLng = maxLng! + EPSILON;
        }

        if (isClusteredQuery) {
          const rpcParams: Record<string, unknown> = {
            p_zoom_level: zoom !== null ? Math.floor(zoom) : null,
            p_min_lat: ignoreBBox ? null : minLat! - EPSILON,
            p_max_lat: ignoreBBox ? null : maxLat! + EPSILON,
            p_min_lng: ignoreBBox ? null : normMinLng,
            p_max_lng: ignoreBBox ? null : normMaxLng,
            p_sort_mode: sort,
            p_limit: effectiveLimit,
          };
          if (normalizedSince) rpcParams.p_since = normalizedSince;
          if (untilStr) rpcParams.p_until = untilStr;
          if (searchQuery) rpcParams.p_search_query = searchQuery;
          const response = await supabaseAdmin.rpc("get_clustered_events", rpcParams);
          rows = response.data;
          error = response.error;
        } else if (searchQuery) {
          const response = await supabaseAdmin.rpc("search_events", {
            p_search_query: searchQuery,
            p_min_lat: hasBBox ? minLat! - EPSILON : null,
            p_max_lat: hasBBox ? maxLat! + EPSILON : null,
            p_min_lng: hasBBox ? minLng! - EPSILON : null,
            p_max_lng: hasBBox ? maxLng! + EPSILON : null,
            p_since: normalizedSince,
            p_until: untilStr,
            p_sort_mode: sort,
            p_limit: effectiveLimit,
            p_unmapped_only: false,
          });
          rows = response.data;
          error = response.error;
        } else {
          let query = supabaseAdmin.from("events").select(LIST_SELECT);
          query = sort === "hot"
            ? query
                .order("impact_score", { ascending: false, nullsFirst: false })
                .order("event_count", { ascending: false, nullsFirst: false })
                .order("published_at", { ascending: false })
            : query.order("published_at", { ascending: false });
          query = query.limit(effectiveLimit);
          if (normalizedSince) query = query.gte("published_at", normalizedSince);
          if (untilStr) query = query.lte("published_at", untilStr);
          if (hasBBox) {
            const latMin = minLat! - EPSILON;
            const latMax = maxLat! + EPSILON;
            const lngMin = minLng! - EPSILON;
            const lngMax = maxLng! + EPSILON;
            query = query.gte("latitude", latMin).lte("latitude", latMax);
            query = lngMin <= lngMax
              ? query.gte("longitude", lngMin).lte("longitude", lngMax)
              : query.or(`longitude.gte.${lngMin},longitude.lte.${lngMax}`);
          }
          const response = await query;
          rows = response.data;
          error = response.error;
        }

        if (error) {
          console.error("[api/news] Supabase query failed:", error.message);
          const timedOut = error.message?.includes("statement timeout") ||
            error.message?.includes("canceling statement");
          if (!timedOut) throw new Error('news_query_failed');
          const stale = sourceCache.get(cacheKey);
          if (stale?.data.length) {
            console.warn("[api/news] Serving stale cache for fail-open stability.");
            return { data: stale.data, isCapped: stale.isCapped };
          }
          return { data: [], isCapped: false };
        }

        const safeRows = (rows || []) as DbEvent[];
        const totalRawCount = isClusteredQuery
          ? safeRows.reduce((count, row) => count + (Number(row.story_count) || 1), 0)
          : safeRows.length;
        const isCapped = totalRawCount >= effectiveLimit - 5;
        let data = safeRows.map((row) => {
          const item = dbEventToNewsItem(row);
          if (isClusteredQuery && item.clusterId && (item.storyCount ?? 1) > 1) {
            const zLabel = zoom !== null ? Math.floor(zoom) : "global";
            item.originalId = item.id;
            item.id = `cluster-z${zLabel}-${item.latitude?.toFixed(4)}-${item.longitude?.toFixed(4)}-${item.storyCount}`;
          }
          return item;
        });
        if (!isClusteredQuery) data = sortNewsItems(data, sort).slice(0, effectiveLimit);

        const loaded = { data, isCapped };
        if (canUseCache) {
          sourceCache.set(cacheKey, { ...loaded, timestamp: Date.now() });
          pruneSourceCache();
        }
        return loaded;
      });
    }

    const response: NewsResponse = {
      items: result.data,
      lastUpdated: new Date().toISOString(),
      meta: {
        sort,
        view: viewMode,
        scope: scopeMode,
        clustered: isClusteredQuery,
        zoomBucket: zoom !== null ? Math.floor(zoom) : null,
        isCapped: result.isCapped,
        appliedLimit: effectiveLimit,
      },
      sources: {
        gnews: true,
        rss: true,
        social: true,
      },
    };

    return NextResponse.json(response, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    console.error("[api/news] Unhandled error:", error);
    return NextResponse.json(
      { error: "Failed to fetch news" },
      { status: 500 },
    );
  }
}
