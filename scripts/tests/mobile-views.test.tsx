// @vitest-environment jsdom

import React, { forwardRef, useEffect, useImperativeHandle } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { HomeContent } from '@/components/layout/HomeContent';
import { COMPACT_LAYOUT_QUERY } from '@/hooks/useCompactLayout';
import { DEFAULT_SYNCED_PREFERENCES, type SyncedPreferences } from '@/hooks/useSyncedPreferences';
import type { NewsItem } from '@/lib/core/types';
import type { VirtuosoHandle } from 'react-virtuoso';

const mocks = vi.hoisted(() => ({
    initialState: {} as { eventId?: string },
    preferences: null as SyncedPreferences | null,
    user: { id: 'reader' },
    guest: false,
    updateURL: vi.fn(),
    updatePreferences: vi.fn(),
    fetchDetails: vi.fn(),
    setTheme: vi.fn(),
    mapMounted: vi.fn(),
    stories: ['First', 'Second'].map((name, index) => ({
        id: `story-${index + 1}`, title: `${name} story`, description: `${name} details`,
        url: `https://example.com/${index}`, source: 'Example', sourceType: 'rss' as const,
        publishedAt: new Date().toISOString(), latitude: 40 + index, longitude: -74,
    })),
}));

// Keep the real home state, sidebar, cards, and filter hooks; replace WebGL and
// virtual-list measurements, which jsdom cannot provide.
vi.mock('next/dynamic', () => ({ default: () => function MapDouble(props: {
    selectedItemId: string | null;
    onSelectItem: (id: string | null) => void;
}) {
    useEffect(() => { mocks.mapMounted(); }, []);
    return <div data-testid="map-instance">
        <output data-testid="map-selection">{props.selectedItemId ?? 'none'}</output>
        <button onClick={() => props.onSelectItem('story-2')}>Select map pin</button>
        <button onClick={() => props.onSelectItem(null)}>Close map pin</button>
    </div>;
} }));
vi.mock('react-virtuoso', () => ({ Virtuoso: forwardRef<VirtuosoHandle, {
    data: NewsItem[];
    itemContent: (index: number, item: NewsItem) => React.ReactNode;
}>(function ListDouble({ data, itemContent }, ref) {
    useImperativeHandle(ref, () => ({ scrollTo: vi.fn(), scrollToIndex: vi.fn() }) as unknown as VirtuosoHandle, []);
    return <div data-testid="story-list">{data.map((item, index) => <div key={item.id}>{itemContent(index, item)}</div>)}</div>;
}) }));
vi.mock('next-themes', () => ({ useTheme: () => ({ resolvedTheme: 'light', setTheme: mocks.setTheme }) }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({
    user: mocks.guest ? null : mocks.user, isGuest: mocks.guest, isLoading: false,
    setShowAuthModal: vi.fn(), showAuthModal: false,
}) }));
vi.mock('@/hooks/useUserTier', () => ({ useUserTier: () => ({ tier: mocks.guest ? 'guest' : 'free', isLoading: false }) }));
vi.mock('@/hooks/useViewState', () => ({ useViewState: () => ({ initialState: mocks.initialState, updateURL: mocks.updateURL }) }));
vi.mock('@/hooks/useSyncedPreferences', async importOriginal => ({
    ...await importOriginal<typeof import('@/hooks/useSyncedPreferences')>(),
    useSyncedPreferences: () => ({ preferences: mocks.preferences, isLoaded: true, updatePreferences: mocks.updatePreferences }),
}));
vi.mock('@/hooks/useNewsData', () => ({ useNewsData: () => ({
    news: mocks.stories, appliedSortMode: 'hot', isLoading: false,
    fetchEventDetails: mocks.fetchDetails, onBoundsChange: vi.fn(),
}) }));
vi.mock('@/components/layout/StartupGate', () => ({ default: ({ children }: { children: React.ReactNode }) => children }));
vi.mock('@/components/auth/UserButton', () => ({ default: () => null }));
vi.mock('@/components/ui/ThemeToggle', () => ({ default: () => null }));
vi.mock('@/components/ui/PWAInstallPrompt', () => ({ default: () => null }));
vi.mock('@/components/ui/FilterBar', () => ({ default: () => <span>Story filters</span> }));

let media: MediaQueryList;
let compact = true;

beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mocks.initialState = {};
    mocks.preferences = null;
    mocks.guest = false;
    compact = true;
    vi.stubGlobal('localStorage', { getItem: vi.fn(() => null), setItem: vi.fn() });
    media = new EventTarget() as MediaQueryList;
    Object.defineProperty(media, 'matches', { get: () => compact });
    vi.stubGlobal('matchMedia', vi.fn((query: string) => {
        expect(query).toBe(COMPACT_LAYOUT_QUERY);
        return media;
    }));
});

afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

const storiesView = () => screen.getByRole('complementary', { name: 'Stories' });
const mapView = () => screen.getByRole('main', { name: 'Map' });
const switchView = (name: 'Stories' | 'Map') => fireEvent.click(screen.getByRole('button', { name }));
const card = (name: 'First' | 'Second') => screen.getByRole('button', { name: new RegExp(`${name} story`) });

it('synchronizes story selection and closure in both directions without navigating away', () => {
    render(<HomeContent />);
    fireEvent.click(card('First'));
    expect(card('First').getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByTestId('map-selection').textContent).toBe('story-1');
    expect(storiesView().hasAttribute('inert')).toBe(false);
    expect(mapView().hasAttribute('inert')).toBe(true);

    switchView('Map');
    fireEvent.click(screen.getByRole('button', { name: 'Select map pin' }));
    expect(card('Second').getAttribute('aria-expanded')).toBe('true');
    expect(card('First').getAttribute('aria-expanded')).toBe('false');
    expect(storiesView().hasAttribute('inert')).toBe(true);
    expect(mapView().hasAttribute('inert')).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Close map pin' }));
    expect(card('Second').getAttribute('aria-expanded')).toBe('false');
    switchView('Stories');
    fireEvent.click(card('First'));
    fireEvent.click(card('First'));
    expect(screen.getByTestId('map-selection').textContent).toBe('none');
    expect(mocks.updateURL).toHaveBeenLastCalledWith({ eventId: undefined });
});

it('preserves mounted views, search, filters, and list scroll across tab switches', () => {
    render(<HomeContent />);
    const map = screen.getByTestId('map-instance');
    const list = screen.getByTestId('story-list');
    const search = screen.getByRole('textbox', { name: 'Search stories by keyword' }) as HTMLInputElement;
    fireEvent.change(search, { target: { value: 'current search' } });
    fireEvent.click(screen.getByRole('button', { name: 'Toggle filters' }));
    list.scrollTop = 240;
    switchView('Map');
    switchView('Stories');
    expect(screen.getByTestId('map-instance')).toBe(map);
    expect(screen.getByTestId('story-list')).toBe(list);
    expect(list.scrollTop).toBe(240);
    expect(search.value).toBe('current search');
    expect(screen.getByRole('button', { name: 'Toggle filters' }).getAttribute('aria-pressed')).toBe('true');
    expect(mocks.mapMounted).toHaveBeenCalledTimes(1);
    expect(mocks.updatePreferences).not.toHaveBeenCalledWith(expect.objectContaining({ sidebarOpen: expect.anything() }));
});

it('keeps a shared event selected and a saved desktop collapse independent of mobile navigation', () => {
    mocks.initialState = { eventId: 'story-2' };
    mocks.preferences = { ...DEFAULT_SYNCED_PREFERENCES, sidebarOpen: false };
    render(<HomeContent />);
    expect(storiesView().hasAttribute('inert')).toBe(false);
    expect(card('Second').getAttribute('aria-expanded')).toBe('true');
    switchView('Map');
    act(() => { compact = false; media.dispatchEvent(new Event('change')); });
    expect(storiesView().hasAttribute('inert')).toBe(true);
    expect(mapView().hasAttribute('inert')).toBe(false);
    expect(screen.getByRole('button', { name: 'Open sidebar' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open sidebar' }));
    expect(storiesView().hasAttribute('inert')).toBe(false);
    act(() => { compact = true; media.dispatchEvent(new Event('change')); });
    expect(storiesView().hasAttribute('inert')).toBe(true);
    expect(screen.getByTestId('map-selection').textContent).toBe('story-2');
    switchView('Stories');
    expect(card('Second').getAttribute('aria-expanded')).toBe('true');
});

it('lets guests switch views and dismiss a pin without an account', () => {
    mocks.guest = true;
    render(<HomeContent />);
    switchView('Map');
    fireEvent.click(screen.getByRole('button', { name: 'Select map pin' }));
    switchView('Stories');
    expect(card('Second').getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(card('Second'));
    expect(screen.getByTestId('map-selection').textContent).toBe('none');
});

it('routes keyboard search to Stories and keeps the mobile shortcut out of saved preferences', () => {
    render(<HomeContent />);
    fireEvent.keyDown(window, { key: 'm' });
    expect(mapView().hasAttribute('inert')).toBe(false);
    fireEvent.keyDown(window, { key: '/' });
    act(() => { vi.advanceTimersByTime(20); });
    expect(storiesView().hasAttribute('inert')).toBe(false);
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Search stories by keyword' }));
    expect(mocks.updatePreferences).not.toHaveBeenCalledWith(expect.objectContaining({ sidebarOpen: expect.anything() }));
});
