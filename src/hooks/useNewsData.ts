import { useState, useEffect, useCallback, useRef } from 'react';
import { NewsItem, NewsResponse } from '@/lib/types';
import { createClient } from '@supabase/supabase-js';

/*
  Dan Sharan

  useNewsData — React hook for fetching and polling news data.

  Key behaviors:
  - Initial fetch: all mapped events (no BBox, no description).
  - BBox fetch: when the user pans the map, fetches events for that viewport.
    Results are cached in a client-side Map keyed by bbox string so panning
    back to a previously-seen area does not hit the server.
  - On-demand detail: fetchEventDetails(id) hits /api/news/[id] and patches
    the description into the existing item in place.
  - Realtime: subscribes to Supabase INSERT events. New rows within the current
    bounding box are prepended to the list without a full refetch. Rows outside
    the bbox are silently ignored (no stale data, no wasted re-renders).
  - Fallback polling: 15-minute setInterval remains as a heartbeat in case
    the WebSocket connection drops.
*/

export interface BBox {
    minLat: number;
    maxLat: number;
    minLng: number;
    maxLng: number;
}

// Supabase client for Realtime only — read-only anon key
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

function bboxKey(b: BBox) {
    return `${b.minLat.toFixed(4)},${b.maxLat.toFixed(4)},${b.minLng.toFixed(4)},${b.maxLng.toFixed(4)}`;
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

// Client-side cache: bbox key → NewsItem array
// Prevents duplicate DB hits when the user pans back to an area they've seen
const bboxCache = new Map<string, { data: NewsItem[]; timestamp: number }>();
const BBOX_CACHE_TTL = 10 * 60 * 1000; // 10 minutes

export function useNewsData({ includeUnmapped }: { includeUnmapped: boolean }) {
    const [news, setNews] = useState<NewsItem[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isLoadingMore, setIsLoadingMore] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [lastUpdated, setLastUpdated] = useState<string | null>(null);
    const [nextCursor, setNextCursor] = useState<string | null>(null);

    // Track the current bounding box so Realtime can filter incoming events
    const currentBBoxRef = useRef<BBox | null>(null);

    // Client-side description cache: id → description string
    // Prevents re-fetching when a user collapses and re-expands a card
    const descriptionCache = useRef<Map<string, string>>(new Map());

    // -------------------------------------------------------------------------
    // Core list fetch (initial + BBox changes + manual refresh)
    // -------------------------------------------------------------------------
    const fetchNews = useCallback(async (isRefresh = false, bbox?: BBox) => {
        setIsLoading(true);
        setError(null);

        // If a bbox is given, check the client-side cache first
        if (bbox && !isRefresh) {
            const key = bboxKey(bbox);
            const cached = bboxCache.get(key);
            if (cached && Date.now() - cached.timestamp < BBOX_CACHE_TTL) {
                setNews(cached.data);
                setNextCursor(null);
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
                bboxCache.set(bboxKey(bbox), { data: enriched, timestamp: Date.now() });
            }

            setNews(enriched);
            setNextCursor(data.nextCursor || null);
            setLastUpdated(new Date().toISOString());
        } catch (err) {
            setError(err instanceof Error ? err.message : 'An error occurred');
        } finally {
            setIsLoading(false);
        }
    }, [includeUnmapped]);

    // -------------------------------------------------------------------------
    // On-demand detail fetch (description lazy-load)
    // -------------------------------------------------------------------------
    const fetchEventDetails = useCallback(async (id: string) => {
        // Check client-side description cache first
        if (descriptionCache.current.has(id)) {
            return; // Already loaded; EventSidebar will read from `news` state
        }

        try {
            const res = await fetch(`/api/news/${id}`);
            if (!res.ok) return;
            const { description } = await res.json() as { description: string };

            // Persist in client cache so collapsing and re-expanding is instant
            descriptionCache.current.set(id, description);

            // Patch the description into the existing item in state
            setNews(prev =>
                prev.map(item => (item.id === id ? { ...item, description } : item))
            );

            // Also update the bbox cache so the description survives a bbox refetch
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
    // Load more (cursor pagination)
    // -------------------------------------------------------------------------
    const lastLoadMoreTime = useRef(0);
    const LOAD_MORE_COOLDOWN = 1500;

    const loadMore = useCallback(async () => {
        const now = Date.now();
        if (!nextCursor || isLoadingMore) return;
        if (now - lastLoadMoreTime.current < LOAD_MORE_COOLDOWN) {
            console.warn('[useNewsData] Load more throttled');
            return;
        }

        setIsLoadingMore(true);
        lastLoadMoreTime.current = now;
        setError(null);

        try {
            const params = new URLSearchParams();
            if (includeUnmapped) params.append('include_unmapped', 'true');
            params.append('cursor', nextCursor);

            const res = await fetch(`/api/news?${params.toString()}`);
            if (res.status === 429) {
                const data = await res.json();
                throw new Error(data.error || 'Too many requests');
            }
            if (!res.ok) throw new Error('Failed to load more news');

            const data: NewsResponse = await res.json();
            setNews(prev => [...prev, ...data.items]);
            setNextCursor(data.nextCursor || null);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'An error occurred');
        } finally {
            setIsLoadingMore(false);
        }
    }, [nextCursor, isLoadingMore, includeUnmapped]);

    // -------------------------------------------------------------------------
    // Bounding-box change handler (called from NewsMap via page.tsx)
    // -------------------------------------------------------------------------
    const onBoundsChange = useCallback((bbox: BBox) => {
        currentBBoxRef.current = bbox;
        fetchNews(false, bbox);
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
                        // description intentionally omitted — loaded on demand
                    };

                    // Only add the event if it falls within the user's current view.
                    // If there is no bbox (global view), add everything.
                    const bbox = currentBBoxRef.current;
                    if (bbox && !isWithinBBox(newItem, bbox)) return;

                    setNews(prev => {
                        // Guard against duplicate inserts (Realtime can replay)
                        if (prev.some(p => p.id === newItem.id)) return prev;
                        return [newItem, ...prev];
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
            // Heartbeat: if we have an active bbox, refetch that view; otherwise global
            if (currentBBoxRef.current) {
                fetchNews(true, currentBBoxRef.current);
            } else {
                fetchNews(true);
            }
        }, 15 * 60 * 1000); // 15 minutes
        return () => clearInterval(interval);
    }, [fetchNews]);

    return {
        news,
        isLoading,
        isLoadingMore,
        hasMore: !!nextCursor,
        error,
        lastUpdated,
        fetchNews,
        loadMore,
        onBoundsChange,
        fetchEventDetails,
    };
}
