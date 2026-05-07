'use client';

/*
useViewState hook — bidirectional URL ↔ app state synchronization.
Reads initial map center, zoom, search query, time range, and filter state from
URL search parameters and exposes an `updateURL` function to sync changes back.
Uses `replaceState` to avoid polluting browser history.
*/

import { useRef, useCallback, useEffect, useMemo } from 'react';
import { useSearchParams, usePathname } from 'next/navigation';

/** Parameters encoded in the URL. */
export interface ViewState {
    lat?: number;
    lng?: number;
    zoom?: number;
    /** Search query */
    q?: string;
    /** Time range key (e.g. '1d', '3d', '1w', '1m', 'custom') */
    t?: string;
    /** Comma-separated list of active source filters (only when non-default) */
    src?: string;
    /** Comma-separated list of active category filters (only when non-default) */
    cat?: string;
    /** Sort mode ('new' or 'hot') */
    s?: string;
    /** Selected event ID */
    eventId?: string;
}

const DEFAULT_SOURCES = ['news', 'reddit', 'x', 'telegram', 'extra'];
const DEFAULT_CATEGORIES = ['all'];

/**
 * Reads the initial view state from URL search parameters.
 * Returns only the fields that were explicitly provided.
 */
function parseInitialState(params: URLSearchParams): ViewState {
    const state: ViewState = {};

    const lat = params.get('lat');
    const lng = params.get('lng');
    const zoom = params.get('zoom');
    const q = params.get('q');
    const t = params.get('t');
    const src = params.get('src');
    const cat = params.get('cat');
    const s = params.get('s');
    const eventId = params.get('eventId');

    if (lat) state.lat = parseFloat(lat);
    if (lng) state.lng = parseFloat(lng);
    if (zoom) state.zoom = parseFloat(zoom);
    if (q) state.q = q;
    if (t) state.t = t;
    if (src) state.src = src;
    if (cat) state.cat = cat;
    if (s) state.s = s;
    if (eventId) state.eventId = eventId;

    return state;
}

/**
 * Returns the initial view state from the URL (read once on mount) and
 * an `updateURL(partial)` callback that debounce-writes changes back.
 */
export function useViewState() {
    const searchParams = useSearchParams();
    const pathname = usePathname();

    // Memoize the initial state parsed from the search params.
    // useSearchParams is stable and SSR-safe in Next.js App Router.
    const initialState = useMemo(() => {
        return parseInitialState(new URLSearchParams(searchParams.toString()));
    }, [searchParams]);

    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Keep a running snapshot of the full state to merge partial updates into.
    const currentState = useRef<ViewState>({ ...initialState });

    /**
     * Merges a partial state update and syncs the URL via replaceState.
     * Debounced to 300ms to avoid thrashing during rapid map pans.
     */
    const updateURL = useCallback((partial: Partial<ViewState>) => {
        currentState.current = { ...currentState.current, ...partial };

        if (debounceRef.current) clearTimeout(debounceRef.current);

        debounceRef.current = setTimeout(() => {
            const s = currentState.current;
            const params = new URLSearchParams();

            if (s.lat != null) params.set('lat', s.lat.toFixed(4));
            if (s.lng != null) params.set('lng', s.lng.toFixed(4));
            if (s.zoom != null) params.set('zoom', s.zoom.toFixed(1));
            if (s.q) params.set('q', s.q);
            if (s.t && s.t !== '1d') params.set('t', s.t);

            // Only encode filters if they deviate from defaults
            if (s.src) {
                const srcArr = s.src.split(',').sort();
                const defArr = [...DEFAULT_SOURCES].sort();
                if (srcArr.join(',') !== defArr.join(',')) {
                    params.set('src', s.src);
                }
            }
            if (s.cat) {
                const catArr = s.cat.split(',').sort();
                const defArr = [...DEFAULT_CATEGORIES].sort();
                if (catArr.join(',') !== defArr.join(',')) {
                    params.set('cat', s.cat);
                }
            }
            if (s.s && s.s !== 'new') params.set('s', s.s);
            if (s.eventId) params.set('eventId', s.eventId);

            const qs = params.toString();
            const newUrl = qs
                ? `${pathname}?${qs}`
                : pathname;

            window.history.replaceState(null, '', newUrl);
        }, 300);
    }, [pathname]);

    // Cleanup debounce timer on unmount
    useEffect(() => {
        return () => {
            if (debounceRef.current) clearTimeout(debounceRef.current);
        };
    }, []);

    return { initialState, updateURL };
}
