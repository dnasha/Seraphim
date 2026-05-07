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

const responseCache = new Map<string, { data: NewsItem[]; timestamp: number }>();
const inFlightFetches = new Map<string, Promise<NewsItem[]>>();

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
    return {
        ...existing,
        ...incoming,
        description: incoming.description ?? existing.description,
        sources: incoming.sources ?? existing.sources,
        originalId: incoming.originalId ?? existing.originalId,
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

    const newsRef = useRef<NewsItem[]>([]);
    const currentBBoxRef = useRef<BBox | null>(null);
    const isFirstMount = useRef(true);

    const descriptionCache = useRef<Map<string, string>>(new Map());
    const fetchingDetailsRef = useRef<Set<string>>(new Set());

    const entitiesRef = useRef<Map<string, NewsItem>>(new Map());
    const entityTouchedAtRef = useRef<Map<string, number>>(new Map());
    const visibleMapIdsRef = useRef<Set<string>>(new Set());
    const visibleSidebarIdsRef = useRef<Set<string>>(new Set());
    const requestVersionRef = useRef(0);
    const abortControllerRef = useRef<AbortController | null>(null);

    const syncNewsFromStore = useCallback((mode: string | undefined) => {
        const normalizedMode = normalizeSortMode(mode);
        setNews(sortNewsItems(Array.from(entitiesRef.current.values()), normalizedMode));
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
            const existing = entitiesRef.current.get(item.id);
            const merged = mergeNewsItem(existing, item);
            entitiesRef.current.set(item.id, merged);
            entityTouchedAtRef.current.set(item.id, now);
        }

        // Evict stale server-side clusters that are no longer in the current viewport/zoom
        // to prevent inflation of totalStoryCount and overlapping map markers.
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
            return cached.data.map(item => {
                const cachedDesc = descriptionCache.current.get(item.id) || (item.originalId ? descriptionCache.current.get(item.originalId) : undefined);
                return cachedDesc ? { ...item, description: cachedDesc } : item;
            });
        }

        const existingInFlight = inFlightFetches.get(requestKey);
        if (existingInFlight) return existingInFlight;

        const fetchPromise = (async () => {
            const res = await fetch(`/api/news?${params.toString()}`, { signal });
            if (!res.ok) throw new Error('Failed to fetch news');
            const data: NewsResponse = await res.json();
            const hydrated = data.items.map(item => {
                const cachedDesc = descriptionCache.current.get(item.id) || (item.originalId ? descriptionCache.current.get(item.originalId) : undefined);
                return cachedDesc ? { ...item, description: cachedDesc } : item;
            });
            responseCache.set(requestKey, { data: hydrated, timestamp: Date.now() });
            return hydrated;
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
        setIsLoading(true);
        setError(null);

        if (isRefresh) {
            responseCache.clear();
        }

        const bbox = rawBBox ? snapBBox(rawBBox) : currentBBoxRef.current;
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

        try {
            const mapPromise = _performFetch({
                isRefresh,
                bbox: enrichedBBox,
                signal: abortController.signal,
                view: 'map',
                scope: 'viewport'
            });

            const mapResults = await mapPromise;

            if (requestVersion !== requestVersionRef.current) return;

            visibleMapIdsRef.current = new Set(mapResults.map(item => item.id));
            visibleSidebarIdsRef.current = new Set(mapResults.map(item => item.id));

            mergeItemsIntoStore(mapResults);
            syncNewsFromStore(sortMode);
            setLastUpdated(new Date().toISOString());
        } catch (err) {
            if (err instanceof Error && err.name === 'AbortError') return;
            if (requestVersion !== requestVersionRef.current) return;
            setError(err instanceof Error ? err.message : 'An error occurred');
        } finally {
            if (requestVersion === requestVersionRef.current) {
                setIsLoading(false);
            }
        }
    }, [timeRange, searchQuery, customStartDate, customEndDate, sortMode, _performFetch, mergeItemsIntoStore, syncNewsFromStore]);

    useEffect(() => {
        if (isFirstMount.current) {
            isFirstMount.current = false;
            const timer = setTimeout(() => coordinateLoad(), 0);
            return () => clearTimeout(timer);
        }
        coordinateLoad();
    }, [timeRange, searchQuery, customStartDate, customEndDate, sortMode, coordinateLoad]);

    const fetchEventDetails = useCallback(async (id: string) => {
        if (!id || descriptionCache.current.has(id) || fetchingDetailsRef.current.has(id)) return;
        fetchingDetailsRef.current.add(id);
        let fetchId = id;
        const item = newsRef.current.find(i => i.id === id || i.originalId === id);
        if (item && item.originalId) fetchId = item.originalId;

        try {
            const res = await fetch(`/api/news/${fetchId}`);
            if (!res.ok) return;
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
            descriptionCache.current.set(id, descriptionValue);
            if (fetchId !== id) descriptionCache.current.set(fetchId, descriptionValue);

            let changed = false;
            for (const [entityId, entity] of entitiesRef.current.entries()) {
                if (
                    entity.id === id ||
                    entity.originalId === id ||
                    entity.id === fetchId ||
                    entity.originalId === fetchId
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
            console.error('[useNewsData] Failed to fetch event details:', err);
        } finally {
            fetchingDetailsRef.current.delete(id);
        }
    }, [sortMode, syncNewsFromStore]);

    const onBoundsChange = useCallback((bbox: BBox) => {
        currentBBoxRef.current = bbox;
        coordinateLoad(false, bbox);
    }, [coordinateLoad]);

    useEffect(() => {
        const channel = supabase
            .channel('events-inserts')
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'events' }, (payload) => {
                const row = payload.new as Record<string, unknown>;
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
                    impactScore: typeof row.impact_score === 'number' ? row.impact_score : undefined,
                    sourcesCount: typeof row.event_count === 'number' ? row.event_count : undefined
                };

                const bbox = currentBBoxRef.current;
                const isGlobalSidebarView = !!bbox && bbox.zoom !== undefined && bbox.zoom < CLUSTER_ZOOM_THRESHOLD;
                if (!isGlobalSidebarView && bbox && !isWithinBBox(newItem, bbox)) return;

                mergeItemsIntoStore([newItem]);
                syncNewsFromStore(sortMode);
            })
            .subscribe();
        return () => { supabase.removeChannel(channel); };
    }, [mergeItemsIntoStore, sortMode, syncNewsFromStore]);

    return { news, isLoading, error, lastUpdated, fetchNews: coordinateLoad, onBoundsChange, fetchEventDetails };
}
