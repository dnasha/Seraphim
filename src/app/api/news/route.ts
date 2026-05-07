/*
  Primary news feed API route.
  Handles fetching news events from Supabase with support for bounding box filtering,
  server-side clustering, search queries, and time-window filtering.
  Implements a multi-tier rate limiting strategy and in-memory caching.
*/

import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { NewsItem, NewsResponse } from "@/lib/types";
import { DbEvent, dbEventToNewsItem } from "@/types";
import {
  latestReportTimestamp,
  normalizeSortMode,
  sortNewsItems,
} from "@/lib/ranking";

// Global rate limiter using Upstash Redis
const redis = Redis.fromEnv();
const ratelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(120, "1 m"),
  analytics: true,
  prefix: "@upstash/ratelimit/seraphim",
});

// Local L1 Rate Limiter (Memory) to minimize Upstash overhead for frequent requests
const localL1Limit = new Map<string, { count: number; reset: number }>();
let lastL1Cleanup = Date.now();
const L1_CLEANUP_INTERVAL = 60000; // 1 minute

/* 
  Periodically clears expired entries from the local rate limit map.
*/
function performL1Cleanup() {
  const now = Date.now();
  if (now - lastL1Cleanup < L1_CLEANUP_INTERVAL) return;

  for (const [ip, data] of localL1Limit.entries()) {
    if (now > data.reset) localL1Limit.delete(ip);
  }
  lastL1Cleanup = now;
}

// Server-side cache for news items to reduce database load
// Key format: "events" or "bbox:{coords}[,cluster][,z:{zoom}][,s:{since}][,u:{until}][,q:{query}]"
const sourceCache = new Map<string, { data: NewsItem[]; timestamp: number }>();

const refreshThrottle = new Map<string, number>();
const REFRESH_COOLDOWN = 60 * 1000; // 1 minute

// Maximum number of raw event rows to return in a single request
const RAW_LIMIT = 2000;

// Fields selected for list view. Description is excluded and fetched per-item.
const LIST_SELECT =
  "id, title, url, source, source_type, category, image_url, published_at, latitude, longitude, location_name, impact_score, credibility_tier, event_count";
const LIST_SELECT_WITH_SOURCES = `${LIST_SELECT}, sources`;

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

  // Bounding box parameters for geographic filtering
  const minLat = searchParams.get("minLat");
  const maxLat = searchParams.get("maxLat");
  const minLng = searchParams.get("minLng");
  const maxLng = searchParams.get("maxLng");
  // BBox is ignored if unmappedOnly is true
  const hasBBox =
    !unmappedOnly &&
    minLat !== null &&
    maxLat !== null &&
    minLng !== null &&
    maxLng !== null;

  // Numerical stability epsilon for coordinate comparisons
  const EPSILON = 0.00001;

  // Search query for text-based filtering
  const searchQuery = searchParams.get("query");

  // Global search overrides bounding box constraints
  const ignoreBBox = !!searchQuery || unmappedOnly;

  // Zoom level used to determine whether to apply server-side clustering
  const zoomStr = searchParams.get("zoom");
  const zoom = zoomStr ? parseFloat(zoomStr) : null;

  const sort = normalizeSortMode(searchParams.get("sort"));
  const limit = searchParams.get("limit")
    ? parseInt(searchParams.get("limit")!)
    : RAW_LIMIT;
  const sinceStr = searchParams.get("since");
  const untilStr = searchParams.get("until");
  const sinceMs = sinceStr ? new Date(sinceStr).getTime() : null;
  const untilMs = untilStr ? new Date(untilStr).getTime() : null;
  const effectiveLimit = limit;

  // Enable server-side clustering via RPC by default for mapped news
  const useServerClustering = !unmappedOnly;

  // Construct a cache key that captures all query parameters
  const bboxKeyPart = ignoreBBox
    ? "global"
    : `${minLat},${maxLat},${minLng},${maxLng}`;
  const cacheKey =
    hasBBox || ignoreBBox
      ? `view:${viewMode},scope:${scopeMode},bbox:${bboxKeyPart}${useServerClustering ? `,cluster,z:${Math.floor(zoom!)}` : ""}${sinceStr ? `,s:${sinceStr}` : ""}${untilStr ? `,u:${untilStr}` : ""}${searchQuery ? `,q:${searchQuery}` : ""}${sort !== "new" ? `,sort:${sort}` : ""}${effectiveLimit !== RAW_LIMIT ? `,l:${effectiveLimit}` : ""}${unmappedOnly ? ",unmappedOnly:1" : ""}`
      : `view:${viewMode},scope:${scopeMode},events${sinceStr ? `,s:${sinceStr}` : ""}${untilStr ? `,u:${untilStr}` : ""}${sort !== "new" ? `,sort:${sort}` : ""}${effectiveLimit !== RAW_LIMIT ? `,l:${effectiveLimit}` : ""}${unmappedOnly ? ",unmappedOnly:1" : ""}`;
  const canUseCache = true;
  const cacheTtlMs = !hasBBox ? 5 * 60 * 1000 : 60 * 1000;

  // Prevent excessive refresh attempts
  if (forceRefresh) {
    const lastRefresh = refreshThrottle.get("global") || 0;
    if (now - lastRefresh < REFRESH_COOLDOWN) {
      forceRefresh = false;
    } else {
      refreshThrottle.set("global", now);
    }
  }

  try {
    // Multi-tier rate limiting
    const ipHeader = request.headers.get("x-forwarded-for");
    const ip = ipHeader ? ipHeader.split(",")[0].trim() : "127.0.0.1";

    performL1Cleanup();

    const l1 = localL1Limit.get(ip);
    if (!l1 || now > l1.reset) {
      localL1Limit.set(ip, { count: 1, reset: now + 10000 });
    } else {
      l1.count++;
      // Check Redis if local threshold is exceeded or periodically to sync state
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
          // Fail open on rate limiter connectivity issues
          console.error(
            "[api/news] Rate limiter error (failing open):",
            ratelimitError,
          );
        }
      }
    }

    let allItems: NewsItem[];
    const cached = sourceCache.get(cacheKey);

    if (
      canUseCache &&
      !forceRefresh &&
      cached &&
      now - cached.timestamp < cacheTtlMs
    ) {
      allItems = cached.data;
    } else {
      let rows, error;

      let normMinLng: number | null = null;
      let normMaxLng: number | null = null;

      if (!ignoreBBox && hasBBox) {
        normMinLng = parseFloat(minLng!) - EPSILON;
        normMaxLng = parseFloat(maxLng!) + EPSILON;
      }

      if (useServerClustering) {
        // Execute server-side clustering RPC
        // The RPC handles bbox, time range, search, and sorting internally.
        // Calculate a buffered time window for 'Hot' mode to catch stories with recent 
        // source activity but slightly older master 'published_at' timestamps.
        let rpcSince = sinceStr;
        if (sort === "hot" && sinceMs !== null) {
          const bufferMs = 24 * 60 * 60 * 1000; // 24h buffer
          rpcSince = new Date(sinceMs - bufferMs).toISOString();
        }

        const rpcParams: Record<string, unknown> = {
          p_zoom_level: zoom !== null ? Math.floor(zoom) : null,
          p_min_lat: ignoreBBox ? null : parseFloat(minLat!) - EPSILON,
          p_max_lat: ignoreBBox ? null : parseFloat(maxLat!) + EPSILON,
          p_min_lng: ignoreBBox ? null : normMinLng,
          p_max_lng: ignoreBBox ? null : normMaxLng,
          p_sort_mode: sort,
          p_limit: effectiveLimit,
        };
        if (rpcSince) rpcParams.p_since = rpcSince;
        if (untilStr) rpcParams.p_until = untilStr;
        if (searchQuery) rpcParams.p_search_query = searchQuery;

        const res = await supabase.rpc("get_clustered_events", rpcParams);
        rows = res.data;
        error = res.error;
      } else {
        // Standard query for unmapped-only view (items without coordinates)
        let query = supabase.from("events").select(LIST_SELECT_WITH_SOURCES);

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

        const res = await query;
        rows = res.data;
        error = res.error;
      }

      if (error) {
        console.error("[api/news] Supabase query failed:", error.message);
        // Fail gracefully on statement timeouts so the UI stays functional.
        // The client will retry automatically on the next viewport change.
        if (
          error.message?.includes("statement timeout") ||
          error.message?.includes("canceling statement")
        ) {
          const stale = sourceCache.get(cacheKey);
          if (stale && stale.data.length > 0) {
            console.warn(
              "[api/news] Statement timeout — serving stale cache for fail-open stability.",
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

          console.warn(
            "[api/news] Statement timeout — returning empty result set (fail-open).",
          );
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

      allItems = (rows as DbEvent[]).map((row) => {
        const item = dbEventToNewsItem(row);
        // Hybrid ID logic: Ensure stable cluster IDs across client-side refreshes.
        // We store the original UUID so the frontend can still fetch the description
        // of the representative event for this cluster.
        // ONLY apply to aggregated clusters (storyCount > 1). Individual items MUST
        // retain their UUIDs directly to avoid duplicate keys during zoom transitions.
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

      // Apply time-window semantics against latest source activity, not only story publish time.
      const hasSince = Number.isFinite(sinceMs);
      const hasUntil = Number.isFinite(untilMs);
      if (hasSince || hasUntil) {
        allItems = allItems.filter((item) => {
          const ts = latestReportTimestamp(item);
          if (!Number.isFinite(ts) || ts <= 0) return false;
          if (hasSince && ts < (sinceMs as number)) return false;
          if (hasUntil && ts > (untilMs as number)) return false;
          return true;
        });
      }

      // Keep list payload lean while preserving latest-activity semantics for client filters/sorting.
      allItems = allItems.map((item) => {
        const ts = latestReportTimestamp(item);
        return {
          ...item,
          latestActivityAt:
            Number.isFinite(ts) && ts > 0
              ? new Date(ts).toISOString()
              : item.publishedAt,
          sources: undefined,
        };
      });

      // RPC results are already sorted and limited, but standard query might not be perfectly aligned.
      // We skip redundant sorting for RPC to minimize Vercel processing.
      if (!useServerClustering) {
        allItems = sortNewsItems(allItems, sort);
        if (effectiveLimit < allItems.length) {
          allItems = allItems.slice(0, effectiveLimit);
        }
      }

      if (canUseCache) {
        sourceCache.set(cacheKey, { data: allItems, timestamp: now });
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
