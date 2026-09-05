'use client';

/**
 * useViewState hook provides bidirectional synchronization between the URL 
 * search parameters and the application state. It manages map coordinates, 
 * zoom levels, search queries, and filter preferences, using replaceState 
 * to maintain a clean browser history.
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
    /** Custom time-window bounds; shared links preserve UTC instants. */
    from?: string;
    to?: string;
    /** Selected event ID */
    eventId?: string;
}

const DEFAULT_SOURCES = ['news', 'reddit', 'x', 'telegram', 'extra'];
const DEFAULT_CATEGORIES = ['all'];

function cameraNumber(value: string | null, min: number, max: number): number | undefined {
    if (!value?.trim()) return undefined;
    const number = Number(value);
    return Number.isFinite(number) && number >= min && number <= max ? number : undefined;
}

function dateBound(value: string | null): string | undefined {
    if (!value || value.length > 32) return undefined;
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return undefined;
    // Preserve the offset internally, including ambiguous daylight-saving hours.
    // Only the datetime-local form converts instants into wall-clock values.
    return value;
}

/**
 * Reads the initial view state from URL search parameters on hook initialization.
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
    const from = params.get('from');
    const to = params.get('to');
    const eventId = params.get('eventId');

    state.lat = cameraNumber(lat, -90, 90);
    state.lng = cameraNumber(lng, -180, 180);
    state.zoom = cameraNumber(zoom, 0, 18);
    if (q) state.q = q;
    if (t) state.t = t;
    if (src) state.src = src;
    if (cat) state.cat = cat;
    if (s) state.s = s;
    state.from = dateBound(from);
    state.to = dateBound(to);
    if (eventId) state.eventId = eventId;

    return state;
}

export function useViewState() {
    const searchParams = useSearchParams();
    const pathname = usePathname();
    const search = searchParams.toString();

    const initialState = useMemo(() => {
        return parseInitialState(new URLSearchParams(search));
    }, [search]);

    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const currentState = useRef<ViewState>({ ...initialState });

    useEffect(() => {
        currentState.current = { ...initialState };
        if (debounceRef.current) clearTimeout(debounceRef.current);
    }, [initialState]);

    /**
     * Updates the URL search parameters to reflect the current application state.
     * Uses a 300ms debounce to prevent performance degradation and excessive 
     * browser history operations during rapid map interactions.
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

            /**
             * Only encode source and category filters if they deviate from the 
             * default set to keep the URL concise.
             */
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
            if (s.s && s.s !== 'hot') params.set('s', s.s);
            if (s.t === 'custom' && s.from && s.to) {
                const fromDate = new Date(s.from);
                const toDate = new Date(s.to);
                if (Number.isFinite(fromDate.getTime()) && Number.isFinite(toDate.getTime())) {
                    params.set('from', fromDate.toISOString());
                    params.set('to', toDate.toISOString());
                }
            }
            if (s.eventId) params.set('eventId', s.eventId);

            const qs = params.toString();
            const newUrl = qs
                ? `${pathname}?${qs}`
                : pathname;

            window.history.replaceState(null, '', newUrl);
        }, 300);
    }, [pathname]);

    useEffect(() => {
        return () => {
            if (debounceRef.current) clearTimeout(debounceRef.current);
        };
    }, []);

    return { initialState, updateURL };
}
