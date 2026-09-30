// @vitest-environment jsdom
import { act, cleanup, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { activityPreferenceKey, useActivityHeatmapPreference } from '@/components/map/activityHeatmap/useActivityHeatmapPreference';
import ActivityHeatmapLegend from '@/components/map/activityHeatmap/ActivityHeatmapLegend';
import { buildActivityHeatmapData } from '@/components/map/activityHeatmap/data';
import { mapActivityFixture } from './fixtures/mapActivity';

beforeEach(() => { localStorage.clear(); vi.useFakeTimers(); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });
const hydrate = () => act(async () => { await vi.advanceTimersByTimeAsync(1); });

describe('account-scoped local display preference', () => {
    it('hydrates, persists and resets only the active account without cloud writes', async () => {
        const { result, unmount } = renderHook(() => useActivityHeatmapPreference('account-a'));
        await hydrate();
        expect(result.current.enabled).toBe(false);
        act(() => result.current.change(true));
        expect(localStorage.getItem(activityPreferenceKey('account-a'))).toBe('{"version":1,"enabled":true}');
        unmount();
        const next = renderHook(() => useActivityHeatmapPreference('account-a'));
        await hydrate();
        expect(next.result.current.enabled).toBe(true);
        act(() => next.result.current.reset());
        expect(localStorage.getItem(activityPreferenceKey('account-a'))).toBeNull();
        expect(next.result.current.enabled).toBe(false);
    });
    it('clears the previous owner immediately, cancels hydration and isolates guest preferences', async () => {
        localStorage.setItem(activityPreferenceKey('a'), '{"version":1,"enabled":true}');
        const { result, rerender } = renderHook(({ owner }) => useActivityHeatmapPreference(owner), { initialProps: { owner: 'a' as string | undefined } });
        await hydrate(); expect(result.current.enabled).toBe(true);
        rerender({ owner: 'b' }); expect(result.current.enabled).toBe(false);
        rerender({ owner: undefined });
        await hydrate(); expect(result.current.enabled).toBe(false);
        act(() => result.current.change(true));
        expect(localStorage.getItem(activityPreferenceKey('b'))).toBeNull();
        expect(localStorage.getItem(activityPreferenceKey())).toBe('{"version":1,"enabled":true}');
    });
    it.each(['oops', '{"version":2,"enabled":true}', '{"version":1,"enabled":"true"}', '{"version":1,"enabled":true,"note":"private"}', 'x'.repeat(129)])('validates and deletes malformed or oversized preferences: %s', async raw => {
        localStorage.setItem(activityPreferenceKey('a'), raw);
        const { result } = renderHook(() => useActivityHeatmapPreference('a'));
        await hydrate();
        expect(result.current.enabled).toBe(false);
        expect(result.current.error).toContain('reset');
        expect(localStorage.getItem(activityPreferenceKey('a'))).toBeNull();
    });
    it('handles quota/security errors, keeping a usable session toggle', async () => {
        const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Full', 'QuotaExceededError'); });
        const { result } = renderHook(() => useActivityHeatmapPreference('a'));
        await hydrate();
        act(() => result.current.change(true));
        expect(result.current.enabled).toBe(true); expect(result.current.error).toContain('session');
        write.mockRestore();
        vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('Denied'); });
        act(() => result.current.reset());
        expect(result.current.enabled).toBe(false); expect(result.current.error).toContain('session');
    });
    it('reports blocked reads and responds to other-tab preference changes/deletion without recreating them', async () => {
        const read = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('Denied'); });
        const { result } = renderHook(() => useActivityHeatmapPreference('a'));
        await hydrate(); expect(result.current.error).toContain('session');
        read.mockRestore();
        localStorage.setItem(activityPreferenceKey('a'), '{"version":1,"enabled":true}');
        act(() => window.dispatchEvent(new StorageEvent('storage', { key: activityPreferenceKey('a') })));
        expect(result.current.enabled).toBe(true);
        act(() => window.dispatchEvent(new StorageEvent('storage', { key: activityPreferenceKey('other') })));
        expect(result.current.enabled).toBe(true);
        localStorage.clear();
        act(() => window.dispatchEvent(new StorageEvent('storage', { key: null })));
        expect(result.current.enabled).toBe(false);
        expect(localStorage.getItem(activityPreferenceKey('a'))).toBeNull();
    });
    it('cancels reads on unmount', async () => {
        const read = vi.spyOn(Storage.prototype, 'getItem');
        const { unmount } = renderHook(() => useActivityHeatmapPreference('a'));
        unmount(); await hydrate(); expect(read).not.toHaveBeenCalled();
    });
});

describe('relative density legend', () => {
    it('explains approximation/caps and empty/loading/degraded data with theme-aware colors', () => {
        const data = buildActivityHeatmapData([{ ...mapActivityFixture[0], storyCount: 9 }]);
        const { rerender, container } = render(<ActivityHeatmapLegend data={data} dark={false} loading={false} isCapped unavailable={false} />);
        expect(screen.getByLabelText('Activity density legend').textContent).toContain('not danger or risk');
        expect(screen.getByText('Loaded result is capped.')).toBeTruthy();
        expect(screen.getByRole('status').textContent).toContain('approximate');
        const light = container.querySelector('[aria-hidden]')?.getAttribute('style');
        rerender(<ActivityHeatmapLegend data={buildActivityHeatmapData([])} dark loading={false} isCapped={false} unavailable={false} />);
        expect(screen.getByRole('status').textContent).toContain('No located stories');
        expect(container.querySelector('[aria-hidden]')?.getAttribute('style')).not.toBe(light);
        rerender(<ActivityHeatmapLegend data={data} dark loading isCapped={false} unavailable={false} />);
        expect(screen.getByRole('status').textContent).toContain('Updating');
        rerender(<ActivityHeatmapLegend data={data} dark loading={false} isCapped={false} unavailable />);
        expect(screen.getByRole('status').textContent).toContain('last loaded');
    });
});
