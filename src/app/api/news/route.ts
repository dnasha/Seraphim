/*
  Primary news feed API route.
  Handles fetching news events from Supabase with support for bounding box filtering,
  server-side clustering, search queries, and time-window filtering.
  Implements a multi-tier rate limiting strategy and in-memory caching.
*/

import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { NewsItem, NewsResponse } from '@/lib/types';
import { DbEvent, dbEventToNewsItem } from '@/types';

// Global rate limiter using Upstash Redis
const redis = Redis.fromEnv();
const ratelimit = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(120, '1 m'),
    analytics: true,
    prefix: '@upstash/ratelimit/seraphim',
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
const CACHE_TTL = 15 * 60 * 1000; // 15 minutes

const refreshThrottle = new Map<string, number>();
const REFRESH_COOLDOWN = 60 * 1000; // 1 minute

// Threshold for switching to server-side clustering (zoom levels < 5)
const CLUSTER_ZOOM_THRESHOLD = 5;

// Maximum number of raw event rows to return in a single request
const RAW_LIMIT = 2000;

// Fields selected for list view. Description is excluded and fetched per-item.
const LIST_SELECT = 'id, title, url, source, source_type, category, image_url, published_at, latitude, longitude, location_name';

export async function GET(request: Request) {
    const now = Date.now();
    const { searchParams } = new URL(request.url);
    let forceRefresh = searchParams.get('refresh') === 'true';
    const includeUnmapped = searchParams.get('include_unmapped') === 'true';

    // Bounding box parameters for geographic filtering
    const minLat = searchParams.get('minLat');
    const maxLat = searchParams.get('maxLat');
    const minLng = searchParams.get('minLng');
    const maxLng = searchParams.get('maxLng');
    const hasBBox = minLat !== null && maxLat !== null && minLng !== null && maxLng !== null;

    // Numerical stability epsilon for coordinate comparisons
    const EPSILON = 0.00001;

    // Search query for text-based filtering
    const searchQuery = searchParams.get('query');
    
    // Global search overrides bounding box constraints
    const ignoreBBox = !!searchQuery;

    // Zoom level used to determine whether to apply server-side clustering
    const zoomStr = searchParams.get('zoom');
    const zoom = zoomStr ? parseFloat(zoomStr) : null;

    // Optional override to skip clustering regardless of zoom level
    const forceRaw = searchParams.get('force_raw') === 'true';

    // Time window parameters (ISO timestamps)
    const sinceStr = searchParams.get('since');
    const untilStr = searchParams.get('until');

    // Logic to determine if server-side clustering should be performed
    const useServerClustering = (hasBBox || ignoreBBox) && zoom !== null && zoom < CLUSTER_ZOOM_THRESHOLD && !forceRaw;

    // Construct a cache key that captures all query parameters
    const bboxKeyPart = ignoreBBox ? 'global' : `${minLat},${maxLat},${minLng},${maxLng}`;
    const cacheKey = (hasBBox || ignoreBBox)
        ? `bbox:${bboxKeyPart}${useServerClustering ? `,cluster,z:${Math.floor(zoom!)}` : ''}${sinceStr ? `,s:${sinceStr}` : ''}${untilStr ? `,u:${untilStr}` : ''}${searchQuery ? `,q:${searchQuery}` : ''}`
        : `events${sinceStr ? `,s:${sinceStr}` : ''}${untilStr ? `,u:${untilStr}` : ''}`;
    const canUseCache = !includeUnmapped;

    // Prevent excessive refresh attempts
    if (forceRefresh) {
        const lastRefresh = refreshThrottle.get('global') || 0;
        if (now - lastRefresh < REFRESH_COOLDOWN) {
            forceRefresh = false;
        } else {
            refreshThrottle.set('global', now);
        }
    }

    try {
        // Multi-tier rate limiting
        const ipHeader = request.headers.get('x-forwarded-for');
        const ip = ipHeader ? ipHeader.split(',')[0].trim() : '127.0.0.1';

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
                        return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
                    }
                } catch (ratelimitError) {
                    // Fail open on rate limiter connectivity issues
                    console.error('[api/news] Rate limiter error (failing open):', ratelimitError);
                }
            }
        }

        let allItems: NewsItem[];
        const cached = sourceCache.get(cacheKey);

        if (canUseCache && !forceRefresh && cached && (now - cached.timestamp) < CACHE_TTL) {
            allItems = cached.data;
        } else {
            let rows, error;

                if (useServerClustering) {
                    // Execute server-side clustering RPC for low zoom levels
                    const rpcParams: Record<string, unknown> = {
                        p_zoom_level: Math.floor(zoom!),
                        p_min_lat: ignoreBBox ? null : parseFloat(minLat!),
                        p_max_lat: ignoreBBox ? null : parseFloat(maxLat!),
                        p_min_lng: ignoreBBox ? null : parseFloat(minLng!),
                        p_max_lng: ignoreBBox ? null : parseFloat(maxLng!),
                    };
                    if (sinceStr) rpcParams.p_since = sinceStr;
                    if (untilStr) rpcParams.p_until = untilStr;
                    if (searchQuery) rpcParams.p_search_query = searchQuery;

                const res = await supabase.rpc('get_clustered_events', rpcParams).limit(RAW_LIMIT);
                rows = res.data;
                error = res.error;
            } else {
                // Standard query for individual event markers
                let query = supabase
                    .from('events')
                    .select(LIST_SELECT)
                    .order('published_at', { ascending: false })
                    .limit(RAW_LIMIT);

                if (!ignoreBBox && hasBBox) {
                    query = query
                        .gte('latitude', parseFloat(minLat!) - EPSILON)
                        .lte('latitude', parseFloat(maxLat!) + EPSILON)
                        .gte('longitude', parseFloat(minLng!) - EPSILON)
                        .lte('longitude', parseFloat(maxLng!) + EPSILON);
                } else if (!includeUnmapped) {
                    query = query.not('latitude', 'is', null);
                }

                if (searchQuery) {
                    query = query.or(`title.ilike.%${searchQuery}%,location_name.ilike.%${searchQuery}%`);
                }

                // Server-side time filtering to reduce data transfer
                if (sinceStr) {
                    query = query.gte('published_at', sinceStr);
                }
                if (untilStr) {
                    query = query.lte('published_at', untilStr);
                }

                const res = await query;
                rows = res.data;
                error = res.error;
            }

            if (error) {
                console.error('[api/news] Supabase query failed:', error.message);
                return NextResponse.json({ error: 'Failed to fetch news' }, { status: 500 });
            }

            allItems = (rows as DbEvent[]).map((row) => {
                const item = dbEventToNewsItem(row);
                // Hybrid ID logic: Ensure stable cluster IDs across client-side refreshes
                if (useServerClustering && item.clusterId) {
                    item.id = `cluster-z${Math.floor(zoom!)}-${item.latitude?.toFixed(4)}-${item.longitude?.toFixed(4)}-${item.eventCount}`;
                }
                return item;
            });

            if (canUseCache) {
                sourceCache.set(cacheKey, { data: allItems, timestamp: now });
            }
        }

        const response: NewsResponse = {
            items: allItems,
            lastUpdated: new Date().toISOString(),
            sources: {
                gnews: true,
                rss: true,
                social: true,
            },
        };

        const cacheControl = canUseCache && !hasBBox
            ? 'public, s-maxage=900, stale-while-revalidate=59'
            : 'public, s-maxage=60, stale-while-revalidate=10';

        return NextResponse.json(response, {
            headers: { 'Cache-Control': cacheControl }
        });
    } catch (error) {
        console.error('[api/news] Unhandled error:', error);
        return NextResponse.json({ error: 'Failed to fetch news' }, { status: 500 });
    }
}

