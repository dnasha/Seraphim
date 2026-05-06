'use client';

/*
useNewsData hook manages the fetching and caching of news events.
It handles bounding box snap logic and integrates with Supabase Realtime.
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
    since?: string;
    until?: string;
    timeRange?: string;
    query?: string;
    sortMode?: string;
}

function snapBBox(b: BBox): BBox {
    const z = b.zoom || 5;
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


export function isWithinBBox(item: NewsItem, bbox: BBox): boolean {
    if (bbox.query) {
        const q = bbox.query.toLowerCase();
        return item.title.toLowerCase().includes(q) || !!item.locationName?.toLowerCase().includes(q);
    }
    if (item.latitude == null || item.longitude == null) return false;
    // Handle antimeridian crossing if necessary, though snapBBox usually keeps it simple
    if (bbox.minLng > bbox.maxLng) {
        return (item.latitude >= bbox.minLat && item.latitude <= bbox.maxLat) &&
               (item.longitude >= bbox.minLng || item.longitude <= bbox.maxLng);
    }
    return (item.latitude >= bbox.minLat && item.latitude <= bbox.maxLat && item.longitude >= bbox.minLng && item.longitude <= bbox.maxLng);
}

function computeSince(timeRange: string, customStartDate?: string): string | null {
    if (timeRange === 'custom') return customStartDate ? new Date(customStartDate).toISOString() : null;
    const ms: Record<string, number> = { '1d': 86400000, '3d': 259200000, '1w': 604800000, '1m': 2592000000 };
    return ms[timeRange] ? new Date(Date.now() - ms[timeRange]).toISOString() : null;
}

function computeUntil(timeRange: string, customEndDate?: string): string | null {
    return (timeRange === 'custom' && customEndDate) ? new Date(customEndDate).toISOString() : null;
}

function sortNewsItems(items: NewsItem[], mode: string | undefined): NewsItem[] {
    return [...items].sort((a, b) => {
        if (mode === 'hot') {
            // Primary: Impact Score
            const scoreA = a.impactScore || 0;
            const scoreB = b.impactScore || 0;
            if (scoreB !== scoreA) return scoreB - scoreA;

            // Secondary: Event Count
            const countA = Math.max(Number(a.eventCount) || 0, a.sources?.length || 0, 1);
            const countB = Math.max(Number(b.eventCount) || 0, b.sources?.length || 0, 1);
            if (countB !== countA) return countB - countA;
        }
        // Tertiary: Recency (Fallback for Hot, Primary for New)
        return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
    });
}

const bboxCache = new Map<string, { bbox: BBox; data: NewsItem[]; timestamp: number }>();

export function useNewsData({ includeUnmapped, timeRange, searchQuery, customStartDate, customEndDate, sortMode }: { includeUnmapped: boolean; timeRange: string; searchQuery?: string; customStartDate?: string; customEndDate?: string; sortMode?: string; }) {
    const [news, setNews] = useState<NewsItem[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [lastUpdated, setLastUpdated] = useState<string | null>(null);

    const newsRef = useRef<NewsItem[]>([]);
    const globalHighlightsRef = useRef<NewsItem[]>([]);
    const currentBBoxRef = useRef<BBox | null>(null);
    const isFirstMount = useRef(true);

    const descriptionCache = useRef<Map<string, string>>(new Map());
    const fetchingDetailsRef = useRef<Set<string>>(new Set());

    useEffect(() => { newsRef.current = news; }, [news]);

    const _performFetch = useCallback(async (options: { isRefresh?: boolean; bbox?: BBox; isGlobal?: boolean; limit?: number; signal?: AbortSignal }) => {
        const { isRefresh, bbox, limit: requestedLimit, signal } = options;
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
        } else {
            const since = computeSince(timeRange, customStartDate);
            const until = computeUntil(timeRange, customEndDate);
            if (since) params.append('since', since);
            if (until) params.append('until', until);
            if (searchQuery) params.append('query', searchQuery);
        }

        if (requestedLimit) params.append('limit', String(requestedLimit));
        const res = await fetch(`/api/news?${params.toString()}`, { signal });
        if (!res.ok) throw new Error('Failed to fetch news');
        const data: NewsResponse = await res.json();
        return data.items.map(item => {
            const cachedDesc = descriptionCache.current.get(item.id) || (item.originalId ? descriptionCache.current.get(item.originalId) : undefined);
            return cachedDesc ? { ...item, description: cachedDesc } : item;
        });
    }, [includeUnmapped, searchQuery, sortMode, timeRange, customStartDate, customEndDate]);

    const abortControllerRef = useRef<AbortController | null>(null);

    const coordinateLoad = useCallback(async (isRefresh = false, rawBBox?: BBox) => {
        // Cancel any pending fetch
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
        }
        const abortController = new AbortController();
        abortControllerRef.current = abortController;

        setIsLoading(true);
        setError(null);
        if (isRefresh) bboxCache.clear();

        const bbox = rawBBox ? snapBBox(rawBBox) : currentBBoxRef.current;
        const since = computeSince(timeRange, customStartDate);
        const until = computeUntil(timeRange, customEndDate);
        const enrichedBBox = bbox ? { ...bbox, since: since ?? undefined, until: until ?? undefined, timeRange, query: searchQuery, sortMode } : undefined;

        try {
            // Coordinated parallel fetch: 1 Global Highlights + 1 BBox/Local
            const [globalResults, bboxResults] = await Promise.all([
                _performFetch({ isGlobal: true, limit: 100, signal: abortController.signal }),
                _performFetch({ isRefresh, bbox: enrichedBBox, signal: abortController.signal })
            ]);

            globalHighlightsRef.current = globalResults;
            const map = new Map<string, NewsItem>();
            const seenOriginalIds = new Set<string>();
            
            // Priority 1: BBox results (Local/Visible)
            for (const item of bboxResults) {
                map.set(item.id, item);
                if (item.originalId) seenOriginalIds.add(item.originalId);
                else seenOriginalIds.add(item.id);
            }
            
            // Enrich clusters with story metadata from global highlights if available
            for (const item of bboxResults) {
                if (item.originalId && item.id !== item.originalId) {
                    const hotItem = globalResults.find(gh => gh.id === item.originalId);
                    if (hotItem) {
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
                             publishedAt: hotTime > clusterTime ? hotItem.publishedAt : item.publishedAt 
                         });
                    }
                }
            }
            
            // Priority 2: Global highlights (not in bbox)
            for (const item of globalResults) {
                // If this story is already represented by a cluster or individual pin in the bbox, skip it
                if (!seenOriginalIds.has(item.id)) {
                    map.set(item.id, item);
                }
            }

            setNews(sortNewsItems(Array.from(map.values()), sortMode));
            setLastUpdated(new Date().toISOString());
        } catch (err) {
            if (err instanceof Error && err.name === 'AbortError') return;
            setError(err instanceof Error ? err.message : 'An error occurred');
        } finally {
            if (abortControllerRef.current === abortController) {
                setIsLoading(false);
            }
        }
    }, [timeRange, searchQuery, customStartDate, customEndDate, sortMode, _performFetch]);

    useEffect(() => {
        if (isFirstMount.current) {
            isFirstMount.current = false;
            // Only trigger on mount if we're not waiting for map bounds
            if (includeUnmapped || searchQuery) {
                // Use a timeout to avoid synchronous setState during effect
                const timer = setTimeout(() => coordinateLoad(), 0);
                return () => clearTimeout(timer);
            }
            return;
        }
        coordinateLoad();
    }, [timeRange, searchQuery, customStartDate, customEndDate, sortMode, coordinateLoad, includeUnmapped]);

    const fetchEventDetails = useCallback(async (id: string) => {
        if (!id || descriptionCache.current.has(id) || fetchingDetailsRef.current.has(id)) return;
        fetchingDetailsRef.current.add(id);
        let fetchId = id;
        const item = newsRef.current.find(i => i.id === id || i.originalId === id);
        if (item && item.originalId) fetchId = item.originalId;
        try {
            const res = await fetch(`/api/news/${fetchId}`);
            if (!res.ok) return;
            const { description } = await res.json();
            descriptionCache.current.set(id, description);
            if (fetchId !== id) descriptionCache.current.set(fetchId, description);
            setNews(prev => prev.map(p => (p.id === id || p.originalId === id) ? { ...p, description } : p));
        } catch { /* ignore */ } finally { fetchingDetailsRef.current.delete(id); }
    }, []);

    const onBoundsChange = useCallback((bbox: BBox) => {
        currentBBoxRef.current = bbox;
        coordinateLoad(false, bbox);
    }, [coordinateLoad]);

    useEffect(() => {
        const channel = supabase.channel('events-inserts').on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'events' }, (payload) => {
            const row = payload.new as Record<string, unknown>;
            const newItem: NewsItem = { 
                id: String(row.id), 
                title: String(row.title), 
                url: String(row.url), 
                source: String(row.source), 
                sourceType: (row.source_type as 'gnews'|'rss'|'social') || 'rss', 
                category: String(row.category), 
                publishedAt: String(row.published_at), 
                imageUrl: row.image_url ? String(row.image_url) : undefined, 
                latitude: typeof row.latitude === 'number' ? row.latitude : undefined, 
                longitude: typeof row.longitude === 'number' ? row.longitude : undefined, 
                locationName: row.location_name ? String(row.location_name) : undefined, 
                tags: Array.isArray(row.tags) ? row.tags : undefined,
                impactScore: typeof row.impact_score === 'number' ? row.impact_score : undefined,
                eventCount: typeof row.event_count === 'number' ? row.event_count : undefined
            };
            const bbox = currentBBoxRef.current;
            if (bbox && !isWithinBBox(newItem, bbox)) return;
            setNews(prev => {
                if (prev.some(p => p.id === newItem.id)) return prev;
                return sortNewsItems([newItem, ...prev], sortMode);
            });
        }).subscribe();
        return () => { supabase.removeChannel(channel); };
    }, [sortMode]);

    return { news, isLoading, error, lastUpdated, fetchNews: coordinateLoad, onBoundsChange, fetchEventDetails };
}
