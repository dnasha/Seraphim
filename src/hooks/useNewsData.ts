'use client';

/*
useNewsData hook manages the fetching and caching of news events.
It handles bounding box snap logic, client-side jitter for overlapping pins,
and integrates with Supabase Realtime for live updates.
*/

import { useState, useEffect, useCallback, useRef } from 'react';
import { NewsItem, NewsResponse } from '@/lib/types';
import { supabase } from '@/lib/supabase';

export interface BBox {
    minLat: number;
    maxLat: number;
    minLng: number;
    maxLng: number;
    zoom?: number;
    forceRaw?: boolean;
    /** ISO timestamp - events older than this are excluded server-side. */
    since?: string;
    /** ISO timestamp - events newer than this are excluded server-side. */
    until?: string;
    /** Human-readable label used in the cache key (e.g. '1d', '1w', 'custom'). */
    timeRange?: string;
    /** Global search query. */
    query?: string;
    /** Sort mode for cache invalidation */
    sortMode?: string;
}



function snapBBox(b: BBox): BBox {
    const z = b.zoom || 5;
    // Larger grid at lower zooms reduces cache fragmentation while panning.
    const grid = z < 4 ? 20 : z < 7 ? 10 : z < 10 ? 5 : 2;
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
    if (b.query) {
        // If there's a global search query, the backend ignores BBox constraints.
        // The cache key should therefore ignore coordinates to maximize cache hits while panning.
        return [
            `q:${b.query}`,
            b.zoom !== undefined ? `z:${b.zoom.toFixed(1)}` : '',
            b.timeRange === 'custom' ? `tr:${b.timeRange},s:${b.since || ''},u:${b.until || ''}` : b.timeRange ? `tr:${b.timeRange}` : '',
            b.sortMode ? `sort:${b.sortMode}` : '',
            b.forceRaw ? 'raw' : '',
        ].filter(Boolean).join(',');
    }
    
    return [
        b.minLat.toFixed(4),
        b.maxLat.toFixed(4),
        b.minLng.toFixed(4),
        b.maxLng.toFixed(4),
        b.zoom !== undefined ? `z:${b.zoom.toFixed(1)}` : '',
        b.timeRange === 'custom' ? `tr:${b.timeRange},s:${b.since || ''},u:${b.until || ''}` : b.timeRange ? `tr:${b.timeRange}` : '',
        b.sortMode ? `sort:${b.sortMode}` : '',
        b.forceRaw ? 'raw' : '',
    ].filter(Boolean).join(',');
}

function isWithinBBox(item: NewsItem, bbox: BBox): boolean {
    if (bbox.query) {
        const q = bbox.query.toLowerCase();
        const matchesTitle = item.title.toLowerCase().includes(q);
        const matchesLoc = item.locationName?.toLowerCase().includes(q);
        return matchesTitle || !!matchesLoc;
    }

    if (item.latitude == null || item.longitude == null) return false;
    return (
        item.latitude >= bbox.minLat &&
        item.latitude <= bbox.maxLat &&
        item.longitude >= bbox.minLng &&
        item.longitude <= bbox.maxLng
    );
}

/** Convert a timeRange label or custom date to an ISO timestamp for server-side filtering. */
function computeSince(timeRange: string, customStartDate?: string): string | null {
    if (timeRange === 'custom') {
        return customStartDate ? new Date(customStartDate).toISOString() : null;
    }
    const now = Date.now();
    const ms: Record<string, number> = {
        '1d': 24 * 60 * 60 * 1000,
        '3d': 3 * 24 * 60 * 60 * 1000,
        '1w': 7 * 24 * 60 * 60 * 1000,
        '1m': 30 * 24 * 60 * 60 * 1000,
    };
    return ms[timeRange] ? new Date(now - ms[timeRange]).toISOString() : null;
}

function computeUntil(timeRange: string, customEndDate?: string): string | null {
    if (timeRange === 'custom' && customEndDate) {
        return new Date(customEndDate).toISOString();
    }
    return null;
}

/** 
 * Client-side jitter to prevent unclustered pins from stacking perfectly on top 
 * of each other, which hides them in MapLibre.
 */
function applyClientJitter(items: NewsItem[]): NewsItem[] {
    const usedCoords = new Map<string, number>();
    return items.map(item => {
        if (item.latitude == null || item.longitude == null) return item;
        // Don't jitter server-side clusters
        if (item.eventCount && item.eventCount > 1) return item;

        // Group points that are within ~111 meters of each other
        const coordKey = `${item.latitude.toFixed(3)},${item.longitude.toFixed(3)}`;
        const count = usedCoords.get(coordKey) || 0;
        usedCoords.set(coordKey, count + 1);

        if (count === 0) return item;

        // Golden-angle spiral
        const angle = (count * 137.5 * Math.PI) / 180;
        // Start at ~500m radius and expand
        const radius = 0.005 + (count * 0.002);
        
        return {
            ...item,
            latitude: item.latitude + radius * Math.cos(angle),
            longitude: item.longitude + radius * Math.sin(angle)
        };
    });
}

// Client-side cache: bbox+timeRange key - NewsItem array
const bboxCache = new Map<string, { bbox: BBox; data: NewsItem[]; timestamp: number }>();
const BBOX_CACHE_TTL = 10 * 60 * 1000; // 10 minutes

export function useNewsData({ includeUnmapped, timeRange, searchQuery, customStartDate, customEndDate, sortMode }: { includeUnmapped: boolean; timeRange: string; searchQuery?: string; customStartDate?: string; customEndDate?: string; sortMode?: string; }) {
    const [news, setNews] = useState<NewsItem[]>([]);
    const [globalHighlights, setGlobalHighlights] = useState<NewsItem[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [lastUpdated, setLastUpdated] = useState<string | null>(null);

    // Keep a synchronous ref of the current news items for callbacks
    const newsRef = useRef<NewsItem[]>([]);
    const globalHighlightsRef = useRef<NewsItem[]>([]);
    useEffect(() => { newsRef.current = news; }, [news]);
    useEffect(() => { globalHighlightsRef.current = globalHighlights; }, [globalHighlights]);

    // Track the current bounding box so Realtime can filter/refetch correctly
    const currentBBoxRef = useRef<BBox | null>(null);
    const timeRangeRef = useRef(timeRange);
    const searchQueryRef = useRef(searchQuery);
    const customStartDateRef = useRef(customStartDate);
    const customEndDateRef = useRef(customEndDate);
    const sortModeRef = useRef(sortMode);

    // Client-side description cache: id - description string
    const descriptionCache = useRef<Map<string, string>>(new Map());
    // Track in-flight description fetches to prevent race conditions
    const fetchingDetailsRef = useRef<Set<string>>(new Set());

    // -------------------------------------------------------------------------
    // Shared fetch logic (Internal)
    // -------------------------------------------------------------------------
    const _performFetch = useCallback(async (options: {
        isRefresh?: boolean;
        bbox?: BBox;
        isGlobal?: boolean;
        limit?: number;
    }) => {
        const { isRefresh, bbox, isGlobal, limit: requestedLimit } = options;
        const params = new URLSearchParams();
        
        if (isRefresh) params.append('refresh', 'true');
        if (includeUnmapped) params.append('include_unmapped', 'true');
        if (sortMode) params.append('sort', sortMode);

        if (bbox) {
            params.append('minLat', String(bbox.minLat));
            params.append('maxLat', String(bbox.maxLat));
            params.append('minLng', String(bbox.minLng));
            params.append('maxLng', String(bbox.maxLng));
            if (bbox.zoom !== undefined) params.append('zoom', String(bbox.zoom));
            if (bbox.forceRaw) params.append('force_raw', 'true');
            if (bbox.since) params.append('since', bbox.since);
            if (bbox.until) params.append('until', bbox.until);
            if (bbox.query) params.append('query', bbox.query);
        } else if (searchQuery) {
            params.append('query', searchQuery);
        } else {
            // No BBox and no search query? Use computeSince for general context
            const since = computeSince(timeRange, customStartDate);
            const until = computeUntil(timeRange, customEndDate);
            if (since) params.append('since', since);
            if (until) params.append('until', until);
        }

        if (requestedLimit) {
            params.append('limit', String(requestedLimit));
        }

        const res = await fetch(`/api/news?${params.toString()}`);
        if (!res.ok) throw new Error('Failed to fetch news');

        const data: NewsResponse = await res.json();
        
        // Apply jitter and merge cached descriptions
        const jittered = applyClientJitter(data.items);
        return jittered.map(item => {
            const cachedDesc = descriptionCache.current.get(item.id) || (item.originalId ? descriptionCache.current.get(item.originalId) : undefined);
            return cachedDesc ? { ...item, description: cachedDesc } : item;
        });
    }, [includeUnmapped, searchQuery, sortMode, timeRange, customStartDate, customEndDate]);

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
                const isServerCluster = bbox.zoom !== undefined && bbox.zoom < 5 && !bbox.forceRaw && !bbox.query;
                const highlightIds = new Set(globalHighlightsRef.current.map(h => h.id));
                
                if (isServerCluster) {
                    setNews(prev => {
                        const unmapped = prev.filter(p => p.latitude == null);
                        const map = new Map<string, NewsItem>();
                        
                        for (const item of cached.data) map.set(item.id, item);
                        for (const item of unmapped) map.set(item.id, item);
                        
                        const clusterOriginalIds = new Set(Array.from(map.values()).filter(p => p.originalId && p.id !== p.originalId).map(p => p.originalId));
                        for (const item of globalHighlightsRef.current) {
                            if (!clusterOriginalIds.has(item.id)) {
                                const cachedDesc = descriptionCache.current.get(item.id) || (item.originalId ? descriptionCache.current.get(item.originalId) : undefined);
                                map.set(item.id, cachedDesc ? { ...item, description: cachedDesc } : item);
                            }
                        }
                        
                        return Array.from(map.values());
                    });
                } else {
                    setNews(prev => {
                        const prevIndividuals = prev.filter(p => {
                            if (p.eventCount && p.eventCount > 1) return false;
                            if (p.latitude == null) return true; 
                            if (highlightIds.has(p.id)) return true;
                            return isWithinBBox(p, bbox);
                        });
                        const prevMap = new Map(prevIndividuals.map(p => [p.id, p]));

                        for (const item of cached.data) {
                            if (item.originalId && item.id !== item.originalId) {
                                prevMap.delete(item.originalId);
                            }
                            prevMap.set(item.id, item);
                        }

                        const clusterOriginalIds = new Set(Array.from(prevMap.values()).filter(p => p.originalId && p.id !== p.originalId).map(p => p.originalId));
                        for (const item of globalHighlightsRef.current) {
                            if (!clusterOriginalIds.has(item.id)) {
                                prevMap.set(item.id, item);
                            }
                        }

                        return Array.from(prevMap.values());
                    });
                }
                
                setIsLoading(false);
                return;
            }
        }

        try {
            const enriched = await _performFetch({ isRefresh, bbox });

            // Update client-side bbox cache
            if (bbox) {
                bboxCache.set(bboxKey(bbox), { bbox, data: enriched, timestamp: Date.now() });
            }

            const isServerCluster = bbox && bbox.zoom !== undefined && bbox.zoom < 5 && !bbox.forceRaw && !bbox.query;
            const highlightIds = new Set(globalHighlightsRef.current.map(h => h.id));

            if (isServerCluster) {
                setNews(prev => {
                    const unmapped = prev.filter(p => p.latitude == null);
                    const map = new Map<string, NewsItem>();
                    
                    for (const item of enriched) map.set(item.id, item);
                    for (const item of unmapped) map.set(item.id, item);
                    
                    const clusterOriginalIds = new Set<string>();
                    for (const [id, item] of map.entries()) {
                        if (item.originalId && item.id !== item.originalId) {
                            clusterOriginalIds.add(item.originalId);
                            const hotItem = globalHighlightsRef.current.find(gh => gh.id === item.originalId);
                            if (hotItem) {
                                const clusterTime = new Date(item.publishedAt).getTime();
                                const hotTime = new Date(hotItem.publishedAt).getTime();
                                map.set(id, {
                                    ...item,
                                    title: hotItem.title,
                                    description: hotItem.description || item.description,
                                    imageUrl: hotItem.imageUrl || item.imageUrl,
                                    source: hotItem.source,
                                    sourceType: hotItem.sourceType,
                                    credibilityTier: hotItem.credibilityTier,
                                    sources: hotItem.sources,
                                    publishedAt: hotTime > clusterTime ? hotItem.publishedAt : item.publishedAt,
                                });
                            }                        }
                    }

                    for (const item of globalHighlightsRef.current) {
                        if (!clusterOriginalIds.has(item.id)) {
                            const cachedDesc = descriptionCache.current.get(item.id) || (item.originalId ? descriptionCache.current.get(item.originalId) : undefined);
                            map.set(item.id, cachedDesc ? { ...item, description: cachedDesc } : item);
                        }
                    }
                    
                    return Array.from(map.values());
                });
            } else {
                setNews(prev => {
                    const prevIndividuals = prev.filter(p => {
                        if (p.eventCount && p.eventCount > 1) return false;
                        if (p.latitude == null) return true; 
                        if (highlightIds.has(p.id)) return true;
                        if (!bbox) return true;
                        return isWithinBBox(p, bbox);
                    });
                    const prevMap = new Map(prevIndividuals.map(p => [p.id, p]));

                    for (const item of enriched) {
                        if (item.originalId && item.id !== item.originalId) {
                            prevMap.delete(item.originalId);
                        }
                        prevMap.set(item.id, item);
                    }

                    const clusterOriginalIds = new Set(Array.from(prevMap.values()).filter(p => p.originalId && p.id !== p.originalId).map(p => p.originalId));
                    for (const item of globalHighlightsRef.current) {
                        if (!clusterOriginalIds.has(item.id)) {
                            prevMap.set(item.id, item);
                        }
                    }

                    return Array.from(prevMap.values());
                });
            }

            setLastUpdated(new Date().toISOString());
        } catch (err) {
            setError(err instanceof Error ? err.message : 'An error occurred');
        } finally {
            setIsLoading(false);
        }
    }, [_performFetch]);

    // -------------------------------------------------------------------------
    // Background Global Fetch - ensure Hot/New items are always available
    // -------------------------------------------------------------------------
    const fetchGlobalHighlights = useCallback(async (updateNews = true) => {
        try {
            const enriched = await _performFetch({ isGlobal: true, limit: 50 });

            setGlobalHighlights(enriched);
            globalHighlightsRef.current = enriched;
            
            if (updateNews) {
                setNews(prev => {
                    const prevMap = new Map(prev.map(p => [p.id, p]));
                    for (const item of enriched) {
                        prevMap.set(item.id, item);
                    }
                    return Array.from(prevMap.values());
                });
            }
            return enriched;
        } catch (err) {
            console.error('[useNewsData] Failed to fetch global highlights:', err);
            return [];
        }
    }, [_performFetch]);

    // -------------------------------------------------------------------------
    // Re-fetch when timeRange or searchQuery changes - invalidate cache and reload
    // -------------------------------------------------------------------------
    useEffect(() => {
        const prevTimeRange = timeRangeRef.current;
        const prevSearch = searchQueryRef.current;
        const prevStartDate = customStartDateRef.current;
        const prevEndDate = customEndDateRef.current;
        const prevSortMode = sortModeRef.current;

        timeRangeRef.current = timeRange;
        searchQueryRef.current = searchQuery;
        customStartDateRef.current = customStartDate;
        customEndDateRef.current = customEndDate;
        sortModeRef.current = sortMode;

        if (prevTimeRange === timeRange && prevSearch === searchQuery && prevStartDate === customStartDate && prevEndDate === customEndDate && prevSortMode === sortMode) return;

        // NEW: Coordinated load to prevent flickering.
        // Instead of triggering two independent updates, we wait for both and update ONCE.
        const coordinateLoad = async () => {
            setIsLoading(true);
            setError(null);
            
            // Invalidate cache
            bboxCache.clear();
            
            const currentBBox = currentBBoxRef.current;
            const since = computeSince(timeRange, customStartDate);
            const until = computeUntil(timeRange, customEndDate);
            const enrichedBBox = currentBBox ? { 
                ...currentBBox, 
                since: since ?? undefined, 
                until: until ?? undefined, 
                timeRange, 
                query: searchQuery, 
                sortMode 
            } : undefined;

            try {
                // Fetch both in parallel
                const [globalResults, bboxResults] = await Promise.all([
                    _performFetch({ isGlobal: true, limit: 50 }),
                    _performFetch({ bbox: enrichedBBox })
                ]);

                // Update global refs/state
                setGlobalHighlights(globalResults);
                globalHighlightsRef.current = globalResults;

                // Update main news list with the union of both
                const isServerCluster = enrichedBBox && enrichedBBox.zoom !== undefined && enrichedBBox.zoom < 5 && !enrichedBBox.forceRaw && !enrichedBBox.query;
                const map = new Map<string, NewsItem>();

                // Add BBox results first
                for (const item of bboxResults) map.set(item.id, item);
                
                const clusterOriginalIds = new Set<string>();
                for (const item of bboxResults) {
                    if (item.originalId && item.id !== item.originalId) {
                        clusterOriginalIds.add(item.originalId);
                        const hotItem = globalResults.find(gh => gh.id === item.originalId);
                        if (hotItem) {
                             // Enrich cluster with story metadata
                             const clusterTime = new Date(item.publishedAt).getTime();
                             const hotTime = new Date(hotItem.publishedAt).getTime();
                             map.set(item.id, {
                                ...item,
                                title: hotItem.title,
                                description: hotItem.description || item.description,
                                imageUrl: hotItem.imageUrl || item.imageUrl,
                                source: hotItem.source,
                                sourceType: hotItem.sourceType,
                                credibilityTier: hotItem.credibilityTier,
                                sources: hotItem.sources,
                                publishedAt: hotTime > clusterTime ? hotItem.publishedAt : item.publishedAt,
                             });
                        }
                    }
                }

                // Add Global highlights that aren't already represented by a cluster
                for (const item of globalResults) {
                    if (!clusterOriginalIds.has(item.id)) {
                        map.set(item.id, item);
                    }
                }

                setNews(Array.from(map.values()));
                setLastUpdated(new Date().toISOString());
            } catch (err) {
                setError(err instanceof Error ? err.message : 'An error occurred');
            } finally {
                setIsLoading(false);
            }
        };

        void coordinateLoad();
    }, [timeRange, searchQuery, customStartDate, customEndDate, sortMode, _performFetch]);

    // -------------------------------------------------------------------------
    // On-demand detail fetch (description lazy-load)
    // -------------------------------------------------------------------------
    const fetchEventDetails = useCallback(async (id: string) => {
        if (!id) return;
        if (descriptionCache.current.has(id)) return;
        if (fetchingDetailsRef.current.has(id)) return;

        fetchingDetailsRef.current.add(id);

        // Resolve the actual UUID to fetch from the DB. 
        // For clusters, the id is a hybrid string (e.g. cluster-z3...), 
        // so we must look up its original representative UUID.
        let fetchId = id;
        
        // Find the item synchronously to check for originalId
        const item = newsRef.current.find(i => i.id === id || i.originalId === id);
        if (item && item.originalId) {
            fetchId = item.originalId;
        } else {
            // Fallback to cache if not found in current view
            for (const entry of bboxCache.values()) {
                const cachedItem = entry.data.find(i => i.id === id || i.originalId === id);
                if (cachedItem && cachedItem.originalId) {
                    fetchId = cachedItem.originalId;
                    break;
                }
            }
        }

        try {
            const res = await fetch(`/api/news/${fetchId}`);
            if (!res.ok) return;
            const { description } = await res.json() as { description: string };

            descriptionCache.current.set(id, description);
            if (fetchId !== id) {
                descriptionCache.current.set(fetchId, description);
            }
            if (item && item.id !== id && item.id !== fetchId) {
                descriptionCache.current.set(item.id, description);
            }

            setNews(prev =>
                prev.map(p => (p.id === id || p.originalId === id || (item && p.id === item.id)) ? { ...p, description } : p)
            );

            setGlobalHighlights(prev =>
                prev.map(p => (p.id === id || p.originalId === id || (item && p.id === item.id)) ? { ...p, description } : p)
            );

            bboxCache.forEach((entry, key) => {
                const updated = entry.data.map(p =>
                    (p.id === id || p.originalId === id || (item && p.id === item.id)) ? { ...p, description } : p
                );
                bboxCache.set(key, { ...entry, data: updated });
            });
        } catch {
            // Silently fail - the card will just show no description
        } finally {
            fetchingDetailsRef.current.delete(id);
        }
    }, []);

    // -------------------------------------------------------------------------
    // Bounding-box change handler (called from NewsMap via page.tsx)
    // Injects the current since timestamp so the server filters by time.
    // -------------------------------------------------------------------------
    const onBoundsChange = useCallback((bbox: BBox) => {
        const since = computeSince(timeRangeRef.current, customStartDateRef.current);
        const until = computeUntil(timeRangeRef.current, customEndDateRef.current);
        const enrichedBBox: BBox = {
            ...bbox,
            since: since ?? undefined,
            until: until ?? undefined,
            timeRange: timeRangeRef.current,
            query: searchQueryRef.current,
            sortMode: sortModeRef.current,
        };
        currentBBoxRef.current = enrichedBBox;
        fetchNews(false, enrichedBBox);
    }, [fetchNews]);

    // -------------------------------------------------------------------------
    // Supabase Realtime - INSERT subscription
    // -------------------------------------------------------------------------
    useEffect(() => {
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
                        const prevIds = new Set(prev.map(p => p.id));
                        if (prevIds.has(newItem.id)) return prev;
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
    // Initial fetch
    // -------------------------------------------------------------------------
    useEffect(() => {
        // Only fetch immediately if we are including unmapped items (which won't be caught by a BBox fetch)
        // or if we have a search query (which bypasses BBox).
        // Otherwise, we wait for the map to trigger onBoundsChange to avoid redundant double-fetching
        // and the "cluster-flicker" on initial load.
        if (includeUnmapped || searchQuery) {
            void Promise.resolve().then(() => {
                fetchNews();
            });
        }
    }, [fetchNews, includeUnmapped, searchQuery]);

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
