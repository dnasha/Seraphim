/** Offline synthetic browser fixture. Never used by the production bundle. */
import React, { useEffect, useMemo, useSyncExternalStore } from 'react';
import type { NewsItem, BBox } from '../../../src/lib/core/types';
import { analystEvent, analystId, detailBody } from '../../tests/fixtures/analyst';
import type { UserTier } from '../../../src/lib/entitlements';

let owner: string | null = 'fixture-owner';
let tier: UserTier = 'analyst';
let eventRevision = 0;
const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
let version = 0;
export const qa = {
  setAccount: (next: string | null, nextTier: UserTier = 'analyst') => { owner = next; tier = nextTier; version++; listeners.forEach(fn => fn()); },
  updateLive: () => { eventRevision++; version++; listeners.forEach(fn => fn()); },
  getOwner: () => owner, getTier: () => tier,
  detail: (id: string) => {
    const index = Number(id.slice(-12));
    const event = analystEvent(index);
    return detailBody({ ...event, title: eventRevision ? `${event.title} — later live update` : event.title });
  },
  urlWrites: [] as unknown[], preferenceWrites: [] as unknown[],
};
function useVersion() { return useSyncExternalStore(subscribe, () => version); }
export function useAuth() {
  useVersion();
  return { user: owner ? { id: owner } : null, isLoading: false, isGuest: !owner, setShowAuthModal: () => {}, showAuthModal: false, supabase: {} };
}
export function useUserTier() { useVersion(); return { tier, isLoading: false }; }
const initialState = {};
export function useViewState() { return { initialState, updateURL: (value: unknown) => { qa.urlWrites.push(value); } }; }
export const sanitizeSyncedPreferences = (value: unknown) => value;
export function useSyncedPreferences() { return { preferences: null, isLoaded: true, updatePreferences: (value: unknown) => { qa.preferenceWrites.push(value); } }; }
export function useNewsData() {
  const revision = useVersion();
  const news = useMemo(() => {
  const items = [1, 2, 3].map(index => ({ ...analystEvent(index), publishedAt: new Date().toISOString(), title: revision ? `Fixture event ${index} — later live update` : `Fixture event ${index}` }));
  return [{ ...items[0], id: 'cluster-z4-fixture', originalId: analystId(), storyCount: 7 }, items[1], items[2]] as NewsItem[];
  }, [revision]);
  return { news, appliedSortMode: 'hot', isLoading: false, isCapped: true, appliedLimit: 1000, error: null, fetchNews: () => {}, onBoundsChange: () => {}, fetchEventDetails: async () => {} };
}
export const useRouter = () => ({ push: () => {}, replace: () => {}, refresh: () => {} });
export const usePathname = () => '/';
export const useSearchParams = () => new URLSearchParams();
export const useTheme = () => ({ resolvedTheme: 'light', setTheme: () => {} });
export default function Dynamic() {
  return function FixtureMap(props: { selectedItemId: string | null; onSelectItem: (id: string | null) => void; onLoadStateChange: (state: string) => void; onBoundsChange: (bbox: BBox) => void }) {
    const { onLoadStateChange } = props;
    useEffect(() => { onLoadStateChange('ready'); }, [onLoadStateChange]);
    return <div style={{ background: '#e7edf5', width: '100%', height: '100%', padding: 36 }}><h2>Synthetic map fixture</h2><p>WebGL and all services are mocked for this evidence-workspace QA.</p>
      <p data-testid="qa-map-selection">Active pin: {props.selectedItemId ?? 'none'}</p>
      <button onClick={() => props.onSelectItem('cluster-z4-fixture')}>Select aggregate map pin</button><button onClick={() => props.onSelectItem(analystId(2))}>Select second map pin</button></div>;
  };
}
