// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useNewsFilter, useNewsFilterState } from '@/hooks/useNewsFilter';
import type { BBox, NewsItem } from '@/lib/core/types';

const now = Date.UTC(2026, 8, 20);
const viewport: BBox = { minLat: 0, maxLat: 20, minLng: 0, maxLng: 30 };

function item(id: string, overrides: Partial<NewsItem> = {}): NewsItem {
  return {
    id,
    title: id,
    url: `https://example.com/${id}`,
    source: 'Example',
    sourceType: 'rss',
    category: 'world',
    publishedAt: new Date(now - 60 * 60 * 1000).toISOString(),
    latitude: 10,
    longitude: 20,
    ...overrides,
  };
}

describe('useNewsFilter view results', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('shares viewport results while preserving applied sort and a pinned out-of-scope story', () => {
    const news = [
      item('recent', { impactScore: 1 }),
      item('hot', { impactScore: 10, publishedAt: new Date(now - 2 * 60 * 60 * 1000).toISOString() }),
      item('outside', { latitude: 50, longitude: 50 }),
      item('pinned', { latitude: 60, longitude: 60, publishedAt: new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString() }),
    ];
    const { result } = renderHook(() => useNewsFilter(
      useNewsFilterState(), news, '1d', undefined, undefined, 'new', viewport, true, 'hot', 'pinned',
    ));

    act(() => vi.advanceTimersByTime(0));

    expect(result.current.mapNews.map(({ id }) => id)).toEqual(['hot', 'recent', 'pinned']);
    expect(result.current.filteredNews).toBe(result.current.mapNews);
  });

  it('keeps an unbounded sidebar independent from map bounds and can switch back to shared results', () => {
    const news = [item('inside'), item('outside', { latitude: 50, longitude: 50 })];
    const { result, rerender } = renderHook(({ respectBBox }) => useNewsFilter(
      useNewsFilterState(), news, '1d', undefined, undefined, 'new', viewport, respectBBox,
    ), { initialProps: { respectBBox: false } });

    act(() => vi.advanceTimersByTime(0));

    expect(result.current.mapNews.map(({ id }) => id)).toEqual(['inside']);
    expect(result.current.filteredNews.map(({ id }) => id)).toEqual(['inside', 'outside']);

    rerender({ respectBBox: true });
    expect(result.current.filteredNews.map(({ id }) => id)).toEqual(['inside']);
    expect(result.current.filteredNews).toBe(result.current.mapNews);
  });
});
