// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import {
  DEFAULT_SYNCED_PREFERENCES,
  sanitizeSyncedPreferences,
  useSyncedPreferences,
} from '@/hooks/useSyncedPreferences';

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
    clear: () => values.clear(),
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('sanitizeSyncedPreferences', () => {
  it('accepts valid persisted preferences', () => {
    expect(sanitizeSyncedPreferences({
      sources: ['reddit', 'news'],
      categories: ['crisis'],
      minVolume: 5,
      credibilityTiers: [2, 1],
      timeRange: '1w',
      customStartDate: '2026-07-01T12:00',
      customEndDate: '2026-07-02T12:00',
      sortMode: 'new',
      animatedEffects: false,
      sidebarOpen: false,
      theme: 'dark',
      mapStyle: 'satellite',
      overlays: { usgs: true, madeUp: true },
      forceIndividualPins: true,
      mutedClusters: true,
      globe: true,
    })).toMatchObject({
      sources: ['reddit', 'news'],
      categories: ['crisis'],
      minVolume: 5,
      credibilityTiers: [1, 2],
      timeRange: '1w',
      customStartDate: '2026-07-01T12:00',
      customEndDate: '2026-07-02T12:00',
      sortMode: 'new',
      animatedEffects: false,
      sidebarOpen: false,
      theme: 'dark',
      mapStyle: 'satellite',
      overlays: expect.objectContaining({ usgs: true }),
      forceIndividualPins: true,
      mutedClusters: true,
      globe: true,
    });
    expect(sanitizeSyncedPreferences({ overlays: { madeUp: true } }).overlays).not.toHaveProperty('madeUp');
  });

  it('bounds corrupt or oversized values to safe defaults', () => {
    expect(sanitizeSyncedPreferences({
      sources: ['invalid'],
      categories: [],
      minVolume: 10000,
      credibilityTiers: [0, 7],
      timeRange: 'forever',
      mapStyle: 'remote-url',
    })).toMatchObject({
      sources: DEFAULT_SYNCED_PREFERENCES.sources,
      categories: DEFAULT_SYNCED_PREFERENCES.categories,
      minVolume: 999,
      credibilityTiers: [1, 2, 3],
      timeRange: '1d',
      mapStyle: 'standard',
    });
  });
});

describe('useSyncedPreferences', () => {
  it('loads the current user row and debounces validated upserts', async () => {
    const maybeSingle = vi.fn(async () => ({
      data: { preferences: { ...DEFAULT_SYNCED_PREFERENCES, sortMode: 'new' } },
      error: null,
    }));
    const query: Record<string, unknown> = {
      select: vi.fn(() => query),
      eq: vi.fn(() => query),
      maybeSingle,
    };
    const upsert = vi.fn(async () => ({ error: null }));
    const supabase = {
      from: vi.fn(() => ({ ...query, upsert })),
    } as unknown as SupabaseClient;
    const user = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' } as User;

    const { result } = renderHook(() => useSyncedPreferences(supabase, user));
    await waitFor(() => expect(result.current.isLoaded).toBe(true));
    expect(result.current.preferences?.sortMode).toBe('new');

    vi.useFakeTimers();
    act(() => result.current.updatePreferences({ minVolume: 10 }));
    expect(result.current.preferences?.minVolume).toBe(10);
    expect(upsert).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      user_id: user.id,
      preferences: expect.objectContaining({ minVolume: 10 }),
    }), { onConflict: 'user_id' });
  });
});
