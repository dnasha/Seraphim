/** Synthetic provider boundary for local browser QA. Never installed as an app route. */
import { useSyncExternalStore } from 'react';
import type { NewsItem } from '@/lib/core/types';
import type { UserTier } from '@/lib/entitlements';
import { mapActivityFixture } from '../../tests/fixtures/mapActivity';
export { sanitizeSyncedPreferences, DEFAULT_SYNCED_PREFERENCES } from '../../../src/hooks/useSyncedPreferences';

const capturedAt = Date.now();
export const fixtureRows: NewsItem[] = mapActivityFixture.map((item, index) => ({
    ...item,
    id: `10000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    ...(index % 20 === 0 ? { id: `cluster-z-${index}`, originalId: `10000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`, storyCount: 15 } : {}),
    publishedAt: new Date(capturedAt - [20, 12, 1][index % 3] * 3_600_000).toISOString(),
}));
let fixture = { tier: 'analyst' as UserTier, owner: 'fixture-account', rows: fixtureRows, loading: false, capped: true, error: null as string | null, theme: 'light' };
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const useFixture = () => useSyncExternalStore(subscribe, () => fixture);
export const changeFixture = (patch: Partial<typeof fixture>) => { fixture = { ...fixture, ...patch }; listeners.forEach(listener => listener()); };
export const calls = { feedScopes: [] as unknown[], bounds: [] as unknown[], fetches: [] as unknown[], preferences: [] as unknown[],
    prompts: 0, permission: 'default' as NotificationPermission, deliveries: [] as string[][],
    get owner() { return fixture.owner; }, get tier() { return fixture.tier; } };
export const useAuth = () => { const value = useFixture(); return { user: value.tier === 'guest' ? null : { id: value.owner }, isGuest: value.tier === 'guest', isLoading: false, showAuthModal: false, setShowAuthModal: () => {} }; };
export const useUserTier = () => ({ tier: useFixture().tier, isLoading: false });
export const useSyncedPreferences = () => ({ preferences: null, isLoaded: true, updatePreferences: (patch: unknown) => { calls.preferences.push(patch); } });
export const useTheme = () => ({ resolvedTheme: useFixture().theme, setTheme: (theme: string) => { document.documentElement.dataset.theme = theme; changeFixture({ theme }); } });
export const useSearchParams = () => new URLSearchParams(window.location.search);
export const usePathname = () => '/';
export const useRouter = () => ({ push: () => {} });
export const useNewsData = (scope: unknown) => {
    const value = useFixture(); calls.feedScopes.push(scope);
    return { news: value.rows, appliedSortMode: 'new', isLoading: value.loading, isCapped: value.capped, appliedLimit: 1000, error: value.error,
        lastUpdated: new Date(capturedAt - 60_000).toISOString(), fetchNews: (...args: unknown[]) => { calls.fetches.push(args); },
        onBoundsChange: (...args: unknown[]) => { calls.bounds.push(args); }, fetchEventDetails: () => {}, dismissError: () => changeFixture({ error: null }) };
};
