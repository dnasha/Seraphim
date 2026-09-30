// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { HomeContent } from '@/components/layout/HomeContent';
import type { NewsItem } from '@/lib/core/types';

const mocks = vi.hoisted(() => ({
    params: new URLSearchParams('eventId=late&t=3d'),
    preferences: vi.fn(),
    fetch: vi.fn(),
    owner: 'account-a',
    tier: 'pro',
    rows: [] as NewsItem[],
}));
vi.mock('next/navigation', () => ({ useSearchParams: () => mocks.params, usePathname: () => '/' }));
vi.mock('next-themes', () => ({ useTheme: () => ({ resolvedTheme: 'light', setTheme: vi.fn() }) }));
vi.mock('next/dynamic', () => ({ default: () => function Map({ items, selectedItemId }: { items: NewsItem[]; selectedItemId: string | null }) {
    return <div><output data-testid="map-frame">{items.map(item => item.title).join(',')}</output><output data-testid="map-details">{items.map(item => item.description).join(",")}</output><span data-testid="selected-id">{selectedItemId}</span></div>;
} }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: mocks.owner }, isGuest: false, isLoading: false, showAuthModal: false }) }));
vi.mock('@/hooks/useUserTier', () => ({ useUserTier: () => ({ tier: mocks.tier, isLoading: false }) }));
vi.mock('@/hooks/useSyncedPreferences', () => ({ useSyncedPreferences: () => ({ preferences: null, isLoaded: true, updatePreferences: mocks.preferences }) }));
vi.mock('@/hooks/useNewsData', () => ({ useNewsData: () => ({ news: mocks.rows, appliedSortMode: 'new', isLoading: false, isCapped: false, fetchNews: mocks.fetch, onBoundsChange: mocks.fetch, fetchEventDetails: mocks.fetch }) }));
vi.mock('@/components/layout/StartupGate', () => ({ default: ({ children }: { children: React.ReactNode }) => children }));
vi.mock('@/components/auth/UserButton', () => ({ default: () => null }));
vi.mock('@/components/ui/PWAInstallPrompt', () => ({ default: () => null }));
vi.mock('@/components/ui/FilterBar', () => ({ default: () => null }));
vi.mock('@/components/ui/EventSidebar', () => ({ default: ({ items }: { items: NewsItem[] }) => <div data-testid="sidebar-frame">{items.map(item => item.title).join(',')}</div> }));

beforeEach(() => {
    vi.useFakeTimers(); vi.setSystemTime('2026-09-30T12:00:00Z'); vi.clearAllMocks();
    mocks.owner = 'account-a'; mocks.tier = 'pro';
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
    fireEvent.change(slider, { target: { value: String(Date.now() - 24 * 3_600_000) } });
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
    fireEvent.change(slider, { target: { value: String(Date.now()) } });
    expect(screen.getByTestId('map-details').textContent).toContain('Current hydrated details');
    fireEvent.change(slider, { target: { value: String(Date.now() - 24 * 3_600_000) } });
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
