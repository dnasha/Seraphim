// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { HomeContent } from '@/components/layout/HomeContent';
import type { NewsItem } from '@/lib/core/types';
import { buildActivityHeatmapData } from '@/components/map/activityHeatmap/data';

const mocks = vi.hoisted(() => ({
    params: new URLSearchParams('eventId=late&t=3d'),
    preferences: vi.fn(),
    fetch: vi.fn(),
    owner: 'account-a',
    tier: 'pro',
    rows: [] as NewsItem[],
    loading: false,
    capped: true,
    error: null as string | null,
    scope: vi.fn(),
    dismiss: vi.fn(),
    alertScopes: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useSearchParams: () => mocks.params, usePathname: () => '/' }));
vi.mock('next-themes', () => ({ useTheme: () => ({ resolvedTheme: 'light', setTheme: vi.fn() }) }));
vi.mock('next/dynamic', () => ({ default: (loader: () => unknown) => {
    if (!String(loader).includes('NewsMap')) return function Alerts(props: unknown) { mocks.alertScopes(props); return null; };
    return function Map({ items, selectedItemId, ...status }: { items: NewsItem[]; selectedItemId: string | null; dataReady: boolean; isCapped: boolean; activityDataUnavailable: boolean; presentationOnly: boolean }) {
    return <div><output data-testid="map-frame">{items.map(item => item.title).join(',')}</output><output data-testid="map-details">{items.map(item => item.description).join(",")}</output><span data-testid="selected-id">{selectedItemId}</span><output data-testid="density">{JSON.stringify(buildActivityHeatmapData(items))}</output><output data-testid="map-status">{JSON.stringify(status)}</output></div>;
}; } }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: mocks.owner }, isGuest: false, isLoading: false, showAuthModal: false }) }));
vi.mock('@/hooks/useUserTier', () => ({ useUserTier: () => ({ tier: mocks.tier, isLoading: false }) }));
vi.mock('@/hooks/useSyncedPreferences', () => ({ useSyncedPreferences: () => ({ preferences: null, isLoaded: true, updatePreferences: mocks.preferences }) }));
vi.mock('@/hooks/useNewsData', () => ({ useNewsData: (scope: unknown) => {
    mocks.scope(scope);
    return { news: mocks.rows, appliedSortMode: 'new', isLoading: mocks.loading, isCapped: mocks.capped, appliedLimit: 1000, error: mocks.error, dismissError: mocks.dismiss, fetchNews: mocks.fetch, onBoundsChange: mocks.fetch, fetchEventDetails: mocks.fetch };
} }));
vi.mock('@/components/layout/StartupGate', () => ({ default: ({ children }: { children: React.ReactNode }) => children }));
vi.mock('@/components/auth/UserButton', () => ({ default: () => null }));
vi.mock('@/components/ui/PWAInstallPrompt', () => ({ default: () => null }));
vi.mock('@/components/ui/FilterBar', () => ({ default: () => null }));
vi.mock('@/components/ui/EventSidebar', () => ({ default: ({ items }: { items: NewsItem[] }) => <div data-testid="sidebar-frame">{items.map(item => item.title).join(',')}</div> }));

beforeEach(() => {
    vi.useFakeTimers(); vi.setSystemTime('2026-09-30T12:00:00Z'); vi.clearAllMocks();
    mocks.owner = 'account-a'; mocks.tier = 'pro';
    mocks.loading = false; mocks.capped = true; mocks.error = null;
    mocks.params = new URLSearchParams('eventId=late&t=3d');
    window.history.replaceState(null, '', '/?eventId=late&t=3d');
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    mocks.rows = [36, 1].map((hours, index) => ({ id: index === 0 ? 'early' : 'late', title: index === 0 ? 'Earlier metadata' : 'Later metadata', description: 'Fixture details', source: 'Fixture', sourceType: 'rss', url: 'https://example.com', publishedAt: new Date(Date.now() - hours * 3_600_000).toISOString(), latitude: 42, longitude: 10 }));
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it('uses real filter and URL hooks without changing query scope, saved preferences or selected id during replay', () => {
    const { rerender } = render(<HomeContent />);
    act(() => { vi.advanceTimersByTime(1); });
    fireEvent.click(screen.getByRole('button', { name: 'Freeze loaded view' }));
    const slider = screen.getByRole('slider', { name: 'Reporting cursor' });
    fireEvent.change(slider, { target: { value: '960' } });
    expect(screen.getByTestId('map-frame').textContent).toBe('Earlier metadata');
    expect(screen.getByTestId('sidebar-frame').textContent).toBe('Later metadata,Earlier metadata');
    expect(screen.getByTestId('selected-id').textContent).toBe('late');
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    act(() => { vi.advanceTimersByTime(1000); });
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.preferences).not.toHaveBeenCalled();
    expect(window.location.search).toBe('?eventId=late&t=3d');
    // Deliberate selected-story detail hydration remains usable and is current metadata.
    mocks.rows = mocks.rows.map(row => ({ ...row, description: 'Current hydrated details' }));
    rerender(<HomeContent />);
    fireEvent.change(slider, { target: { value: '1440' } });
    expect(screen.getByTestId('map-details').textContent).toContain('Current hydrated details');
    fireEvent.change(slider, { target: { value: '960' } });
    // A late background update cannot replace captured titles or temporal evidence.
    mocks.rows = mocks.rows.map(row => ({ ...row, title: 'Live replacement', publishedAt: new Date().toISOString() }));
    rerender(<HomeContent />);
    expect(screen.getByTestId('map-frame').textContent).toBe('Earlier metadata');
    fireEvent.click(screen.getByRole('button', { name: 'Return live' }));
    expect(screen.getByTestId('map-frame').textContent).toBe('Live replacement,Live replacement');
    expect(window.location.search).toBe('?eventId=late&t=3d');
});
it('clears the snapshot immediately for a different account and on a tier downgrade', () => {
    const { rerender } = render(<HomeContent />);
    act(() => { vi.advanceTimersByTime(1); });
    fireEvent.click(screen.getByRole('button', { name: 'Freeze loaded view' }));
    mocks.owner = 'account-b'; mocks.rows = [];
    rerender(<HomeContent />);
    expect(screen.queryByRole('slider')).toBeNull();
    expect(screen.getByTestId('sidebar-frame').textContent).toBe('');
    mocks.tier = 'free'; rerender(<HomeContent />);
    expect((screen.getByRole('button', { name: 'Replay · Pro' }) as HTMLButtonElement).disabled).toBe(true);
});

it('feeds heatmap only the frozen frame and keeps snapshot coverage independent of live updates', () => {
    mocks.rows[0] = { ...mocks.rows[0], id: 'cluster-z-early', originalId: 'early', storyCount: 15 };
    const { rerender } = render(<HomeContent />);
    act(() => { vi.advanceTimersByTime(1); });
    const liveScope = mocks.scope.mock.lastCall![0];
    const watchScope = mocks.alertScopes.mock.lastCall![0];
    fireEvent.click(screen.getByRole('button', { name: 'Freeze loaded view' }));
    fireEvent.change(screen.getByRole('slider', { name: 'Reporting cursor' }), { target: { value: '960' } });
    const density = () => JSON.parse(screen.getByTestId('density').textContent!);
    expect(density().features.map((feature: { properties: unknown }) => feature.properties)).toEqual([{ canonicalId: 'early', weight: 15 }]);
    // Live polling may load/fail/change its cap without replacing frozen coverage.
    mocks.loading = true; mocks.capped = false; mocks.error = 'Live update failed';
    mocks.rows = mocks.rows.map(row => ({ ...row, longitude: 80, storyCount: 99 }));
    rerender(<HomeContent />);
    expect(density().features[0].geometry.coordinates).toEqual([10, 42]);
    expect(density().features[0].properties.weight).toBe(15);
    expect(JSON.parse(screen.getByTestId('map-status').textContent!)).toMatchObject({ dataReady: true, isCapped: true, activityDataUnavailable: false, presentationOnly: true });
    expect(mocks.scope.mock.lastCall![0]).toEqual(liveScope);
    expect(mocks.alertScopes.mock.lastCall![0]).toEqual(watchScope);
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(screen.queryByText('Couldn’t refresh stories')).toBeNull();
    expect(screen.getByText(/Live update unavailable: Live update failed/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Retry live update' }) as HTMLButtonElement).disabled).toBe(true);
    mocks.loading = false; rerender(<HomeContent />);
    fireEvent.click(screen.getByRole('button', { name: 'Retry live update' }));
    expect(mocks.fetch).toHaveBeenCalledExactlyOnceWith(true);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss live update error' }));
    expect(mocks.dismiss).toHaveBeenCalledOnce();
    expect(density().features[0].properties.weight).toBe(15);
    mocks.loading = true; rerender(<HomeContent />);
    fireEvent.click(screen.getByRole('button', { name: 'Return live' }));
    expect(density().features).toHaveLength(2);
    expect(density().features[0].geometry.coordinates).toEqual([80, 42]);
    expect(JSON.parse(screen.getByTestId('map-status').textContent!)).toMatchObject({ dataReady: false, isCapped: false, activityDataUnavailable: true, presentationOnly: false });
});
