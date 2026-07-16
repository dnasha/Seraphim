'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import type { SortMode } from '@/lib/utils/filters';

export const DEFAULT_SOURCE_FILTERS = ['news', 'reddit', 'x', 'telegram', 'extra'];
export const DEFAULT_CATEGORY_FILTERS = ['all'];

const ALLOWED_SOURCES = new Set(DEFAULT_SOURCE_FILTERS);
const ALLOWED_CATEGORIES = new Set(['all', 'world', 'crisis', 'nation', 'business', 'technology', 'science', 'health']);
const ALLOWED_TIME_RANGES = new Set(['1d', '3d', '1w', '1m', 'custom']);
const ALLOWED_MAP_STYLES = new Set(['standard', 'dark', 'black', 'light', 'satellite', 'topographic']);
const ALLOWED_OVERLAYS = new Set(['usgs', 'noaa', 'eonet', 'fires', 'radiation', 'aqi', 'flights', 'iss']);

export interface SyncedPreferences {
  version: 1;
  sources: string[];
  categories: string[];
  minVolume: number;
  credibilityTiers: number[];
  timeRange: string;
  customStartDate: string;
  customEndDate: string;
  sortMode: SortMode;
  animatedEffects: boolean;
  sidebarOpen: boolean;
  theme: 'light' | 'dark';
  mapStyle: string;
  overlays: Record<string, boolean>;
  forceIndividualPins: boolean;
  globe: boolean;
}

export const DEFAULT_SYNCED_PREFERENCES: SyncedPreferences = {
  version: 1,
  sources: DEFAULT_SOURCE_FILTERS,
  categories: DEFAULT_CATEGORY_FILTERS,
  minVolume: 1,
  credibilityTiers: [1, 2, 3],
  timeRange: '1d',
  customStartDate: '',
  customEndDate: '',
  sortMode: 'hot',
  animatedEffects: true,
  sidebarOpen: true,
  theme: 'light',
  mapStyle: 'standard',
  overlays: Object.fromEntries([...ALLOWED_OVERLAYS].map((key) => [key, false])),
  forceIndividualPins: false,
  globe: false,
};

function validStringArray(value: unknown, allowed: Set<string>, fallback: string[]) {
  if (!Array.isArray(value)) return [...fallback];
  const values = [...new Set(value.filter((entry): entry is string => typeof entry === 'string' && allowed.has(entry)))];
  return values.length > 0 ? values : [...fallback];
}

function validDateTime(value: unknown) {
  return typeof value === 'string' && value.length <= 32 && Number.isFinite(new Date(value).getTime())
    ? value
    : '';
}

export function sanitizeSyncedPreferences(value: unknown): SyncedPreferences {
  const raw = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const rawOverlays = raw.overlays && typeof raw.overlays === 'object' && !Array.isArray(raw.overlays)
    ? raw.overlays as Record<string, unknown>
    : {};
  const overlays = Object.fromEntries(
    [...ALLOWED_OVERLAYS].map((key) => [key, rawOverlays[key] === true]),
  );
  const credibilityTiers = Array.isArray(raw.credibilityTiers)
    ? [...new Set(raw.credibilityTiers.filter((entry): entry is number => Number.isInteger(entry) && entry >= 1 && entry <= 3))].sort()
    : [1, 2, 3];

  return {
    version: 1,
    sources: validStringArray(raw.sources, ALLOWED_SOURCES, DEFAULT_SOURCE_FILTERS),
    categories: validStringArray(raw.categories, ALLOWED_CATEGORIES, DEFAULT_CATEGORY_FILTERS),
    minVolume: typeof raw.minVolume === 'number' && Number.isFinite(raw.minVolume)
      ? Math.min(999, Math.max(1, Math.round(raw.minVolume)))
      : 1,
    credibilityTiers: credibilityTiers.length > 0 ? credibilityTiers : [1, 2, 3],
    timeRange: typeof raw.timeRange === 'string' && ALLOWED_TIME_RANGES.has(raw.timeRange) ? raw.timeRange : '1d',
    customStartDate: validDateTime(raw.customStartDate),
    customEndDate: validDateTime(raw.customEndDate),
    sortMode: raw.sortMode === 'new' ? 'new' : 'hot',
    animatedEffects: raw.animatedEffects !== false,
    sidebarOpen: raw.sidebarOpen !== false,
    theme: raw.theme === 'dark' ? 'dark' : 'light',
    mapStyle: typeof raw.mapStyle === 'string' && ALLOWED_MAP_STYLES.has(raw.mapStyle) ? raw.mapStyle : 'standard',
    overlays,
    forceIndividualPins: raw.forceIndividualPins === true,
    globe: raw.globe === true,
  };
}

const cacheKey = (userId: string) => `seraphim_preferences:${userId}`;

export function useSyncedPreferences(supabase: SupabaseClient, user: User | null) {
  const [state, setState] = useState<{ userId: string | null; preferences: SyncedPreferences | null }>({
    userId: null,
    preferences: null,
  });
  const preferences = user && state.userId === user.id ? state.preferences : null;
  const isLoaded = user ? state.userId === user.id : true;
  const preferencesRef = useRef<SyncedPreferences>(DEFAULT_SYNCED_PREFERENCES);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    let cancelled = false;
    preferencesRef.current = DEFAULT_SYNCED_PREFERENCES;

    if (!user) {
      return () => { cancelled = true; };
    }

    const load = async () => {
      let cached: SyncedPreferences | null = null;
      try {
        const rawCached = localStorage.getItem(cacheKey(user.id));
        if (rawCached) cached = sanitizeSyncedPreferences(JSON.parse(rawCached));
      } catch {
        try {
          localStorage.removeItem(cacheKey(user.id));
        } catch {
          // Storage can be unavailable in privacy-restricted browser contexts.
        }
      }

      const { data, error } = await supabase
        .from('user_preferences')
        .select('preferences')
        .eq('user_id', user.id)
        .maybeSingle();
      if (cancelled) return;

      if (error) {
        console.warn('[preferences] Cloud preference load failed; using local cache.', error.message);
      }
      const next = data?.preferences
        ? sanitizeSyncedPreferences(data.preferences)
        : (cached ?? DEFAULT_SYNCED_PREFERENCES);
      preferencesRef.current = next;
      setState({ userId: user.id, preferences: next });
      try {
        localStorage.setItem(cacheKey(user.id), JSON.stringify(next));
      } catch {
        // A cache failure should never block cloud-backed preferences.
      }
    };

    void load();
    return () => { cancelled = true; };
  }, [supabase, user]);

  const updatePreferences = useCallback((patch: Partial<SyncedPreferences>) => {
    if (!user || !isLoaded) return;
    const next = sanitizeSyncedPreferences({ ...preferencesRef.current, ...patch });
    preferencesRef.current = next;
    setState({ userId: user.id, preferences: next });
    try {
      localStorage.setItem(cacheKey(user.id), JSON.stringify(next));
    } catch {
      // Cloud persistence remains authoritative.
    }

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      const snapshot = preferencesRef.current;
      const { error } = await supabase.from('user_preferences').upsert({
        user_id: user.id,
        preferences: snapshot,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' });
      if (error) console.warn('[preferences] Cloud preference save failed.', error.message);
    }, 500);
  }, [isLoaded, supabase, user]);

  return { preferences, isLoaded, updatePreferences };
}
