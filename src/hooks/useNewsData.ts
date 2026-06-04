'use client';

/**
 * useNewsData hook manages the lifecycle of news event data, including fetching, 
 * local caching, and deduplication. It maintains a persistent entity store 
 * that allows for seamless transitions between different map viewports 
 * without losing previously fetched data.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { NewsItem, NewsResponse, BBox } from "@/lib/core/types";
import { snapBBox } from "@/lib/utils/geo";
import { normalizeSortMode, sortNewsItems } from '@/lib/utils/ranking';

const log = (message: unknown, ...optionalParams: unknown[]) => {
    if (process.env.NODE_ENV !== 'production') {
        console.log(message, ...optionalParams);
    }
};

const LOCAL_RESPONSE_TTL_MS = 60_000;
const MAX_RESPONSE_CACHE_ENTRIES = 200;
const MAX_ENTITY_COUNT = 5000;

const responseCache = new Map<string, { data: NewsItem[]; isCapped: boolean; appliedLimit?: number; timestamp: number }>();
const inFlightFetches = new Map<string, Promise<{ items: NewsItem[]; isCapped: boolean; appliedLimit?: number }>>();

function pruneResponseCache(now = Date.now()) {
    for (const [key, cached] of responseCache.entries()) {
        if (now - cached.timestamp >= LOCAL_RESPONSE_TTL_MS) {
            responseCache.delete(key);
        }
    }

    while (responseCache.size > MAX_RESPONSE_CACHE_ENTRIES) {
        const oldestKey = responseCache.keys().next().value as string | undefined;
        if (!oldestKey) break;
        responseCache.delete(oldestKey);
    }
}

function computeSince(timeRange: string, customStartDate?: string): string | null {
    if (timeRange === 'custom') return customStartDate ? new Date(customStartDate).toISOString() : null;
    const ms: Record<string, number> = { '1d': 86400000, '3d': 259200000, '1w': 604800000, '1m': 2592000000 };
    return ms[timeRange] ? new Date(Date.now() - ms[timeRange]).toISOString() : null;
}

function computeUntil(timeRange: string, customEndDate?: string): string | null {
    return (timeRange === 'custom' && customEndDate) ? new Date(customEndDate).toISOString() : null;
}

/**
 * Merges an incoming news item with an existing one in the store.
 * It prioritizes the highest source count and preserves impact scores.
 * This prevents data downgrades when receiving partial updates from the API.
 */
function mergeNewsItem(existing: NewsItem | undefined, incoming: NewsItem): NewsItem {
    if (!existing) return incoming;
    
    // Reporting strength is determined by the maximum known source count across all updates.
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
    sortMode,
    limit,
    enabled = true,
    resetKey
}: {
    unmappedOnly: boolean;
    timeRange: string;
    searchQuery?: string;
    customStartDate?: string;
    customEndDate?: string;
    sortMode?: string;
    limit?: number;
    enabled?: boolean;
    resetKey?: string;
}) {
    const [news, setNews] = useState<NewsItem[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [lastUpdated, setLastUpdated] = useState<string | null>(null);
    const [isCapped, setIsCapped] = useState(false);
    const [appliedLimit, setAppliedLimit] = useState<number | undefined>(undefined);

    const newsRef = useRef<NewsItem[]>([]);
    const lastFetchParamsRef = useRef<{
        bbox: BBox | null;
        sortMode?: string;
        query?: string;
        timeRange?: string;
        unmappedOnly?: boolean;
        limit?: number;
    } | null>(null);
    const isFirstMount = useRef(true);

    const detailCache = useRef<Map<string, { description: string; sources: NewsItem['sources']; latitude?: number; longitude?: number }>>(new Map());
    const fetchingDetailsRef = useRef<Set<string>>(new Set());

    const entitiesRef = useRef<Map<string, NewsItem>>(new Map());
    const entityTouchedAtRef = useRef<Map<string, number>>(new Map());
    const visibleMapIdsRef = useRef<Set<string>>(new Set());
    const visibleSidebarIdsRef = useRef<Set<string>>(new Set());
    const requestVersionRef = useRef(0);
    const abortControllerRef = useRef<AbortController | null>(null);
    const pendingBBoxRef = useRef<BBox | null>(null);

    const [appliedSortMode, setAppliedSortMode] = useState<string>(sortMode || 'hot');

    useEffect(() => {
        requestVersionRef.current += 1;

        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
            abortControllerRef.current = null;
        }

        lastFetchParamsRef.current = null;
        pendingBBoxRef.current = null;
        entitiesRef.current.clear();
        entityTouchedAtRef.current.clear();
        visibleMapIdsRef.current.clear();
        visibleSidebarIdsRef.current.clear();
        detailCache.current.clear();
        fetchingDetailsRef.current.clear();

        const timer = setTimeout(() => {
            setNews([]);
            setError(null);
            setIsCapped(false);
            setAppliedLimit(undefined);
            setLastUpdated(null);
        }, 0);

        return () => clearTimeout(timer);
    }, [resetKey]);

    /**
     * Synchronizes the public news state with the internal entity store.
     * Filters items to ensure the sidebar only shows events relevant to 
     * the current map viewport or active search result set.
     */
    const syncNewsFromStore = useCallback((mode: string | undefined) => {
        const normalizedMode = normalizeSortMode(mode);
        
        const activeItems = Array.from(entitiesRef.current.values())
            .filter(item => {
                const key = item.originalId || item.id;
                return visibleMapIdsRef.current.has(key) || visibleMapIdsRef.current.has(item.id);
            });

        setNews(sortNewsItems(activeItems, normalizedMode));
        setAppliedSortMode(normalizedMode);
    }, []);

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
            const key = item.originalId || item.id;
            const existing = entitiesRef.current.get(key);
            
            const merged = mergeNewsItem(existing, item);
            
            const cached = detailCache.current.get(key);
            if (cached) {
                merged.description = cached.description;
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
    }, [pruneEntityStore]);

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

        const requestKey = params.toString();
        const now = Date.now();
        pruneResponseCache(now);
        const cached = responseCache.get(requestKey);
        if (!isRefresh && cached && (now - cached.timestamp) < LOCAL_RESPONSE_TTL_MS) {
            return {
                items: cached.data.map(item => {
                    const cacheKey = item.originalId || item.id;
                    const cachedDetail = detailCache.current.get(cacheKey);
                    return cachedDetail ? { 
                        ...item, 
                        ...cachedDetail,
                        latitude: cachedDetail.latitude !== undefined ? cachedDetail.latitude : item.latitude,
                        longitude: cachedDetail.longitude !== undefined ? cachedDetail.longitude : item.longitude
                    } : item;
                }),
                isCapped: cached.isCapped,
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
                const cachedDetail = detailCache.current.get(cacheKey);
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
            responseCache.set(requestKey, { data: hydrated, isCapped, appliedLimit, timestamp: Date.now() });
            pruneResponseCache();
            return { items: hydrated, isCapped, appliedLimit };
        })();

        inFlightFetches.set(requestKey, fetchPromise);
        try {
            return await fetchPromise;
        } finally {
            inFlightFetches.delete(requestKey);
        }
    }, [unmappedOnly, searchQuery, sortMode, timeRange, customStartDate, customEndDate]);

    /**
     * Orchestrates the data loading sequence. It handles bounding box 
     * snapping, parameter change detection, and store synchronization.
     */
    const coordinateLoad = useCallback(async (isRefresh = false, rawBBox?: BBox) => {
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
        }

        const prev = lastFetchParamsRef.current;
        const pendingBBox = pendingBBoxRef.current;
        const bboxSource = rawBBox ?? pendingBBox ?? undefined;
        if (bboxSource === pendingBBox) {
            pendingBBoxRef.current = null;
        }

        const bbox = bboxSource ? snapBBox(bboxSource) : (prev?.bbox ?? null);
        log(`[useNewsData] Resolved bbox:`, bbox ? `${bbox.minLat},${bbox.minLng} to ${bbox.maxLat},${bbox.maxLng}` : 'null');

        const isUpgradingFromLimitedFetch = prev?.limit !== undefined && limit === undefined;
        if (!bbox && !unmappedOnly && !searchQuery && !limit && !isUpgradingFromLimitedFetch) {
            log('[useNewsData] Returning early because bbox, unmappedOnly, searchQuery, and limit are all empty/falsy');
            setIsLoading(false);
            return;
        }

        const isSameBBox = unmappedOnly || (!bbox && !prev?.bbox) || (
            bbox && prev?.bbox &&
            bbox.minLat === prev.bbox.minLat &&
            bbox.maxLat === prev.bbox.maxLat &&
            bbox.minLng === prev.bbox.minLng &&
            bbox.maxLng === prev.bbox.maxLng &&
            bbox.zoom === prev.bbox.zoom
        );

        if (!isRefresh && prev && isSameBBox &&
            unmappedOnly === prev.unmappedOnly &&
            sortMode === prev.sortMode &&
            searchQuery === prev.query &&
            timeRange === prev.timeRange &&
            limit === prev.limit) {
            log('[useNewsData] Returning early because all parameters match previous fetch params');
            return;
        }

        log(`[useNewsData] Proceeding to fetch. Prev limit was: ${prev?.limit}, New limit: ${limit}`);

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

        const params = new URLSearchParams();
        if (unmappedOnly) params.append('unmapped_only', 'true');
        if (sortMode) params.append('sort', sortMode);
        params.append('view', 'map');
        params.append('scope', unmappedOnly ? 'global' : 'viewport');
        if (limit) params.append('limit', String(limit));
        
        if (enrichedBBox && !unmappedOnly) {
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
        const requestKey = params.toString();
        const now = Date.now();
        pruneResponseCache(now);
        const cached = responseCache.get(requestKey);
        const requestVersion = ++requestVersionRef.current;
        log(`[useNewsData] coordinateLoad started. Version: ${requestVersion}, isRefresh: ${isRefresh}, limit: ${limit}`);

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
            setLastUpdated(new Date(cached.timestamp).toISOString());
            lastFetchParamsRef.current = {
                bbox,
                sortMode,
                query: searchQuery,
                timeRange,
                unmappedOnly,
                limit
            };
            return;
        }

        if (abortControllerRef.current) {
            log(`[useNewsData] Aborting previous controller in version ${requestVersion}`);
            abortControllerRef.current.abort();
        }

        const abortController = new AbortController();
        abortControllerRef.current = abortController;
        setError(null);
        setIsLoading(true);
        try {
            const { items: mapResults, isCapped: resultCapped, appliedLimit: fetchLimit } = await _performFetch({
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
            setLastUpdated(new Date().toISOString());
            lastFetchParamsRef.current = {
                bbox,
                sortMode,
                query: searchQuery,
                timeRange,
                unmappedOnly,
                limit
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
    }, [timeRange, searchQuery, customStartDate, customEndDate, sortMode, unmappedOnly, limit, enabled, _performFetch, mergeItemsIntoStore, syncNewsFromStore]);

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
            const timer = setTimeout(() => coordinateLoad(), 0);
            return () => clearTimeout(timer);
        }
        
        coordinateLoad();
        return;
    }, [timeRange, searchQuery, customStartDate, customEndDate, sortMode, limit, enabled, coordinateLoad]);

    /**
     * Lazy-loads heavy event details (description, sources) for a specific item.
     * Updates the entity store and triggers a UI sync upon completion.
     */
    const fetchEventDetails = useCallback(async (id: string) => {
        if (!id || fetchingDetailsRef.current.has(id)) return;
        
        let targetId = id;
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
            const res = await fetch(`/api/news/${targetId}`);
            if (!res.ok) return;
            const { description, sources, latitude, longitude } = await res.json() as { 
                description?: string; 
                sources?: Array<{ name: string; url: string; source_type: string; discovered_at: string }>;
                latitude?: number;
                longitude?: number;
            };
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
                description: descriptionValue, 
                sources: mappedSources,
                latitude,
                longitude
            });

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
                        latitude: latitude !== undefined ? latitude : entity.latitude,
                        longitude: longitude !== undefined ? longitude : entity.longitude,
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

    // Smart scraper-aligned polling to fetch updates at scrape intervals (every 15/30 mins) + 2 min buffer
    useEffect(() => {
        if (typeof window === 'undefined' || !enabled) return;

        let pollTimeout: NodeJS.Timeout | undefined;

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
            const ms = getMsToNextFetch();
            log(`[useNewsData] Scheduling next scraper-aligned update poll in ${(ms / 1000 / 60).toFixed(2)} minutes.`);
            
            pollTimeout = setTimeout(async () => {
                log('[useNewsData] Scraper-aligned update poll triggered. Fetching fresh events...');
                // Trigger a refresh (caches are cleared, new events are merged, existing viewport is retained)
                await coordinateLoad(true);
                scheduleNextPoll();
            }, ms);
        };

        scheduleNextPoll();

        return () => {
            if (pollTimeout) clearTimeout(pollTimeout);
        };
    }, [enabled, coordinateLoad]);

    return { news, appliedSortMode, isLoading, isCapped, appliedLimit, error, lastUpdated, fetchNews: coordinateLoad, onBoundsChange, fetchEventDetails };
}
