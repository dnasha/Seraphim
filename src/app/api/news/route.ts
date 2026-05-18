/**
 * Primary News Feed API
 * 
 * Orchestrates event retrieval from Supabase with support for geographic 
 * bounding boxes, server-side clustering, and temporal filtering.
 * Implements a resilient multi-tier rate limiting and fail-open caching strategy.
 */

import { NextResponse } from "next/server";
import { supabase } from "@/lib/core/supabase";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { NewsItem, NewsResponse } from "@/lib/core/types";
import { DbEvent, dbEventToNewsItem } from "@/types";
import {
  normalizeSortMode,
  sortNewsItems,
} from "@/lib/utils/ranking";

/**
 * Global L2 rate limiter using Upstash Redis for cross-instance state.
 */
const redis = Redis.fromEnv();
const ratelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(120, "1 m"),
  analytics: true,
  prefix: "@upstash/ratelimit/seraphim",
});

/**
 * Local L1 rate limiter (Memory) to minimize network overhead for high-frequency 
 * clients. Short-circuits requests before hitting the L2 Redis limiter.
 */
const localL1Limit = new Map<string, { count: number; reset: number }>();
let lastL1Cleanup = Date.now();
const L1_CLEANUP_INTERVAL = 60000;

/**
 * Purges expired entries from the L1 rate limit map to prevent memory leaks.
 */
function performL1Cleanup() {
  const now = Date.now();
  if (now - lastL1Cleanup < L1_CLEANUP_INTERVAL) return;

  for (const [ip, data] of localL1Limit.entries()) {
    if (now > data.reset) localL1Limit.delete(ip);
  }
  lastL1Cleanup = now;
}

/**
 * Server-side cache for news aggregates.
 * Keys are derived from serialized query parameters to ensure granular hit rates.
 */
const sourceCache = new Map<string, { data: NewsItem[]; isCapped: boolean; timestamp: number }>();

const refreshThrottle = new Map<string, number>();
const REFRESH_COOLDOWN = 60000;

const RAW_LIMIT = 1000;

/**
 * Optimized column selection. 
 * Heavy JSONB and text columns (like description) are omitted for list views 
 * to reduce egress costs and improve parsing speed.
 */
const LIST_SELECT =
  "id, title, url, source, source_type, category, image_url, published_at, latitude, longitude, location_name, impact_score, credibility_tier, event_count";

export async function GET(request: Request) {
  const now = Date.now();
  const { searchParams } = new URL(request.url);
  let forceRefresh = searchParams.get("refresh") === "true";
  const unmappedOnly = searchParams.get("unmapped_only") === "true";
  const viewMode = searchParams.get("view") === "sidebar" ? "sidebar" : "map";
  const scopeMode = unmappedOnly
    ? "global"
    : searchParams.get("scope") === "global"
      ? "global"
      : "viewport";

  const minLat = searchParams.get("minLat");
  const maxLat = searchParams.get("maxLat");
  const minLng = searchParams.get("minLng");
  const maxLng = searchParams.get("maxLng");
  
  const hasBBox =
    !unmappedOnly &&
    minLat !== null &&
    maxLat !== null &&
    minLng !== null &&
    maxLng !== null;

  /**
   * Numerical stability epsilon to prevent edge-case exclusion of markers 
   * exactly on the bounding box boundary.
   */
  const EPSILON = 0.00001;

  const searchQuery = searchParams.get("query");

  const isGlobalBBox =
    hasBBox &&
    parseFloat(minLat!) <= -89 &&
    parseFloat(maxLat!) >= 89 &&
    parseFloat(minLng!) <= -179 &&
    parseFloat(maxLng!) >= 179;

  const ignoreBBox = (scopeMode === 'global') || unmappedOnly || isGlobalBBox;

  const zoomStr = searchParams.get("zoom");
  const zoom = zoomStr ? parseFloat(zoomStr) : null;

  const sort = normalizeSortMode(searchParams.get("sort"));
  const hasRequestedLimit = searchParams.has("limit");
  const requestedLimit = hasRequestedLimit
    ? parseInt(searchParams.get("limit")!)
    : RAW_LIMIT;
  const sinceStr = searchParams.get("since");
  const untilStr = searchParams.get("until");

  let effectiveLimit = requestedLimit;

  /**
   * Dynamic Capping Logic
   * Higher zoom levels return fewer items to optimize client-side rendering 
   * of high-density areas. Lower zoom levels use larger limits to populate 
   * the global view.
   */
  if (zoom !== null && !unmappedOnly && !searchQuery) {
    if (zoom >= 6.5) {
      effectiveLimit = Math.min(requestedLimit, 250);
    } else if (zoom >= 4) {
      effectiveLimit = Math.min(requestedLimit, 500);
    }
  }

  // Extend limits for broad historical queries
  if (sinceStr && !hasRequestedLimit) {
    const sinceTime = new Date(sinceStr).getTime();
    const untilTime = untilStr ? new Date(untilStr).getTime() : now;
    if (untilTime - sinceTime > 24 * 60 * 60 * 1000 + 5000) {
      effectiveLimit = Math.max(effectiveLimit, 1000);
    }
  }

  /**
   * Clustering Strategy
   * Zoom < 5: Server-side clustering via PostGIS RPC to handle massive 
   * datasets efficiently.
   * Zoom >= 5: Raw event streaming to allow client-side Supercluster 
   * to provide smooth, organic transitions.
   */
  const useServerClustering = !unmappedOnly && (zoom === null || zoom < 5);

  const bboxKeyPart = ignoreBBox
    ? "global"
    : `${minLat},${maxLat},${minLng},${maxLng}`;
  const cacheKey =
    hasBBox || ignoreBBox
      ? `view:${viewMode},scope:${scopeMode},bbox:${bboxKeyPart}${useServerClustering ? `,cluster,z:${Math.floor(zoom!)}` : ""}${sinceStr ? `,s:${sinceStr}` : ""}${untilStr ? `,u:${untilStr}` : ""}${searchQuery ? `,q:${searchQuery}` : ""}${sort !== "hot" ? `,sort:${sort}` : ""}${effectiveLimit !== RAW_LIMIT ? `,l:${effectiveLimit}` : ""}${unmappedOnly ? ",unmappedOnly:1" : ""}`
      : `view:${viewMode},scope:${scopeMode},events${sinceStr ? `,s:${sinceStr}` : ""}${untilStr ? `,u:${untilStr}` : ""}${sort !== "hot" ? `,sort:${sort}` : ""}${effectiveLimit !== RAW_LIMIT ? `,l:${effectiveLimit}` : ""}${unmappedOnly ? ",unmappedOnly:1" : ""}`;
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
    const ipHeader = request.headers.get("x-forwarded-for");
    const ip = ipHeader ? ipHeader.split(",")[0].trim() : "127.0.0.1";

    performL1Cleanup();

    const l1 = localL1Limit.get(ip);
    if (!l1 || now > l1.reset) {
      localL1Limit.set(ip, { count: 1, reset: now + 10000 });
    } else {
      l1.count++;
      if (l1.count > 15 || l1.count % 5 === 0) {
        try {
          const { success } = await ratelimit.limit(ip);
          if (!success) {
            return NextResponse.json(
              { error: "Too many requests" },
              { status: 429 },
            );
          }
        } catch (ratelimitError) {
          // Fail-open on rate limiter failure to maintain service availability
          console.error(
            "[api/news] Rate limiter error (failing open):",
            ratelimitError,
          );
        }
      }
    }

    let allItems: NewsItem[];
    let queryCapped = false;
    const cached = sourceCache.get(cacheKey);

    if (
      canUseCache &&
      !forceRefresh &&
      cached &&
      now - cached.timestamp < cacheTtlMs
    ) {
      allItems = cached.data;
      queryCapped = cached.isCapped;
    } else {
      let rows, error;

      let normMinLng: number | null = null;
      let normMaxLng: number | null = null;

      if (!ignoreBBox && hasBBox) {
        normMinLng = parseFloat(minLng!) - EPSILON;
        normMaxLng = parseFloat(maxLng!) + EPSILON;
      }

      if (useServerClustering) {
        // Execute server-side clustering via optimized PostgreSQL RPC
        const rpcParams: Record<string, unknown> = {
          p_zoom_level: zoom !== null ? Math.floor(zoom) : null,
          p_min_lat: ignoreBBox ? null : parseFloat(minLat!) - EPSILON,
          p_max_lat: ignoreBBox ? null : parseFloat(maxLat!) + EPSILON,
          p_min_lng: ignoreBBox ? null : normMinLng,
          p_max_lng: ignoreBBox ? null : normMaxLng,
          p_sort_mode: sort,
          p_limit: effectiveLimit,
        };
        if (sinceStr) rpcParams.p_since = sinceStr;
        if (untilStr) rpcParams.p_until = untilStr;
        if (searchQuery) rpcParams.p_search_query = searchQuery;

        const res = await supabase.rpc("get_clustered_events", rpcParams);
        rows = res.data;
        error = res.error;
      } else {
        // Standard SQL query for raw event retrieval
        let query = supabase.from("events").select(LIST_SELECT);

        if (sort === "hot") {
          query = query
            .order("impact_score", { ascending: false, nullsFirst: false })
            .order("event_count", { ascending: false, nullsFirst: false })
            .order("published_at", { ascending: false });
        } else {
          query = query.order("published_at", { ascending: false });
        }

        query = query.limit(effectiveLimit);

        if (unmappedOnly) {
          query = query.is("latitude", null);
        }

        if (sinceStr) query = query.gte("published_at", sinceStr);
        if (untilStr) query = query.lte("published_at", untilStr);

        if (searchQuery) {
          query = query.or(
            `title.ilike.%${searchQuery}%,location_name.ilike.%${searchQuery}%`,
          );
        }

        if (hasBBox && !unmappedOnly) {
          const latMin = parseFloat(minLat!) - EPSILON;
          const latMax = parseFloat(maxLat!) + EPSILON;
          const lngMin = parseFloat(minLng!) - EPSILON;
          const lngMax = parseFloat(maxLng!) + EPSILON;

          query = query.gte("latitude", latMin).lte("latitude", latMax);

          /**
           * International Date Line Handling
           * Wraps longitude queries if the bounding box crosses the +/-180 limit.
           */
          if (lngMin <= lngMax) {
            query = query.gte("longitude", lngMin).lte("longitude", lngMax);
          } else {
            query = query.or(`longitude.gte.${lngMin},longitude.lte.${lngMax}`);
          }
        }

        const res = await query;
        rows = res.data;
        error = res.error;
      }

      if (error) {
        console.error("[api/news] Supabase query failed:", error.message);
        /**
         * Fail-Open Stability
         * If the database times out due to high load, serve a stale cache 
         * or empty result set rather than crashing the UI.
         */
        if (
          error.message?.includes("statement timeout") ||
          error.message?.includes("canceling statement")
        ) {
          const stale = sourceCache.get(cacheKey);
          if (stale && stale.data.length > 0) {
            console.warn(
              "[api/news] Serving stale cache for fail-open stability.",
            );
            return NextResponse.json(
              {
                items: stale.data,
                lastUpdated: new Date(stale.timestamp).toISOString(),
                meta: {
                  sort,
                  view: viewMode,
                  scope: scopeMode,
                  clustered: useServerClustering,
                  zoomBucket: zoom !== null ? Math.floor(zoom) : null,
                  isCapped: stale.isCapped,
                },
                sources: { gnews: true, rss: true, social: true },
              },
              {
                headers: {
                  "Cache-Control":
                    "public, s-maxage=30, stale-while-revalidate=30",
                },
              },
            );
          }

          return NextResponse.json({
            items: [],
            lastUpdated: new Date().toISOString(),
            meta: {
              sort,
              view: viewMode,
              scope: scopeMode,
              clustered: useServerClustering,
              zoomBucket: zoom !== null ? Math.floor(zoom) : null,
            },
            sources: { gnews: true, rss: true, social: true },
          });
        } else {
          return NextResponse.json(
            { error: "Failed to fetch news" },
            { status: 500 },
          );
        }
      }

      const safeRows = rows || [];
      const totalRawCount = useServerClustering
        ? (safeRows as DbEvent[]).reduce((acc, r) => acc + (Number(r.story_count) || 1), 0)
        : safeRows.length;

      if (totalRawCount >= effectiveLimit - 5) {
        queryCapped = true;
      }

      allItems = (safeRows as DbEvent[]).map((row) => {
        const item = dbEventToNewsItem(row);
        /**
         * Stable Cluster IDs
         * Aggregated clusters use a coordinate-based ID to prevent marker 
         * flickering during zoom transitions while preserving the UUID of 
         * the primary event for detail fetching.
         */
        if (
          useServerClustering &&
          item.clusterId &&
          (item.storyCount ?? 1) > 1
        ) {
          const zLabel = zoom !== null ? Math.floor(zoom) : "global";
          item.originalId = item.id;
          item.id = `cluster-z${zLabel}-${item.latitude?.toFixed(4)}-${item.longitude?.toFixed(4)}-${item.storyCount}`;
        }
        return item;
      });

      if (!useServerClustering) {
        allItems = sortNewsItems(allItems, sort);
        if (effectiveLimit < allItems.length) {
          allItems = allItems.slice(0, effectiveLimit);
        }
      }

      if (canUseCache) {
        sourceCache.set(cacheKey, { data: allItems, isCapped: queryCapped, timestamp: now });
      }
    }

    const response: NewsResponse = {
      items: allItems,
      lastUpdated: new Date().toISOString(),
      meta: {
        sort,
        view: viewMode,
        scope: scopeMode,
        clustered: useServerClustering,
        zoomBucket: zoom !== null ? Math.floor(zoom) : null,
        isCapped: queryCapped,
        appliedLimit: effectiveLimit,
      },
      sources: {
        gnews: true,
        rss: true,
        social: true,
      },
    };

    const cacheControl = !canUseCache
      ? "no-store"
      : !hasBBox
        ? "public, s-maxage=900, stale-while-revalidate=59"
        : "public, s-maxage=60, stale-while-revalidate=10";

    return NextResponse.json(response, {
      headers: { "Cache-Control": cacheControl },
    });
  } catch (error) {
    console.error("[api/news] Unhandled error:", error);
    return NextResponse.json(
      { error: "Failed to fetch news" },
      { status: 500 },
    );
  }
}
