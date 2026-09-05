// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useNewsData } from '@/hooks/useNewsData';
import { inFlightFetches, responseCache } from '@/hooks/news/cacheUtils';
import type { BBox } from '@/lib/core/types';

const globalViewport: BBox = {
  minLat: -90,
  maxLat: 90,
  minLng: -180,
  maxLng: 180,
  centerLat: 0,
  centerLng: 0,
  zoom: 1,
};

describe('useNewsData request deduplication', () => {
  let now = Date.UTC(2026, 6, 21, 4, 15, 45, 360);
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    responseCache.clear();
    inFlightFetches.clear();
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    fetchMock = vi.fn(async () => new Response(JSON.stringify({
      items: [],
      meta: { isCapped: false },
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    cleanup();
    responseCache.clear();
    inFlightFetches.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('does not refetch for repeated effective viewports but preserves intentional reloads', async () => {
    const { result } = renderHook(() => useNewsData({
      timeRange: '1d',
      sortMode: 'hot',
    }));

    await act(async () => {
      await result.current.onBoundsChange(globalViewport);
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    // A style reload or duplicate moveend emits the same viewport later. The
    // rolling `since` value must not turn that into a distinct data request.
    now += 70_000;
    await act(async () => {
      await result.current.onBoundsChange({ ...globalViewport });
      await result.current.onBoundsChange({
        ...globalViewport,
        minLat: -80,
        maxLat: 80,
      });
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Switching from clustered data to individual pins changes the effective
    // query even when the coordinates do not.
    await act(async () => {
      await result.current.onBoundsChange({ ...globalViewport, forceRaw: true });
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    // Explicit refreshes remain authoritative and bypass deduplication.
    now += 60_000;
    await act(async () => {
      await result.current.fetchNews(true);
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
  });

  it('coalesces duplicate viewport emissions while the first request is still active', async () => {
    let resolveFetch: ((response: Response) => void) | undefined;
    fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    }));
    const { result } = renderHook(() => useNewsData({
      timeRange: '1d',
      sortMode: 'hot',
      resetKey: 'fresh-scope',
    }));

    let firstLoad: Promise<void> | undefined;
    act(() => {
      firstLoad = result.current.onBoundsChange(globalViewport);
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    now += 65_000;
    await act(async () => {
      await result.current.onBoundsChange({ ...globalViewport });
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveFetch?.(new Response(JSON.stringify({
        items: [],
        meta: { isCapped: false },
      }), { status: 200, headers: { 'content-type': 'application/json' } }));
      await firstLoad;
    });
  });

  it('retains an exact shared event while auth changes the feed scope', async () => {
    const eventId = '11111111-1111-4111-8111-111111111111';
    const sharedEvent = {
      id: eventId,
      title: 'Shared event',
      description: 'Exact event detail',
      url: 'https://example.com/shared',
      source: 'Example',
      sourceType: 'rss',
      publishedAt: '2026-07-21T04:00:00.000Z',
      latitude: 35.91,
      longitude: 127.77,
    };
    const detailRequests: string[] = [];
    let releaseReauthorized: (() => void) | undefined;
    const reauthorized = new Promise<void>(resolve => { releaseReauthorized = resolve; });

    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === `/api/news/${eventId}`) {
        detailRequests.push(url);
        if (detailRequests.length > 1) await reauthorized;
        return new Response(JSON.stringify({
          description: sharedEvent.description,
          latitude: sharedEvent.latitude,
          longitude: sharedEvent.longitude,
          event: sharedEvent,
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response(JSON.stringify({
        items: [],
        meta: { isCapped: false },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    });

    const { result, rerender } = renderHook(
      ({ resetKey }) => useNewsData({
        timeRange: '1d',
        sortMode: 'hot',
        resetKey,
        pinnedEventId: eventId,
      }),
      { initialProps: { resetKey: 'anonymous' } },
    );

    await act(async () => {
      await result.current.onBoundsChange(globalViewport);
      await result.current.fetchEventDetails(eventId);
    });
    await waitFor(() => expect(result.current.news).toEqual([
      expect.objectContaining({ id: eventId, description: 'Exact event detail' }),
    ]));

    rerender({ resetKey: 'guest' });

    await waitFor(() => expect(result.current.news).toEqual([
      expect.objectContaining({ id: eventId, latitude: 35.91, longitude: 127.77 }),
    ]));
    await waitFor(() => expect(result.current.news[0].description).toBeUndefined());

    await act(async () => {
      releaseReauthorized?.();
      await result.current.fetchEventDetails(eventId);
    });
    // A new auth scope re-authorizes timeline details while the pin remains.
    await waitFor(() => expect(detailRequests).toEqual([
      `/api/news/${eventId}`,
      `/api/news/${eventId}`,
    ]));
  });
});
