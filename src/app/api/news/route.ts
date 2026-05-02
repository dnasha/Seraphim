import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { NewsItem, NewsResponse } from '@/lib/types';
import { DbEvent, dbEventToNewsItem } from '@/types';

/*
  API Proxy Route: Fetches pre-processed events from Supabase.
*/

// Supabase client (read-only anon key, respects RLS)
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
});

// Upstash Rate Limiting setup
const redis = Redis.fromEnv();
const ratelimit = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(60, '1 m'),
    analytics: true,
    prefix: '@upstash/ratelimit/seraphim',
});

// Local L1 Rate Limiter (Memory) - minimizes Upstash calls for repetitive requests from same IP
const localL1Limit = new Map<string, { count: number; reset: number }>();
let lastL1Cleanup = Date.now();
const L1_CLEANUP_INTERVAL = 60000; // 1 minute

function performL1Cleanup() {
    const now = Date.now();
    if (now - lastL1Cleanup < L1_CLEANUP_INTERVAL) return;
    
    for (const [ip, data] of localL1Limit.entries()) {
        if (now > data.reset) localL1Limit.delete(ip);
    }
    lastL1Cleanup = now;
}

// In-memory cache to reduce Supabase egress and improve response times.
// Key format: "events" (default) or "bbox:{minLat},{maxLat},{minLng},{maxLng}[,z:{zoom}]"
const sourceCache = new Map<string, { data: NewsItem[]; timestamp: number }>();
const CACHE_TTL = 15 * 60 * 1000; // 15 minutes

const refreshThrottle = new Map<string, number>();
const REFRESH_COOLDOWN = 60 * 1000; // 1 minute

// Zoom level below which we automatically switch to server-side clustering.
// At zoom < 5 (country/continent scale), individual pins are not useful and
// the event count can be very large.
const CLUSTER_ZOOM_THRESHOLD = 5;

// Safety cap on raw event rows returned per request.
const RAW_LIMIT = 2000;

// Intentionally excluded from the SELECT - loaded via /api/news/[id] on demand.
const LIST_SELECT = 'id, title, url, source, source_type, category, image_url, published_at, latitude, longitude, location_name';

export async function GET(request: Request) {
    // 1. Extract IP and Timestamp
    const ip = request.headers.get('x-forwarded-for') ?? '127.0.0.1';
    const now = Date.now();

    // 2. Hybrid Rate Limiting Logic (Optimized for Cost)
    // Perform passive cleanup of stale local entries
    performL1Cleanup();

    // Tier 1: Local In-Memory Check (Zero Cost)
    const l1 = localL1Limit.get(ip);
    
    // If we haven't seen this IP or L1 window (10s) expired, start new window
    if (!l1 || now > l1.reset) {
        localL1Limit.set(ip, { count: 1, reset: now + 10000 });
    } else {
        l1.count++;
        
        // Tier 2: Check Redis only if:
        // a) IP is "spamming" (>10 reqs in 10s window)
        // b) Every 5th request (sampling to sync with global state)
        if (l1.count > 10 || l1.count % 5 === 0) {
            const { success } = await ratelimit.limit(ip);
            if (!success) {
                return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
            }
        }
    }
    const { searchParams } = new URL(request.url);
    let forceRefresh = searchParams.get('refresh') === 'true';
    const includeUnmapped = searchParams.get('include_unmapped') === 'true';

    // Optional bounding box parameters - sent by the map after every moveend.
    const minLat = searchParams.get('minLat');
    const maxLat = searchParams.get('maxLat');
    const minLng = searchParams.get('minLng');
    const maxLng = searchParams.get('maxLng');
    const hasBBox = minLat !== null && maxLat !== null && minLng !== null && maxLng !== null;

    // Small epsilon to stabilize floating point comparisons at the map edges
    const EPSILON = 0.00001;

    // Search query parameter
    const searchQuery = searchParams.get('query');
    // If a global search query is active, we ignore the bounding box constraint to find events anywhere.
    const ignoreBBox = !!searchQuery;

    // Zoom level - always provided alongside BBox. Used for auto-clustering decisions.
    const zoomStr = searchParams.get('zoom');
    const zoom = zoomStr ? parseFloat(zoomStr) : null;

    // Power-user override: skip server-side clustering even at low zoom.
    const forceRaw = searchParams.get('force_raw') === 'true';

    // Time-window filter - ISO timestamp; events older than this are excluded.
    // Forwarded from the client's active timeRange so clustering respects the
    // same time window the sidebar filter uses.
    const sinceStr = searchParams.get('since');

    // Decide whether to use server-side clustering:
    // We still cluster global searches if we have a zoom level to base it on
    const useServerClustering = (hasBBox || ignoreBBox) && zoom !== null && zoom < CLUSTER_ZOOM_THRESHOLD && !forceRaw;

    // Cache key encodes the full query shape.
    const bboxKeyPart = ignoreBBox ? 'global' : `${minLat},${maxLat},${minLng},${maxLng}`;
    const cacheKey = (hasBBox || ignoreBBox)
        ? `bbox:${bboxKeyPart}${useServerClustering ? `,cluster,z:${Math.floor(zoom!)}` : ''}${sinceStr ? `,s:${sinceStr}` : ''}${searchQuery ? `,q:${searchQuery}` : ''}`
        : `events${sinceStr ? `,s:${sinceStr}` : ''}`;
    const canUseCache = !includeUnmapped;

    // Throttle refresh attempts
    if (forceRefresh) {
        const lastRefresh = refreshThrottle.get('global') || 0;
        if (now - lastRefresh < REFRESH_COOLDOWN) {
            forceRefresh = false;
        } else {
            refreshThrottle.set('global', now);
        }
    }

    try {
        let allItems: NewsItem[];

        const cached = sourceCache.get(cacheKey);

        if (canUseCache && !forceRefresh && cached && (now - cached.timestamp) < CACHE_TTL) {
            allItems = cached.data;
        } else {
            let rows, error;

                if (useServerClustering) {
                    // Low zoom: delegate to the clustering RPC.
                    const rpcParams: Record<string, unknown> = {
                        p_zoom_level: Math.floor(zoom!),
                        p_min_lat: ignoreBBox ? null : parseFloat(minLat!),
                        p_max_lat: ignoreBBox ? null : parseFloat(maxLat!),
                        p_min_lng: ignoreBBox ? null : parseFloat(minLng!),
                        p_max_lng: ignoreBBox ? null : parseFloat(maxLng!),
                    };
                    if (sinceStr) rpcParams.p_since = sinceStr;
                    if (searchQuery) rpcParams.p_search_query = searchQuery;

                const res = await supabase.rpc('get_clustered_events', rpcParams).limit(RAW_LIMIT);
                rows = res.data;
                error = res.error;
            } else {
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

                // Apply server-side time filter when provided.
                // Client-side applyNewsFilters will still run, but this
                // reduces egress on large bbox queries.
                if (sinceStr) {
                    query = query.gte('published_at', sinceStr);
                }

                const res = await query;
                rows = res.data;
                error = res.error;
            }

            if (error) {
                console.error('[api/news] Supabase query failed:', error.message);
                return NextResponse.json({ error: 'Failed to fetch news' }, { status: 500 });
            }

            allItems = (rows as DbEvent[]).map(dbEventToNewsItem);

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
