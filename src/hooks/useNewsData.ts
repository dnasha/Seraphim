'use client';

/*
useNewsData hook manages fetching/caching/merging of news events.
It keeps a persistent client entity store to avoid dropping items on bbox changes.
*/

import { useState, useEffect, useCallback, useRef } from 'react';
import { NewsItem, NewsResponse } from '@/lib/types';
import { supabase } from '@/lib/supabase';
import { BBox, snapBBox, isWithinBBox } from '@/lib/geo';
import { normalizeSortMode, sortNewsItems } from '@/lib/ranking';

const CLUSTER_ZOOM_THRESHOLD = 5;
const LOCAL_RESPONSE_TTL_MS = 60_000;
const MAX_ENTITY_COUNT = 5000;

const responseCache = new Map<string, { data: NewsItem[]; isCapped: boolean; timestamp: number }>();
const inFlightFetches = new Map<string, Promise<{ items: NewsItem[]; isCapped: boolean }>>();

function computeSince(timeRange: string, customStartDate?: string): string | null {
    if (timeRange === 'custom') return customStartDate ? new Date(customStartDate).toISOString() : null;
    const ms: Record<string, number> = { '1d': 86400000, '3d': 259200000, '1w': 604800000, '1m': 2592000000 };
    return ms[timeRange] ? new Date(Date.now() - ms[timeRange]).toISOString() : null;
}

function computeUntil(timeRange: string, customEndDate?: string): string | null {
    return (timeRange === 'custom' && customEndDate) ? new Date(customEndDate).toISOString() : null;
}

function mergeNewsItem(existing: NewsItem | undefined, incoming: NewsItem): NewsItem {
    if (!existing) return incoming;
    
    // Reporting strength is strictly based on actual sources (event_count or sources array length)
    // We explicitly prefer the highest known source count to prevent "hot" stories from being 
    // downgraded by partial or newer raw updates that haven't been aggregated in the DB yet.
    const raw = incoming as unknown as Record<string, unknown>;
    const sCount = Number(
        incoming.sourcesCount ?? 
        raw.sourceCount ?? 
        raw.event_count ?? 
        raw.source_count ?? 
        raw.eventCount ?? 
        0
    );

    const sourcesCount = Math.max(
        Number(existing.sourcesCount) || 0,
        sCount
    );

    const impactScore = Math.max(
        Number(existing.impactScore) || 0,
        Number(incoming.impactScore) || 0
    );

    return {
        ...existing,
        ...incoming,
        sourcesCount: sourcesCount > 0 ? sourcesCount : undefined,
        impactScore: impactScore > 0 ? impactScore : undefined,
        description: incoming.description ?? existing.description,
        sources: incoming.sources ?? existing.sources,
        originalId: incoming.originalId ?? existing.originalId,
        isTopHot: incoming.isTopHot || existing.isTopHot,
    };
}

export function useNewsData({
    unmappedOnly,
    timeRange,
    searchQuery,
    customStartDate,
    customEndDate,
    sortMode
}: {
    unmappedOnly: boolean;
    timeRange: string;
    searchQuery?: string;
    customStartDate?: string;
    customEndDate?: string;
    sortMode?: string;
}) {
    const [news, setNews] = useState<NewsItem[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [lastUpdated, setLastUpdated] = useState<string | null>(null);
    const [isCapped, setIsCapped] = useState(false);

    const newsRef = useRef<NewsItem[]>([]);
    const lastFetchParamsRef = useRef<{
        bbox: BBox | null;
        sortMode?: string;
        query?: string;
        timeRange?: string;
    } | null>(null);
    const isFirstMount = useRef(true);

    const detailCache = useRef<Map<string, { description: string; sources: NewsItem['sources'] }>>(new Map());
    const fetchingDetailsRef = useRef<Set<string>>(new Set());

    const entitiesRef = useRef<Map<string, NewsItem>>(new Map());
    const entityTouchedAtRef = useRef<Map<string, number>>(new Map());
    const visibleMapIdsRef = useRef<Set<string>>(new Set());
    const visibleSidebarIdsRef = useRef<Set<string>>(new Set());
    const requestVersionRef = useRef(0);
    const abortControllerRef = useRef<AbortController | null>(null);

    const [appliedSortMode, setAppliedSortMode] = useState<string>(sortMode || 'new');

    const syncNewsFromStore = useCallback((mode: string | undefined) => {
        const normalizedMode = normalizeSortMode(mode);
        
        // Filter the persistent store down to only the items intended for the current view.
        // This prevents the sidebar from 'bloating' with items from previous pans/zooms
        // while allowing the store to keep them cached for performance.
        const activeItems = Array.from(entitiesRef.current.values())
            .filter(item => {
                const key = item.originalId || item.id;
                return visibleMapIdsRef.current.has(key) || visibleMapIdsRef.current.has(item.id);
            });

        setNews(sortNewsItems(activeItems, normalizedMode));
        setAppliedSortMode(normalizedMode);
    }, []);

    const pruneEntityStore = useCallback(() => {
        const store = entitiesRef.current;
        if (store.size <= MAX_ENTITY_COUNT) return;

        const protectedIds = new Set<string>([
            ...visibleMapIdsRef.current,
            ...visibleSidebarIdsRef.current,
        ]);

        const candidates = Array.from(store.keys())
            .filter((id) => !protectedIds.has(id))
            .map((id) => ({ id, touchedAt: entityTouchedAtRef.current.get(id) ?? 0 }))
            .sort((a, b) => a.touchedAt - b.touchedAt);

        for (const candidate of candidates) {
            if (store.size <= MAX_ENTITY_COUNT) break;
            store.delete(candidate.id);
            entityTouchedAtRef.current.delete(candidate.id);
        }
    }, []);

    const mergeItemsIntoStore = useCallback((items: NewsItem[]) => {
        const now = Date.now();

        for (const item of items) {
            // Use canonical key (representative UUID) for deduplication
            const key = item.originalId || item.id;
            const existing = entitiesRef.current.get(key);
            
            const merged = mergeNewsItem(existing, item);
            
            // Hydrate from detail cache if available
            const cached = detailCache.current.get(key);
            if (cached) {
                merged.description = cached.description;
                merged.sources = cached.sources;
            }

            entitiesRef.current.set(key, merged);
            entityTouchedAtRef.current.set(key, now);
        }

        // Evict stale items...
        for (const key of entitiesRef.current.keys()) {
            if (key.startsWith('cluster-') && !visibleMapIdsRef.current.has(key)) {
                entitiesRef.current.delete(key);
                entityTouchedAtRef.current.delete(key);
            }
        }

        pruneEntityStore();
    }, [pruneEntityStore]);

    useEffect(() => { newsRef.current = news; }, [news]);

    const _performFetch = useCallback(async (options: {
        isRefresh?: boolean;
        bbox?: BBox;
        limit?: number;
        signal?: AbortSignal;
        view?: 'map' | 'sidebar';
        scope?: 'viewport' | 'global';
        globalTopN?: number;
    }) => {
        const { isRefresh, bbox, limit: requestedLimit, signal, view = 'map', scope = 'viewport', globalTopN } = options;
        const params = new URLSearchParams();
        if (isRefresh) params.append('refresh', 'true');
        if (unmappedOnly) params.append('unmapped_only', 'true');
        if (sortMode) params.append('sort', sortMode);
        params.append('view', view);
        params.append('scope', scope);
        if (globalTopN) params.append('global_top_n', String(globalTopN));

        if (bbox && !unmappedOnly) {
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

        const requestKey = params.toString();
        const now = Date.now();
        const cached = responseCache.get(requestKey);
        if (!isRefresh && cached && (now - cached.timestamp) < LOCAL_RESPONSE_TTL_MS) {
            return {
                items: cached.data.map(item => {
                    const cacheKey = item.originalId || item.id;
                    const cachedDetail = detailCache.current.get(cacheKey);
                    return cachedDetail ? { ...item, ...cachedDetail } : item;
                }),
                isCapped: cached.isCapped
            };
        }

        const existingInFlight = inFlightFetches.get(requestKey);
        if (existingInFlight) return existingInFlight;

        const fetchPromise = (async () => {
            const res = await fetch(`/api/news?${params.toString()}`, { signal });
            if (!res.ok) throw new Error('Failed to fetch news');
            const data: NewsResponse = await res.json();
            const hydrated = data.items.map(item => {
                const cacheKey = item.originalId || item.id;
                const cachedDetail = detailCache.current.get(cacheKey);
                return cachedDetail ? { ...item, ...cachedDetail } : item;
            });
            const apiCapped = data.meta?.isCapped || false;
            const totalStories = hydrated.reduce((acc, item) => acc + (item.storyCount || 1), 0);
            const isCapped = apiCapped || hydrated.length >= 1990 || totalStories >= 1990;
            responseCache.set(requestKey, { data: hydrated, isCapped, timestamp: Date.now() });
            return { items: hydrated, isCapped };
        })();

        inFlightFetches.set(requestKey, fetchPromise);
        try {
            return await fetchPromise;
        } finally {
            inFlightFetches.delete(requestKey);
        }
    }, [unmappedOnly, searchQuery, sortMode, timeRange, customStartDate, customEndDate]);

    const coordinateLoad = useCallback(async (isRefresh = false, rawBBox?: BBox) => {
        const requestVersion = ++requestVersionRef.current;
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
        }

        const abortController = new AbortController();
        abortControllerRef.current = abortController;
        setError(null);

        if (isRefresh) {
            responseCache.clear();
            detailCache.current.clear(); // Full refresh clears detail cache too
        }

        const bbox = rawBBox ? snapBBox(rawBBox) : (lastFetchParamsRef.current?.bbox ?? null);

        // Performance optimization: If the snapped BBox AND all filters (sort, query, time) 
        // haven't changed since the LAST FETCH, skip entirely.
        const prev = lastFetchParamsRef.current;
        const isSameBBox = (!bbox && !prev?.bbox) || (
            bbox && prev?.bbox &&
            bbox.minLat === prev.bbox.minLat &&
            bbox.maxLat === prev.bbox.maxLat &&
            bbox.minLng === prev.bbox.minLng &&
            bbox.maxLng === prev.bbox.maxLng &&
            bbox.zoom === prev.bbox.zoom
        );

        if (!isRefresh && prev && isSameBBox &&
            sortMode === prev.sortMode &&
            searchQuery === prev.query &&
            timeRange === prev.timeRange) {
            return;
        }

        const since = computeSince(timeRange, customStartDate);
        const until = computeUntil(timeRange, customEndDate);
        const enrichedBBox = bbox ? {
            ...bbox,
            since: since ?? undefined,
            until: until ?? undefined,
            timeRange,
            query: searchQuery,
            sortMode
        } : undefined;

        // Construct the cache key
        const params = new URLSearchParams();
        if (unmappedOnly) params.append('unmapped_only', 'true');
        if (sortMode) params.append('sort', sortMode);
        params.append('view', 'map');
        params.append('scope', 'viewport');
        if (enrichedBBox) {
            params.append('minLat', String(enrichedBBox.minLat));
            params.append('maxLat', String(enrichedBBox.maxLat));
            params.append('minLng', String(enrichedBBox.minLng));
            params.append('maxLng', String(enrichedBBox.maxLng));
            if (enrichedBBox.zoom !== undefined) params.append('zoom', String(enrichedBBox.zoom));
            if (enrichedBBox.query) params.append('query', enrichedBBox.query);
            if (enrichedBBox.since) params.append('since', enrichedBBox.since);
            if (enrichedBBox.until) params.append('until', enrichedBBox.until);
        } else {
            if (since) params.append('since', since);
            if (until) params.append('until', until);
            if (searchQuery) params.append('query', searchQuery);
        }
        const requestKey = params.toString();
        const now = Date.now();
        const cached = responseCache.get(requestKey);

        // Cache hit path: If we have fresh data for this specific snapped BBox,
        // just update visibility and sync without clearing the global store.
        if (!isRefresh && cached && (now - cached.timestamp) < LOCAL_RESPONSE_TTL_MS) {
            const visibleIds = new Set(cached.data.map(item => item.originalId || item.id));
            visibleMapIdsRef.current = visibleIds;
            visibleSidebarIdsRef.current = new Set(visibleIds);

            mergeItemsIntoStore(cached.data);
            syncNewsFromStore(sortMode);
            setIsCapped(cached.isCapped);
            setIsLoading(false);
            setLastUpdated(new Date(cached.timestamp).toISOString());
            lastFetchParamsRef.current = {
                bbox,
                sortMode,
                query: searchQuery,
                timeRange
            };
            return;
        }

        setIsLoading(true);
        try {
            const { items: mapResults, isCapped: resultCapped } = await _performFetch({
                isRefresh,
                bbox: enrichedBBox,
                signal: abortController.signal,
                view: 'map',
                scope: 'viewport'
            });

            if (requestVersion !== requestVersionRef.current) return;

            // Update the visibility set before syncing the store
            const visibleIds = new Set(mapResults.map(item => item.originalId || item.id));
            visibleMapIdsRef.current = visibleIds;
            visibleSidebarIdsRef.current = new Set(visibleIds);

            mergeItemsIntoStore(mapResults);
            syncNewsFromStore(sortMode);
            setIsCapped(resultCapped);
            setLastUpdated(new Date().toISOString());
            lastFetchParamsRef.current = {
                bbox,
                sortMode,
                query: searchQuery,
                timeRange
            };
        } catch (err) {
            if (err instanceof Error && err.name === 'AbortError') return;
            if (requestVersion !== requestVersionRef.current) return;
            setError(err instanceof Error ? err.message : 'An error occurred');
        } finally {
            if (requestVersion === requestVersionRef.current) {
                setIsLoading(false);
            }
        }
    }, [timeRange, searchQuery, customStartDate, customEndDate, sortMode, unmappedOnly, _performFetch, mergeItemsIntoStore, syncNewsFromStore]);

    useEffect(() => {
        if (isFirstMount.current) {
            isFirstMount.current = false;
            const timer = setTimeout(() => coordinateLoad(), 0);
            return () => clearTimeout(timer);
        }
        
        coordinateLoad();
    }, [timeRange, searchQuery, customStartDate, customEndDate, sortMode, coordinateLoad]);

    const fetchEventDetails = useCallback(async (id: string) => {
        if (!id || fetchingDetailsRef.current.has(id)) return;
        
        let targetId = id;
        // Skip UUIDs that are obviously client-side or server-side hybrid cluster IDs.
        if (id.startsWith('cluster-')) {
            const item = newsRef.current.find(i => i.id === id);
            if (item?.originalId) {
                targetId = item.originalId;
            } else {
                return;
            }
        }

        const existingDetail = detailCache.current.get(targetId);
        if (existingDetail) return;

        fetchingDetailsRef.current.add(targetId);

        try {
            console.log(`[useNewsData] Fetching details for ${targetId}`);
            const res = await fetch(`/api/news/${targetId}`);
            if (!res.ok) {
                console.error(`[useNewsData] Failed to fetch details for ${targetId}: ${res.status} ${res.statusText}`);
                return;
            }
            const { description, sources } = await res.json() as { description?: string; sources?: Array<{ name: string; url: string; source_type: string; discovered_at: string }>; };
            const descriptionValue = typeof description === 'string' ? description : '';
            const mappedSources = Array.isArray(sources)
                ? sources.map((s) => ({
                    name: s.name,
                    url: s.url,
                    sourceType: s.source_type,
                    discoveredAt: s.discovered_at,
                }))
                : undefined;
            
            detailCache.current.set(targetId, { description: descriptionValue, sources: mappedSources });

            let changed = false;
            for (const [entityId, entity] of entitiesRef.current.entries()) {
                if (
                    entity.id === targetId ||
                    entity.originalId === targetId
                ) {
                    entitiesRef.current.set(entityId, {
                        ...entity,
                        description: descriptionValue,
                        sources: mappedSources ?? entity.sources,
                    });
                    entityTouchedAtRef.current.set(entityId, Date.now());
                    changed = true;
                }
            }
            if (changed) syncNewsFromStore(sortMode);
        } catch (err) {
            console.error(`[useNewsData] Error fetching event details for ${targetId}:`, err);
        } finally {
            fetchingDetailsRef.current.delete(targetId);
        }
    }, [sortMode, syncNewsFromStore]);

    const onBoundsChange = useCallback((bbox: BBox) => {
        coordinateLoad(false, bbox);
    }, [coordinateLoad]);

    useEffect(() => {
        const channel = supabase
            .channel('events-inserts')
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'events' }, (payload) => {
                const row = payload.new as unknown as Record<string, unknown>;
                const newItem: NewsItem = {
                    id: String(row.id),
                    title: String(row.title),
                    url: String(row.url),
                    source: String(row.source),
                    sourceType: (row.source_type as 'gnews' | 'rss' | 'social') || 'rss',
                    category: String(row.category),
                    publishedAt: String(row.published_at),
                    imageUrl: row.image_url ? String(row.image_url) : undefined,
                    latitude: typeof row.latitude === 'number' ? row.latitude : undefined,
                    longitude: typeof row.longitude === 'number' ? row.longitude : undefined,
                    locationName: row.location_name ? String(row.location_name) : undefined,
                    tags: Array.isArray(row.tags) ? row.tags : undefined,
                    impactScore: typeof row.impact_score === 'number' ? row.impact_score : (typeof row.impactScore === 'number' ? row.impactScore : undefined),
                    sourcesCount: typeof row.event_count === 'number' ? row.event_count : (typeof row.source_count === 'number' ? row.source_count : (typeof row.sourceCount === 'number' ? row.sourceCount : undefined))
                };

                const bbox = lastFetchParamsRef.current?.bbox;
                const isGlobalSidebarView = !!bbox && bbox.zoom !== undefined && bbox.zoom < CLUSTER_ZOOM_THRESHOLD;
                if (!isGlobalSidebarView && bbox && !isWithinBBox(newItem, bbox)) return;

                mergeItemsIntoStore([newItem]);
                syncNewsFromStore(sortMode);
            })
            .subscribe();
        return () => { supabase.removeChannel(channel); };
    }, [mergeItemsIntoStore, sortMode, syncNewsFromStore]);

    return { news, appliedSortMode, isLoading, isCapped, error, lastUpdated, fetchNews: coordinateLoad, onBoundsChange, fetchEventDetails };
}
