import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { NewsItem, NewsResponse } from '@/lib/types';
import { DbEvent, dbEventToNewsItem } from '@/types';

/*
  Dan Sharan
  API Proxy Route: Fetches pre-processed events from Supabase.
  This route handles in-memory caching and basic throttling to protect the database.
  The scraper (src/scraper/index.ts) is responsible for data ingestion; this route is read-only.

  Egress optimization: `description` is intentionally excluded from the SELECT.
  It is fetched on-demand via /api/news/[id] only when a user expands a card.

  Clustering: When zoom < CLUSTER_ZOOM_THRESHOLD, the API delegates to the
  get_clustered_events RPC which returns aggregated cluster objects instead of
  raw rows. This protects the client from receiving hundreds of DOM-heavy pins
  at low zoom levels. The clustering toggle (forceRaw=true) allows power users
  to override this behavior.
*/

// Supabase client (read-only anon key, respects RLS)
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
});

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
const RAW_LIMIT = 500;

// Intentionally excluded from the SELECT — loaded via /api/news/[id] on demand.
const LIST_SELECT = 'id, title, url, source, source_type, category, image_url, published_at, latitude, longitude, location_name';

export async function GET(request: Request) {
    const now = Date.now();
    const { searchParams } = new URL(request.url);
    let forceRefresh = searchParams.get('refresh') === 'true';
    const includeUnmapped = searchParams.get('include_unmapped') === 'true';

    // Optional bounding box parameters — sent by the map after every moveend.
    const minLat = searchParams.get('minLat');
    const maxLat = searchParams.get('maxLat');
    const minLng = searchParams.get('minLng');
    const maxLng = searchParams.get('maxLng');
    const hasBBox = minLat !== null && maxLat !== null && minLng !== null && maxLng !== null;

    // Zoom level — always provided alongside BBox. Used for auto-clustering decisions.
    const zoomStr = searchParams.get('zoom');
    const zoom = zoomStr ? parseFloat(zoomStr) : null;

    // Power-user override: skip server-side clustering even at low zoom.
    const forceRaw = searchParams.get('force_raw') === 'true';

    // Time-window filter — ISO timestamp; events older than this are excluded.
    // Forwarded from the client's active timeRange so clustering respects the
    // same time window the sidebar filter uses.
    const sinceStr = searchParams.get('since');

    // Decide whether to use server-side clustering:
    const useServerClustering = hasBBox && zoom !== null && zoom < CLUSTER_ZOOM_THRESHOLD && !forceRaw;

    // Cache key encodes the full query shape.
    const cacheKey = hasBBox
        ? `bbox:${minLat},${maxLat},${minLng},${maxLng}${useServerClustering ? `,cluster,z:${Math.floor(zoom!)}` : ''}${sinceStr ? `,s:${sinceStr}` : ''}`
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
                    p_min_lat: parseFloat(minLat!),
                    p_max_lat: parseFloat(maxLat!),
                    p_min_lng: parseFloat(minLng!),
                    p_max_lng: parseFloat(maxLng!),
                };
                if (sinceStr) rpcParams.p_since = sinceStr;

                const res = await supabase.rpc('get_clustered_events', rpcParams).limit(RAW_LIMIT);
                rows = res.data ? res.data.map((row: DbEvent) => {
                    if (row.event_count && row.event_count > 1) {
                        row.id = `cluster-${Math.floor(zoom!)}-${row.cluster_id}`;
                    }
                    return row;
                }) : null;
                error = res.error;
            } else {
                let query = supabase
                    .from('events')
                    .select(LIST_SELECT)
                    .order('published_at', { ascending: false })
                    .limit(RAW_LIMIT);

                if (hasBBox) {
                    query = query
                        .gte('latitude', parseFloat(minLat!))
                        .lte('latitude', parseFloat(maxLat!))
                        .gte('longitude', parseFloat(minLng!))
                        .lte('longitude', parseFloat(maxLng!));
                } else if (!includeUnmapped) {
                    query = query.not('latitude', 'is', null);
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
