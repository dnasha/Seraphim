import { useState, useEffect, useCallback, useRef } from 'react';
import { NewsItem, NewsResponse } from '@/lib/types';
import { createClient } from '@supabase/supabase-js';

/*
  Dan Sharan

  useNewsData — React hook for fetching news data driven by the map viewport.

  Key behaviors:
  - Initial fetch: all mapped events (no BBox, no description) as a safe default
    while the map initializes and emits its first bounds.
  - BBox fetch: every time the user pans or zooms, the map calls onBoundsChange
    with the new viewport. Results are cached client-side (bbox+timeRange key →
    items) so panning back to a seen area skips the DB round-trip.
  - Zoom-aware: zoom is always forwarded to the API. At zoom < 5 the API
    automatically returns server-side cluster objects, protecting the client from
    large DOM counts at global scale.
  - Time-aware: the active timeRange is forwarded to the API so server-side
    clustering respects the same time window the client uses. When timeRange
    changes, the client cache is invalidated and the current view refetches.
  - Force-raw: power users can enable the manual cluster toggle which sets
    forceRaw=true, bypassing server-side clustering.
  - On-demand detail: fetchEventDetails(id) hits /api/news/[id] and patches the
    description into the existing item in place.
  - Realtime: subscribes to Supabase INSERT events. New rows within the current
    bounding box are prepended to the list without a full refetch.
  - Fallback polling: 15-minute setInterval heartbeat in case the WebSocket drops.
*/

export interface BBox {
    minLat: number;
    maxLat: number;
    minLng: number;
    maxLng: number;
    zoom?: number;
    forceRaw?: boolean;
    /** ISO timestamp — events older than this are excluded server-side. */
    since?: string;
    /** Human-readable label used in the cache key (e.g. '1d', '1w'). */
    timeRange?: string;
}

// Supabase client for Realtime only — read-only anon key
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

function snapBBox(b: BBox): BBox {
    const z = b.zoom || 5;
    const grid = z < 4 ? 10 : z < 7 ? 4 : z < 10 ? 1 : 0.5;
    return {
        ...b,
        minLat: Math.floor(b.minLat / grid) * grid,
        maxLat: Math.ceil(b.maxLat / grid) * grid,
        minLng: Math.floor(b.minLng / grid) * grid,
        maxLng: Math.ceil(b.maxLng / grid) * grid,
        zoom: Math.round(z),
    };
}

function bboxKey(b: BBox) {
    return [
        b.minLat.toFixed(4),
        b.maxLat.toFixed(4),
        b.minLng.toFixed(4),
        b.maxLng.toFixed(4),
        b.zoom !== undefined ? `z:${b.zoom.toFixed(1)}` : '',
        b.timeRange ? `tr:${b.timeRange}` : '',
        b.forceRaw ? 'raw' : '',
    ].filter(Boolean).join(',');
}

function isWithinBBox(item: NewsItem, bbox: BBox): boolean {
    if (item.latitude == null || item.longitude == null) return false;
    return (
        item.latitude >= bbox.minLat &&
        item.latitude <= bbox.maxLat &&
        item.longitude >= bbox.minLng &&
        item.longitude <= bbox.maxLng
    );
}

/** Convert a timeRange label to an ISO timestamp for server-side filtering. */
function computeSince(timeRange: string): string | null {
    const now = Date.now();
    const ms: Record<string, number> = {
        '1d': 24 * 60 * 60 * 1000,
        '3d': 3 * 24 * 60 * 60 * 1000,
        '1w': 7 * 24 * 60 * 60 * 1000,
        '1m': 30 * 24 * 60 * 60 * 1000,
    };
    return ms[timeRange] ? new Date(now - ms[timeRange]).toISOString() : null;
}

// Client-side cache: bbox+timeRange key → NewsItem array
const bboxCache = new Map<string, { bbox: BBox; data: NewsItem[]; timestamp: number }>();
const BBOX_CACHE_TTL = 10 * 60 * 1000; // 10 minutes

export function useNewsData({ includeUnmapped, timeRange }: { includeUnmapped: boolean; timeRange: string }) {
    const [news, setNews] = useState<NewsItem[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [lastUpdated, setLastUpdated] = useState<string | null>(null);

    // Track the current bounding box so Realtime and heartbeat can filter/refetch correctly
    const currentBBoxRef = useRef<BBox | null>(null);
    const timeRangeRef = useRef(timeRange);

    // Client-side description cache: id → description string
    const descriptionCache = useRef<Map<string, string>>(new Map());

    // -------------------------------------------------------------------------
    // Core list fetch (initial + BBox changes + manual refresh)
    // -------------------------------------------------------------------------
    const fetchNews = useCallback(async (isRefresh = false, rawBBox?: BBox) => {
        setIsLoading(true);
        setError(null);

        const bbox = rawBBox ? snapBBox(rawBBox) : undefined;

        // Check client-side cache first (skip on forced refresh)
        if (bbox && !isRefresh) {
            const key = bboxKey(bbox);
            const cached = bboxCache.get(key);
            if (cached && Date.now() - cached.timestamp < BBOX_CACHE_TTL) {
                setNews(cached.data);
                setIsLoading(false);
                return;
            }
        }

        try {
            const params = new URLSearchParams();
            if (isRefresh) params.append('refresh', 'true');
            if (includeUnmapped) params.append('include_unmapped', 'true');
            if (bbox) {
                params.append('minLat', String(bbox.minLat));
                params.append('maxLat', String(bbox.maxLat));
                params.append('minLng', String(bbox.minLng));
                params.append('maxLng', String(bbox.maxLng));
                if (bbox.zoom !== undefined) params.append('zoom', String(bbox.zoom));
                if (bbox.forceRaw) params.append('force_raw', 'true');
                if (bbox.since) params.append('since', bbox.since);
            }

            const res = await fetch(`/api/news?${params.toString()}`);
            if (!res.ok) throw new Error('Failed to fetch news');

            const data: NewsResponse = await res.json();

            // Merge back any descriptions we've already fetched client-side
            const enriched = data.items.map(item => {
                const cachedDesc = descriptionCache.current.get(item.id);
                return cachedDesc ? { ...item, description: cachedDesc } : item;
            });

            // Update client-side bbox cache
            if (bbox) {
                bboxCache.set(bboxKey(bbox), { bbox, data: enriched, timestamp: Date.now() });
            }

            setNews(enriched);
            setLastUpdated(new Date().toISOString());
        } catch (err) {
            setError(err instanceof Error ? err.message : 'An error occurred');
        } finally {
            setIsLoading(false);
        }
    }, [includeUnmapped]);

    // -------------------------------------------------------------------------
    // Re-fetch when timeRange changes — invalidate cache and reload current view
    // -------------------------------------------------------------------------
    useEffect(() => {
        const prevTimeRange = timeRangeRef.current;
        timeRangeRef.current = timeRange;

        if (prevTimeRange === timeRange) return; // no actual change on mount

        // Invalidate all cached results — they may span a different time window
        bboxCache.clear();

        const currentBBox = currentBBoxRef.current;
        if (currentBBox) {
            const since = computeSince(timeRange);
            fetchNews(false, { ...currentBBox, since: since ?? undefined, timeRange });
        } else {
            fetchNews();
        }
    }, [timeRange, fetchNews]);

    // -------------------------------------------------------------------------
    // On-demand detail fetch (description lazy-load)
    // -------------------------------------------------------------------------
    const fetchEventDetails = useCallback(async (id: string) => {
        if (!id || id.startsWith('cluster-')) return;
        if (descriptionCache.current.has(id)) return;

        try {
            const res = await fetch(`/api/news/${id}`);
            if (!res.ok) return;
            const { description } = await res.json() as { description: string };

            descriptionCache.current.set(id, description);

            setNews(prev =>
                prev.map(item => (item.id === id ? { ...item, description } : item))
            );

            bboxCache.forEach((entry, key) => {
                const updated = entry.data.map(item =>
                    item.id === id ? { ...item, description } : item
                );
                bboxCache.set(key, { ...entry, data: updated });
            });
        } catch {
            // Silently fail — the card will just show no description
        }
    }, []);

    // -------------------------------------------------------------------------
    // Bounding-box change handler (called from NewsMap via page.tsx)
    // Injects the current since timestamp so the server filters by time.
    // -------------------------------------------------------------------------
    const onBoundsChange = useCallback((bbox: BBox) => {
        const since = computeSince(timeRangeRef.current);
        const enrichedBBox: BBox = {
            ...bbox,
            since: since ?? undefined,
            timeRange: timeRangeRef.current,
        };
        currentBBoxRef.current = enrichedBBox;
        fetchNews(false, enrichedBBox);
    }, [fetchNews]);

    // -------------------------------------------------------------------------
    // Supabase Realtime — INSERT subscription
    // -------------------------------------------------------------------------
    useEffect(() => {
        if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return;

        const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
            auth: { persistSession: false, autoRefreshToken: false },
        });

        const channel = supabase
            .channel('events-inserts')
            .on(
                'postgres_changes',
                { event: 'INSERT', schema: 'public', table: 'events' },
                (payload) => {
                    const row = payload.new as {
                        id: string;
                        title: string;
                        url: string;
                        source: string;
                        source_type: 'gnews' | 'rss' | 'social';
                        category?: string;
                        image_url?: string;
                        published_at: string;
                        latitude?: number | null;
                        longitude?: number | null;
                        location_name?: string | null;
                        tags?: string[] | null;
                    };

                    const newItem: NewsItem = {
                        id: row.id,
                        title: row.title,
                        url: row.url,
                        source: row.source,
                        sourceType: row.source_type,
                        category: row.category,
                        publishedAt: row.published_at,
                        imageUrl: row.image_url ?? undefined,
                        latitude: row.latitude ?? undefined,
                        longitude: row.longitude ?? undefined,
                        locationName: row.location_name ?? undefined,
                        tags: row.tags ?? undefined,
                    };

                    const bbox = currentBBoxRef.current;
                    if (bbox && !isWithinBBox(newItem, bbox)) return;

                    setNews(prev => {
                        if (prev.some(p => p.id === newItem.id)) return prev;
                        const updated = [newItem, ...prev];
                        
                        // Update all cache entries that contain this new item
                        bboxCache.forEach((entry, key) => {
                            if (isWithinBBox(newItem, entry.bbox)) {
                                bboxCache.set(key, { ...entry, data: [newItem, ...entry.data] });
                            }
                        });
                        
                        return updated;
                    });
                    setLastUpdated(new Date().toISOString());
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, []);

    // -------------------------------------------------------------------------
    // Initial fetch + polling fallback heartbeat
    // -------------------------------------------------------------------------
    useEffect(() => {
        fetchNews();
    }, [fetchNews]);

    useEffect(() => {
        const interval = setInterval(() => {
            const bbox = currentBBoxRef.current;
            if (bbox) {
                const since = computeSince(timeRangeRef.current);
                fetchNews(true, { ...bbox, since: since ?? undefined, timeRange: timeRangeRef.current });
            } else {
                fetchNews(true);
            }
        }, 15 * 60 * 1000);
        return () => clearInterval(interval);
    }, [fetchNews]);

    return {
        news,
        isLoading,
        error,
        lastUpdated,
        fetchNews,
        onBoundsChange,
        fetchEventDetails,
    };
}
