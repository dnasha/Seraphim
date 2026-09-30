/** Browser QA only. No authentication, database, map tiles, or external network. */
import React, { useSyncExternalStore, useEffect, type ComponentProps, type ReactNode } from 'react';
import type { NewsItem } from '@/lib/core/types';
import type { UserTier } from '@/lib/entitlements';

const capturedAt = Date.now();
export const fixtureRows: NewsItem[] = [20, 12, 1].map((hoursAgo, index) => ({
    id: index === 1 ? 'cluster-z-fixture' : `fixture-${index + 1}`,
    ...(index === 1 ? { originalId: 'fixture-2', clusterSize: 5 } : {}),
    title: ['Harbor reporting begins', 'Regional reporting expands', 'Latest reporting update'][index],
    description: 'Synthetic reporting for replay QA. Current details retained explicitly.',
    source: 'Fixture publisher', sourceType: 'rss', url: 'https://example.com/fixture',
    publishedAt: new Date(capturedAt - hoursAgo * 3_600_000).toISOString(),
    latitude: 45 + index, longitude: 15 + index,
    sourcesCount: 2,
    sources: [hoursAgo, Math.max(0.5, hoursAgo - 1)].map((hours, source) => ({ name: `Fixture publisher ${source}`, url: `https://example.com/fixture/${source}`, sourceType: 'rss', discoveredAt: new Date(capturedAt - hours * 3_600_000).toISOString() })),
}));
let fixture = { tier: 'pro' as UserTier, owner: 'fixture-account', rows: fixtureRows };
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const useFixture = () => useSyncExternalStore(subscribe, () => fixture);
export const changeFixture = (next: Partial<typeof fixture>) => { fixture = { ...fixture, ...next }; listeners.forEach(listener => listener()); };
export const useAuth = () => { const value = useFixture(); return { user: value.tier === 'guest' ? null : { id: value.owner }, isGuest: value.tier === 'guest', isLoading: false, showAuthModal: false, setShowAuthModal: () => {} }; };
export const useUserTier = () => ({ tier: useFixture().tier, isLoading: false });
export const sanitizeSyncedPreferences = (value: unknown) => value;
export const useSyncedPreferences = () => ({ preferences: null, isLoaded: true, updatePreferences: () => {} });
export const useTheme = () => ({ resolvedTheme: 'light', setTheme: () => {} });
export const useSearchParams = () => new URLSearchParams(window.location.search);
export const usePathname = () => '/';
export const useRouter = () => ({ push: () => {} });
export const useNewsData = () => ({ news: useFixture().rows, appliedSortMode: 'new', isLoading: false, isCapped: true, appliedLimit: 1000, lastUpdated: '2026-09-30T11:30:00Z', fetchNews: () => {}, onBoundsChange: () => {}, fetchEventDetails: () => {} });
export const Image = ({ src, alt, width, height }: ComponentProps<'img'>) => <img src={src} alt={alt} width={width} height={height} />; // eslint-disable-line @next/next/no-img-element
export const Link = ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>;
export const Null = () => null;
export const Dynamic = () => function MapFixture({ items, selectedItemId, onSelectItem, onLoadStateChange }: { items: NewsItem[]; selectedItemId: string | null; onSelectItem: (id: string) => void; onLoadStateChange?: (state: 'ready') => void }) {
    useEffect(() => { onLoadStateChange?.('ready'); }, [onLoadStateChange]);
    return <div className="fixture-map"><h2>Loaded map presentation</h2><p>WebGL and network services mocked</p><div data-testid="map-rows">{items.map(item => <button key={item.id} onClick={() => onSelectItem(item.originalId || item.id)}>{item.title}</button>)}</div><p>Selected: <span data-testid="selected-id">{selectedItemId}</span></p></div>;
};
