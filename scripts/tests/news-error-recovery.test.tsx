// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useNewsData } from '@/hooks/useNewsData';
import { inFlightFetches, responseCache } from '@/hooks/news/cacheUtils';
import type { BBox } from '@/lib/core/types';

const viewport: BBox = { minLat: -90, maxLat: 90, minLng: -180, maxLng: 180, centerLat: 0, centerLng: 0, zoom: 1 };
const story = { id: 'one', title: 'Loaded story', url: 'https://example.com', source: 'Example', sourceType: 'rss', publishedAt: '2026-09-22T00:00:00Z' };
const response = () => new Response(JSON.stringify({ items: [story], meta: { isCapped: false } }), { status: 200 });

describe('story error recovery', () => {
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        vi.useFakeTimers();
        responseCache.clear();
        inFlightFetches.clear();
        fetchMock = vi.fn(async () => response());
        vi.stubGlobal('fetch', fetchMock);
        vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        cleanup();
        vi.useRealTimers();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        responseCache.clear();
        inFlightFetches.clear();
    });

    async function loadStories() {
        const hook = renderHook(() => useNewsData({ timeRange: '1d', sortMode: 'hot' }));
        await act(async () => { await vi.advanceTimersByTimeAsync(0); });
        await act(async () => { await hook.result.current.onBoundsChange(viewport); });
        expect(hook.result.current.news).toHaveLength(1);
        return hook;
    }

    it('preserves stories and the error during retry, deduplicates retries, and clears on success', async () => {
        const { result } = await loadStories();
        fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
        await act(async () => { await result.current.fetchNews(true); });
        expect(result.current.error).toBe('Check your connection and try again.');
        expect(result.current.news[0].title).toBe(story.title);

        let resolveFetch!: (response: Response) => void;
        fetchMock.mockImplementationOnce(() => new Promise<Response>(resolve => { resolveFetch = resolve; }));
        let retry!: Promise<void>;
        act(() => { retry = result.current.fetchNews(true); });
        expect(result.current.isLoading).toBe(true);
        expect(result.current.error).toBe('Check your connection and try again.');

        await act(async () => { await result.current.fetchNews(true); });
        expect(fetchMock).toHaveBeenCalledTimes(3);
        expect(fetchMock.mock.calls[2][1].signal.aborted).toBe(false);
        await act(async () => { resolveFetch(response()); await retry; });
        expect(result.current.error).toBeNull();
        expect(result.current.isLoading).toBe(false);
        expect(result.current.news[0].title).toBe(story.title);
    });

    it('allows dismissal without refetching and reports a later failure again', async () => {
        const { result } = await loadStories();
        fetchMock.mockRejectedValue(new Error('server details should not reach the UI'));
        await act(async () => { await result.current.fetchNews(true); });
        act(() => result.current.dismissError());
        expect(result.current.error).toBeNull();
        expect(result.current.news).toHaveLength(1);
        expect(fetchMock).toHaveBeenCalledTimes(2);

        await act(async () => { await result.current.fetchNews(true); });
        expect(result.current.error).toBe('Check your connection and try again.');
        expect(result.current.isLoading).toBe(false);
    });

    it('clears a previous error when another viewport is served from cache', async () => {
        const { result } = await loadStories();
        const alternate = { ...viewport, minLat: 20, maxLat: 40, minLng: 10, maxLng: 40, zoom: 5 };
        fetchMock.mockRejectedValueOnce(new Error('offline'));
        await act(async () => { await result.current.onBoundsChange(alternate); });
        expect(result.current.error).not.toBeNull();
        // A different sort scope is not required to return to a cached viewport.
        await act(async () => { await result.current.onBoundsChange(viewport); });
        expect(result.current.error).toBeNull();
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('cancels a pending viewport when returning to cached stories without showing an abort error', async () => {
        const { result } = await loadStories();
        fetchMock.mockImplementationOnce((_url: string, { signal }: RequestInit) => new Promise<Response>((_resolve, reject) => {
            signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        }));
        let pending!: Promise<void>;
        act(() => {
            pending = result.current.onBoundsChange({ ...viewport, minLat: 20, maxLat: 40, minLng: 10, maxLng: 40, zoom: 5 });
        });
        await act(async () => {
            await result.current.onBoundsChange(viewport);
            await pending;
        });
        expect(fetchMock.mock.calls[1][1].signal.aborted).toBe(true);
        expect(result.current.isLoading).toBe(false);
        expect(result.current.error).toBeNull();
        expect(result.current.news[0].title).toBe(story.title);
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });
});
