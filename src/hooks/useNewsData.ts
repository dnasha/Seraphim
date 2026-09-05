'use client';

/**
 * useNewsData hook manages the lifecycle of news event data, including fetching, 
 * local caching, and deduplication. It maintains a persistent entity store 
 * that allows for seamless transitions between different map viewports 
 * without losing previously fetched data.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { newsFilterKey, appendNewsFilters, type NewsFilters } from '@/lib/utils/newsFilterParams';
import { NewsItem, NewsResponse, BBox } from "@/lib/core/types";
import { snapBBox } from "@/lib/utils/geo";
import { canonicalNewsId, matchesNewsId, normalizeSortMode, sortNewsItems } from '@/lib/utils/ranking';

const log = (message: unknown, ...optionalParams: unknown[]) => {
    if (process.env.NODE_ENV !== 'production') {
        console.log(message, ...optionalParams);
    }
};

import {
    LOCAL_RESPONSE_TTL_MS,
    responseCache,
    inFlightFetches,
    pruneResponseCache,
    computeSince,
    computeUntil,
} from './news/cacheUtils';
import {
    MAX_ENTITY_COUNT,
    mergeNewsItem,
} from './news/newsStore';

const DETAIL_TTL_MS = 60_000;
const MAX_DETAIL_ENTRIES = 200;

type NewsRequestScope = {
    filterKey?: string;
    bbox: BBox | null;
    sortMode?: string;
    query?: string;
    timeRange?: string;
    since?: string | null;
    until?: string | null;
    limit?: number;
};

function isSameRequestScope(current: NewsRequestScope, previous: NewsRequestScope | null) {
    if (!previous) return false;

    const currentBBox = current.bbox;
    const previousBBox = previous.bbox;
    const sameBBox = (!currentBBox && !previousBBox) || Boolean(
        currentBBox && previousBBox &&
        currentBBox.minLat === previousBBox.minLat &&
        currentBBox.maxLat === previousBBox.maxLat &&
        currentBBox.minLng === previousBBox.minLng &&
        currentBBox.maxLng === previousBBox.maxLng &&
        currentBBox.zoom === previousBBox.zoom &&
        Boolean(currentBBox.forceRaw) === Boolean(previousBBox.forceRaw)
    );
    const sameCustomWindow = current.timeRange !== 'custom' || (
        current.since === previous.since && current.until === previous.until
    );

    return sameBBox &&
        sameCustomWindow &&
        current.sortMode === previous.sortMode &&
        current.query === previous.query &&
        current.timeRange === previous.timeRange &&
        current.limit === previous.limit && current.filterKey === previous.filterKey;
}

export function useNewsData({
    filters = {},
    timeRange,
    searchQuery,
    customStartDate,
    customEndDate,
    sortMode,
    limit,
    enabled = true,
    resetKey,
    pinnedEventId = null
}: {
    filters?: NewsFilters;
    timeRange: string;
    searchQuery?: string;
    customStartDate?: string;
    customEndDate?: string;
    sortMode?: string;
    limit?: number;
    enabled?: boolean;
    resetKey?: string;
    pinnedEventId?: string | null;
}) {
    const filterKey = newsFilterKey(filters);
    const [news, setNews] = useState<NewsItem[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [lastUpdated, setLastUpdated] = useState<string | null>(null);
    const [isCapped, setIsCapped] = useState(false);
    const [appliedLimit, setAppliedLimit] = useState<number | undefined>(undefined);

    const newsRef = useRef<NewsItem[]>([]);
    const lastFetchParamsRef = useRef<NewsRequestScope | null>(null);
    const activeRequestParamsRef = useRef<NewsRequestScope | null>(null);
    const isFirstMount = useRef(true);

    const detailCache = useRef<Map<string, { timestamp: number; description: string; descriptionProvenance?: NewsItem['descriptionProvenance']; headlinePublishedAt?: string; independentPublisherCount?: number; sources: NewsItem['sources']; latitude?: number; longitude?: number; timelineRestricted?: boolean; totalSources?: number }>>(new Map());
    const detailGenerationRef = useRef(0);
    const detailFetcherRef = useRef<((id: string, force?: boolean) => Promise<void>) | null>(null);
    const freshDetail = useCallback((id: string) => {
        const cached = detailCache.current.get(id);
        if (cached && Date.now() - cached.timestamp < DETAIL_TTL_MS) return cached;
        detailCache.current.delete(id);
        return undefined;
    }, []);
    const fetchingDetailsRef = useRef<Set<string>>(new Set());
    const detailInFlightRef = useRef<Map<string, Promise<void>>>(new Map());

    const entitiesRef = useRef<Map<string, NewsItem>>(new Map());
    const entityTouchedAtRef = useRef<Map<string, number>>(new Map());
    const visibleMapIdsRef = useRef<Set<string>>(new Set());
    const visibleSidebarIdsRef = useRef<Set<string>>(new Set());
    const requestVersionRef = useRef(0);
    const abortControllerRef = useRef<AbortController | null>(null);
    const pendingBBoxRef = useRef<BBox | null>(null);
    const lastKnownBBoxRef = useRef<BBox | null>(null);
    const initialLoadFallbackRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const needsScopeReloadRef = useRef(false);
    const pinnedEventIdRef = useRef<string | null>(pinnedEventId);

    const [appliedSortMode, setAppliedSortMode] = useState<string>(sortMode || 'hot');

    useEffect(() => {
        const pinnedId = pinnedEventIdRef.current;
        const retainedEntities: Array<[string, NewsItem]> = pinnedId
            ? Array.from(entitiesRef.current.entries())
                .filter(([, item]) => matchesNewsId(item, pinnedId))
                .map(([entityId, item]) => [entityId, {
                    ...item,
                    // Detail/timeline fields are entitlement-sensitive. Preserve
                    // the visual pin, then reload these under the new auth scope.
                    description: undefined,
                    descriptionProvenance: undefined,
                    headlinePublishedAt: undefined,
                    independentPublisherCount: undefined,
                    sources: undefined,
                    timelineRestricted: undefined,
                    totalSources: undefined,
                }])
            : [];

        requestVersionRef.current += 1;
        detailGenerationRef.current += 1;
        responseCache.clear();
        inFlightFetches.clear();

        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
            abortControllerRef.current = null;
        }

        const knownBBox = pendingBBoxRef.current ?? lastKnownBBoxRef.current ?? lastFetchParamsRef.current?.bbox ?? null;
        lastFetchParamsRef.current = null;
        activeRequestParamsRef.current = null;
        pendingBBoxRef.current = knownBBox;
        needsScopeReloadRef.current = true;
        entitiesRef.current.clear();
        entityTouchedAtRef.current.clear();
        visibleMapIdsRef.current.clear();
        visibleSidebarIdsRef.current.clear();
        detailCache.current.clear();
        fetchingDetailsRef.current.clear();
        detailInFlightRef.current.clear();

        // Authentication and entitlement resolution changes the feed scope, but
        // it must not erase an exact event named by the URL. Keep that entity as
        // an out-of-scope pin while the new viewport request is coordinated.
        const retainedAt = Date.now();
        for (const [entityId, item] of retainedEntities) {
            entitiesRef.current.set(entityId, item);
            entityTouchedAtRef.current.set(entityId, retainedAt);
        }
        const timer = setTimeout(() => {
            const activePinnedId = pinnedEventIdRef.current;
            const activeItems = Array.from(entitiesRef.current.values()).filter((item) => (
                matchesNewsId(item, activePinnedId)
            ));
            setNews(activeItems);
            setError(null);
            setIsCapped(false);
            setAppliedLimit(undefined);
            setLastUpdated(null);
        }, 0);

        return () => {
            clearTimeout(timer);
            detailGenerationRef.current += 1;
        };
    }, [resetKey]);

    /**
     * Synchronizes the public news state with the internal entity store.
     * Filters items to ensure the sidebar only shows events relevant to 
     * the current map viewport or active search result set.
     */
    const syncNewsFromStore = useCallback((mode: string | undefined) => {
        const normalizedMode = normalizeSortMode(mode);
        const pinnedId = pinnedEventIdRef.current;
        
        const activeItems = Array.from(entitiesRef.current.values())
            .filter(item => {
                const key = canonicalNewsId(item);
                return (
                    visibleMapIdsRef.current.has(key) ||
                    visibleMapIdsRef.current.has(item.id) ||
                    matchesNewsId(item, pinnedId)
                );
            });

        setNews(sortNewsItems(activeItems, normalizedMode));
        setAppliedSortMode(normalizedMode);
    }, []);

    useEffect(() => {
        pinnedEventIdRef.current = pinnedEventId;
        syncNewsFromStore(sortMode);
    }, [pinnedEventId, sortMode, syncNewsFromStore]);

    /**
     * Removes stale items from the entity store based on a least-recently-touched 
     * policy when the store exceeds the maximum entity count.
     */
    const pruneEntityStore = useCallback(() => {
        const store = entitiesRef.current;
        if (store.size <= MAX_ENTITY_COUNT) return;

        const protectedIds = new Set<string>([
            ...visibleMapIdsRef.current,
            ...visibleSidebarIdsRef.current,
        ]);
        const pinnedId = pinnedEventIdRef.current;
        if (pinnedId) {
            protectedIds.add(pinnedId);
            for (const [entityId, item] of store.entries()) {
                if (matchesNewsId(item, pinnedId)) {
                    protectedIds.add(entityId);
                }
            }
        }

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

    /**
     * Merges a batch of news items into the internal entity store.
     * Uses canonical IDs for deduplication and hydrates items with
     * previously fetched details if they exist in the local detail cache.
     */
    const mergeItemsIntoStore = useCallback((items: NewsItem[]) => {
        const now = Date.now();

        for (const item of items) {
            const key = canonicalNewsId(item);
            const existing = entitiesRef.current.get(key);
            
            const merged = mergeNewsItem(existing, item);
            
            const cached = freshDetail(key);
            if (cached) {
                merged.description = cached.description;
                merged.descriptionProvenance = cached.descriptionProvenance;
                merged.headlinePublishedAt = cached.headlinePublishedAt;
                merged.independentPublisherCount = cached.independentPublisherCount;
                merged.sources = cached.sources;
                if (cached.latitude !== undefined) merged.latitude = cached.latitude;
                if (cached.longitude !== undefined) merged.longitude = cached.longitude;
            }

            entitiesRef.current.set(key, merged);
            entityTouchedAtRef.current.set(key, now);
        }

        for (const key of entitiesRef.current.keys()) {
            if (key.startsWith('cluster-') && !visibleMapIdsRef.current.has(key)) {
                entitiesRef.current.delete(key);
                entityTouchedAtRef.current.delete(key);
            }
        }

        pruneEntityStore();
    }, [pruneEntityStore, freshDetail]);

    useEffect(() => { newsRef.current = news; }, [news]);

    /**
     * Internal data fetcher that handles API communication and local 
     * result caching to minimize redundant network requests.
     */
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
        appendNewsFilters(params, filterKey);
        if (isRefresh) params.append('refresh', 'true');
        if (sortMode) params.append('sort', sortMode);
        params.append('time_range', timeRange);
        params.append('view', view);
        params.append('scope', scope);
        if (globalTopN) params.append('global_top_n', String(globalTopN));

        if (bbox) {
            params.append('minLat', String(bbox.minLat));
            params.append('maxLat', String(bbox.maxLat));
            params.append('minLng', String(bbox.minLng));
            params.append('maxLng', String(bbox.maxLng));
            if (bbox.zoom !== undefined) params.append('zoom', String(bbox.zoom));
            if (bbox.forceRaw || requestedLimit !== undefined) params.append('force_raw', 'true');
            if (bbox.since) params.append('since', bbox.since);
            if (bbox.until) params.append('until', bbox.until);
            if (bbox.query) params.append('query', bbox.query);
        } else {
            params.set('scope', 'global');
            const since = computeSince(timeRange, customStartDate);
            const until = computeUntil(timeRange, customEndDate);
            if (since) params.append('since', since);
            if (until) params.append('until', until);
            if (searchQuery) params.append('query', searchQuery);
            if (requestedLimit !== undefined) params.append('force_raw', 'true');
        }

        if (requestedLimit) params.append('limit', String(requestedLimit));

        const requestKey = JSON.stringify([resetKey ?? 'anonymous', params.toString()]);
        const generation = detailGenerationRef.current;
        const now = Date.now();
        pruneResponseCache(now);
        const cached = responseCache.get(requestKey);
        if (!isRefresh && cached && (now - cached.timestamp) < LOCAL_RESPONSE_TTL_MS) {
            return {
                items: cached.data.map(item => {
                    const cacheKey = item.originalId || item.id;
                    const cachedDetail = freshDetail(cacheKey);
                    return cachedDetail ? { 
                        ...item, 
                        ...cachedDetail,
                        latitude: cachedDetail.latitude !== undefined ? cachedDetail.latitude : item.latitude,
                        longitude: cachedDetail.longitude !== undefined ? cachedDetail.longitude : item.longitude
                    } : item;
                }),
                isCapped: cached.isCapped,
                lastUpdated: cached.lastUpdated ?? new Date(cached.timestamp).toISOString(),
                appliedLimit: cached.appliedLimit
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
                const cachedDetail = freshDetail(cacheKey);
                return cachedDetail ? { 
                    ...item, 
                    ...cachedDetail,
                    latitude: cachedDetail.latitude !== undefined ? cachedDetail.latitude : item.latitude,
                    longitude: cachedDetail.longitude !== undefined ? cachedDetail.longitude : item.longitude
                } : item;
            });
            const apiCapped = data.meta?.isCapped || false;
            const isCapped = apiCapped;
            const appliedLimit = data.meta?.appliedLimit;
            const lastUpdated = data.lastUpdated ?? new Date().toISOString();
            if (generation === detailGenerationRef.current && !signal?.aborted) {
                // Shared list caches never contain hydrated detail/timeline data.
                responseCache.set(requestKey, { data: data.items, isCapped, appliedLimit, timestamp: Date.now(), lastUpdated });
            }
            pruneResponseCache();
            return { items: hydrated, isCapped, appliedLimit, lastUpdated };
        })();

        inFlightFetches.set(requestKey, fetchPromise);
        try {
            return await fetchPromise;
        } finally {
            if (inFlightFetches.get(requestKey) === fetchPromise) inFlightFetches.delete(requestKey);
        }
    }, [filterKey, searchQuery, sortMode, timeRange, customStartDate, customEndDate, resetKey, freshDetail]);

    /**
     * Orchestrates the data loading sequence. It handles bounding box 
     * snapping, parameter change detection, and store synchronization.
     */
    const coordinateLoad = useCallback(async (isRefresh = false, rawBBox?: BBox) => {
        if (rawBBox && initialLoadFallbackRef.current) {
            clearTimeout(initialLoadFallbackRef.current);
            initialLoadFallbackRef.current = null;
        }
        if (rawBBox) {
            lastKnownBBoxRef.current = rawBBox;
        }

        if (!enabled) {
            if (rawBBox) {
                pendingBBoxRef.current = rawBBox;
            }
            log('[useNewsData] coordinateLoad called but not enabled.');
            return;
        }

        if (isRefresh) {
            responseCache.clear();
            detailCache.current.clear();
            detailInFlightRef.current.clear();
            detailGenerationRef.current += 1;
        }

        const prev = lastFetchParamsRef.current;
        const pendingBBox = pendingBBoxRef.current;
        const bboxSource = rawBBox ?? pendingBBox ?? lastKnownBBoxRef.current ?? undefined;
        if (bboxSource === pendingBBox) {
            pendingBBoxRef.current = null;
        }

        const bbox = bboxSource ? snapBBox(bboxSource) : (prev?.bbox ?? null);
        if (bbox) {
            lastKnownBBoxRef.current = bbox;
        }
        log(`[useNewsData] Resolved bbox:`, bbox ? `${bbox.minLat},${bbox.minLng} to ${bbox.maxLat},${bbox.maxLng}` : 'null');

        const since = computeSince(timeRange, customStartDate);
        const until = computeUntil(timeRange, customEndDate);
        const hasDateScope = Boolean(since || until);

        const isUpgradingFromLimitedFetch = prev?.limit !== undefined && limit === undefined;
        const needsScopeReload = needsScopeReloadRef.current;
        if (!bbox && !searchQuery && !limit && !hasDateScope && !isUpgradingFromLimitedFetch && !needsScopeReload) {
            log('[useNewsData] Returning early because bbox, searchQuery, and limit are all empty/falsy');
            setIsLoading(false);
            return;
        }

        const requestScope: NewsRequestScope = {
            filterKey,
            bbox,
            sortMode: sortMode || undefined,
            query: searchQuery || undefined,
            timeRange,
            since,
            until,
            limit,
        };

        if (!isRefresh && (
            (!needsScopeReload && isSameRequestScope(requestScope, prev)) ||
            isSameRequestScope(requestScope, activeRequestParamsRef.current)
        )) {
            log('[useNewsData] Returning early because the effective request scope is unchanged');
            return;
        }

        log(`[useNewsData] Proceeding to fetch. Prev limit was: ${prev?.limit}, New limit: ${limit}`);

        const enrichedBBox = bbox ? {
            ...bbox,
            since: since ?? undefined,
            until: until ?? undefined,
            timeRange,
            query: searchQuery,
            sortMode
        } : undefined;

        const params = new URLSearchParams();
        appendNewsFilters(params, filterKey);
        if (sortMode) params.append('sort', sortMode);
        params.append('time_range', timeRange);
        params.append('view', 'map');
        params.append('scope', 'viewport');
        if (limit) params.append('limit', String(limit));
        
        if (enrichedBBox) {
            params.append('minLat', String(enrichedBBox.minLat));
            params.append('maxLat', String(enrichedBBox.maxLat));
            params.append('minLng', String(enrichedBBox.minLng));
            params.append('maxLng', String(enrichedBBox.maxLng));
            if (enrichedBBox.zoom !== undefined) params.append('zoom', String(enrichedBBox.zoom));
            if (enrichedBBox.query) params.append('query', enrichedBBox.query);
            if (enrichedBBox.since) params.append('since', enrichedBBox.since);
            if (enrichedBBox.until) params.append('until', enrichedBBox.until);
            if (enrichedBBox.forceRaw || limit !== undefined) params.append('force_raw', 'true');
        } else {
            params.set('scope', 'global');
            if (since) params.append('since', since);
            if (until) params.append('until', until);
            if (searchQuery) params.append('query', searchQuery);
            if (limit !== undefined) params.append('force_raw', 'true');
        }
        const requestKey = JSON.stringify([resetKey ?? 'anonymous', params.toString()]);
        const now = Date.now();
        pruneResponseCache(now);
        const cached = responseCache.get(requestKey);
        const requestVersion = ++requestVersionRef.current;
        activeRequestParamsRef.current = requestScope;
        log(`[useNewsData] coordinateLoad started. Version: ${requestVersion}, isRefresh: ${isRefresh}, limit: ${limit}`);

        if (abortControllerRef.current) {
            log(`[useNewsData] Aborting superseded request before version ${requestVersion}`);
            abortControllerRef.current.abort();
            abortControllerRef.current = null;
        }

        /**
         * Cache Hit Optimization: If fresh data exists for this specific snapped 
         * bounding box, we update visibility sets and sync without a network request.
         */
        if (!isRefresh && cached && (now - cached.timestamp) < LOCAL_RESPONSE_TTL_MS) {
            const visibleIds = new Set(cached.data.map(item => item.originalId || item.id));
            visibleMapIdsRef.current = visibleIds;
            visibleSidebarIdsRef.current = new Set(visibleIds);

            mergeItemsIntoStore(cached.data);
            syncNewsFromStore(sortMode);
            setIsCapped(cached.isCapped);
            setAppliedLimit(cached.appliedLimit);
            setIsLoading(false);
            setLastUpdated(cached.lastUpdated ?? new Date(cached.timestamp).toISOString());
            lastFetchParamsRef.current = requestScope;
            needsScopeReloadRef.current = false;
            activeRequestParamsRef.current = null;
            return;
        }

        const abortController = new AbortController();
        abortControllerRef.current = abortController;
        setError(null);
        setIsLoading(true);
        try {
            const { items: mapResults, isCapped: resultCapped, appliedLimit: fetchLimit, lastUpdated: fetchUpdated } = await _performFetch({
                isRefresh,
                bbox: enrichedBBox,
                signal: abortController.signal,
                view: 'map',
                scope: 'viewport',
                limit
            });

            if (requestVersion !== requestVersionRef.current) return;

            const visibleIds = new Set(mapResults.map(item => item.originalId || item.id));
            visibleMapIdsRef.current = visibleIds;
            visibleSidebarIdsRef.current = new Set(visibleIds);

            mergeItemsIntoStore(mapResults);
            syncNewsFromStore(sortMode);
            setIsCapped(resultCapped);
            setAppliedLimit(fetchLimit);
            setLastUpdated(fetchUpdated ?? new Date().toISOString());
            lastFetchParamsRef.current = requestScope;
            needsScopeReloadRef.current = false;
            if (isRefresh && pinnedEventIdRef.current) {
                await detailFetcherRef.current?.(pinnedEventIdRef.current, true);
            }
        } catch (err) {
            if (err instanceof Error && err.name === 'AbortError') return;
            if (requestVersion !== requestVersionRef.current) return;
            setError(err instanceof Error ? err.message : 'An error occurred');
        } finally {
            if (requestVersion === requestVersionRef.current) {
                activeRequestParamsRef.current = null;
                abortControllerRef.current = null;
                setIsLoading(false);
            }
        }
    }, [filterKey, timeRange, searchQuery, customStartDate, customEndDate, sortMode, limit, enabled, resetKey, _performFetch, mergeItemsIntoStore, syncNewsFromStore]);

    useEffect(() => {
        if (!enabled) return;
        if (!pendingBBoxRef.current) return;
        const pending = pendingBBoxRef.current;
        pendingBBoxRef.current = null;
        coordinateLoad(false, pending);
    }, [enabled, coordinateLoad]);

    useEffect(() => {
        if (!enabled) return;
        
        if (isFirstMount.current) {
            isFirstMount.current = false;
            // Let MapLibre provide the real initial viewport first. A fallback
            // keeps the feed usable if the map cannot initialize.
            initialLoadFallbackRef.current = setTimeout(() => {
                initialLoadFallbackRef.current = null;
                coordinateLoad();
            }, 1_200);
            return () => {
                if (initialLoadFallbackRef.current) {
                    clearTimeout(initialLoadFallbackRef.current);
                    initialLoadFallbackRef.current = null;
                }
            };
        }
        
        coordinateLoad();
        return;
    }, [filterKey, timeRange, searchQuery, customStartDate, customEndDate, sortMode, limit, enabled, resetKey, coordinateLoad]);

    /**
     * Lazy-loads heavy event details (description, sources) for a specific item.
     * Updates the entity store and triggers a UI sync upon completion.
     */
    const fetchEventDetails = useCallback(async (id: string, force = false) => {
        if (!id) return;
        
        let targetId = id;
        if (id.startsWith('cluster-')) {
            const item = newsRef.current.find(i => matchesNewsId(i, id));
            if (item?.originalId) {
                targetId = item.originalId;
            } else {
                return;
            }
        }

        if (!force && freshDetail(targetId)) return;

        const existingInFlight = detailInFlightRef.current.get(targetId);
        if (existingInFlight) return existingInFlight;

        fetchingDetailsRef.current.add(targetId);
        const generation = detailGenerationRef.current;

        const detailPromise = (async () => {
            try {
                const res = await fetch(`/api/news/${targetId}${force ? '?refresh=true' : ''}`);
                if (!res.ok) return;
                const { description, sources, latitude, longitude, timelineRestricted, totalSources, event } = await res.json() as {
                    description?: string;
                    sources?: Array<{ name: string; url: string; source_type: string; discovered_at: string }>;
                    latitude?: number;
                    longitude?: number;
                    timelineRestricted?: boolean;
                    totalSources?: number;
                    event?: NewsItem;
                };
                if (generation !== detailGenerationRef.current) return;
                const descriptionValue = typeof description === 'string' ? description : '';
                const mappedSources = Array.isArray(sources)
                    ? sources.map((s) => ({
                        name: s.name,
                        url: s.url,
                        sourceType: s.source_type,
                        discoveredAt: s.discovered_at,
                    }))
                    : undefined;
                detailCache.current.set(targetId, {
                    timestamp: Date.now(),
                    description: descriptionValue,
                    descriptionProvenance: event?.descriptionProvenance,
                    headlinePublishedAt: event?.headlinePublishedAt,
                    independentPublisherCount: event?.independentPublisherCount,
                    sources: mappedSources,
                    latitude,
                    longitude,
                    timelineRestricted,
                    totalSources,
                });
                while (detailCache.current.size > MAX_DETAIL_ENTRIES) {
                    detailCache.current.delete(detailCache.current.keys().next().value!);
                }

                if (event) {
                    const hydratedEvent: NewsItem = {
                        ...event,
                        description: descriptionValue,
                        descriptionProvenance: event.descriptionProvenance,
                        headlinePublishedAt: event.headlinePublishedAt,
                        independentPublisherCount: event.independentPublisherCount,
                        sources: mappedSources ?? event.sources,
                        latitude: latitude !== undefined ? latitude : event.latitude,
                        longitude: longitude !== undefined ? longitude : event.longitude,
                        timelineRestricted,
                        totalSources,
                    };
                    mergeItemsIntoStore([hydratedEvent]);
                }

                let changed = false;
                for (const [entityId, entity] of entitiesRef.current.entries()) {
                    if (matchesNewsId(entity, targetId)) {
                        entitiesRef.current.set(entityId, {
                            ...entity,
                            description: descriptionValue,
                            descriptionProvenance: event?.descriptionProvenance,
                            headlinePublishedAt: event?.headlinePublishedAt,
                            independentPublisherCount: event?.independentPublisherCount,
                            sources: mappedSources ?? entity.sources,
                            latitude: latitude !== undefined ? latitude : entity.latitude,
                            longitude: longitude !== undefined ? longitude : entity.longitude,
                            timelineRestricted,
                            totalSources,
                        });
                        entityTouchedAtRef.current.set(entityId, Date.now());
                        changed = true;
                    }
                }
                if (changed || event) syncNewsFromStore(sortMode);
            } catch (err) {
                console.error(`[useNewsData] Error fetching event details for ${targetId}:`, err);
            } finally {
                if (generation === detailGenerationRef.current) {
                    fetchingDetailsRef.current.delete(targetId);
                    detailInFlightRef.current.delete(targetId);
                }
            }
        })();

        detailInFlightRef.current.set(targetId, detailPromise);
        return detailPromise;
    }, [mergeItemsIntoStore, sortMode, syncNewsFromStore, freshDetail]);

    useEffect(() => { detailFetcherRef.current = fetchEventDetails; }, [fetchEventDetails]);

    const onBoundsChange = useCallback((bbox: BBox) => {
        return coordinateLoad(false, bbox);
    }, [coordinateLoad]);

    // Smart scraper-aligned polling to fetch updates at scrape intervals (every 15/30 mins) + 2 min buffer
    useEffect(() => {
        if (typeof window === 'undefined' || !enabled) return;

        let pollTimeout: ReturnType<typeof setTimeout> | undefined;
        let nextPollAt = 0;
        let disposed = false;
        let refreshInFlight = false;

        const getMsToNextFetch = (): number => {
            const now = new Date();
            const currentMin = now.getMinutes();
            const currentSec = now.getSeconds();
            const currentMs = now.getMilliseconds();
            
            // Scraper runs every 30 minutes (potential 15 minutes in future) on [0, 15, 30, 45].
            // We align client polling to run at [2, 17, 32, 47] (+2 min jitter buffer).
            const targets = [2, 17, 32, 47];
            const targetMin = targets.find(m => m > currentMin);
            
            if (targetMin === undefined) {
                // Next target is minute 2 of the next hour
                const minsRemaining = (60 - currentMin) + 2;
                return (minsRemaining * 60 - currentSec) * 1000 - currentMs;
            } else {
                const minsRemaining = targetMin - currentMin;
                return (minsRemaining * 60 - currentSec) * 1000 - currentMs;
            }
        };

        const scheduleNextPoll = () => {
            if (disposed || document.visibilityState === 'hidden') return;
            if (pollTimeout) clearTimeout(pollTimeout);
            const ms = getMsToNextFetch();
            nextPollAt = Date.now() + ms;
            log(`[useNewsData] Scheduling next scraper-aligned update poll in ${(ms / 1000 / 60).toFixed(2)} minutes.`);
            
            pollTimeout = setTimeout(async () => {
                pollTimeout = undefined;
                if (document.visibilityState === 'hidden') return;
                log('[useNewsData] Scraper-aligned update poll triggered. Fetching fresh events...');
                // Trigger a refresh (caches are cleared, new events are merged, existing viewport is retained)
                refreshInFlight = true;
                try {
                    await coordinateLoad(true);
                } finally {
                    refreshInFlight = false;
                }
                scheduleNextPoll();
            }, ms);
        };

        const onVisibilityChange = () => {
            if (document.visibilityState === 'hidden') {
                if (pollTimeout) clearTimeout(pollTimeout);
                pollTimeout = undefined;
                return;
            }

            if (nextPollAt > 0 && Date.now() >= nextPollAt) {
                if (refreshInFlight) return;
                nextPollAt = 0;
                refreshInFlight = true;
                void coordinateLoad(true).finally(() => {
                    refreshInFlight = false;
                    scheduleNextPoll();
                });
            } else {
                scheduleNextPoll();
            }
        };

        scheduleNextPoll();
        document.addEventListener('visibilitychange', onVisibilityChange);

        return () => {
            disposed = true;
            if (pollTimeout) clearTimeout(pollTimeout);
            document.removeEventListener('visibilitychange', onVisibilityChange);
        };
    }, [enabled, coordinateLoad]);

    return { news, appliedSortMode, isLoading, isCapped, appliedLimit, error, lastUpdated, fetchNews: coordinateLoad, onBoundsChange, fetchEventDetails };
}
