import { NEWS_CATEGORIES, NEWS_SOURCES, type NewsFilters } from '@/lib/utils/newsFilterParams';
import { UUID, validateRegion, type RegionSpec } from './region';

export const MAX_WATCHES = 3;
export const MAX_BYTES = 768_000;
export const MAX_OBSERVED_IDS = 3000;
export interface WatchScope extends Required<NewsFilters> { query: string }
export interface Watch {
  region: RegionSpec;
  scope: WatchScope;
  enabled: boolean;
  checkpoint: null | { seen: string[]; observed: string[]; checkedAt: number };
  failures: number;
  nextCheckAt: number;
  state: 'baseline' | 'live' | 'incomplete' | 'error' | 'paused' | 'history-full';
}
export interface AlertStore {
  version: 1;
  enabled: boolean;
  watches: Watch[];
  delivered: { id: string; at: number }[];
  lastDeliveryAt: number;
  nextCheckAt: number;
  failures: number;
}
export const storageKey = (account: string) => `seraphim:experiment:browser-geofence:v1:${account}`;
export const lockKey = (account: string) => storageKey(account) + ':lock';
export function emptyStore(): AlertStore {
  return { version: 1, enabled: false, watches: [], delivered: [], lastDeliveryAt: 0, nextCheckAt: 0, failures: 0 };
}
const timestamp = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x) && x >= 0;
const ids = (x: unknown, max: number): x is string[] => Array.isArray(x) && x.length <= max && x.every(id => typeof id === 'string' && UUID.test(id));
export function validScope(s: unknown): s is WatchScope {
  if (!s || typeof s !== 'object') return false;
  const scope = s as WatchScope;
  return typeof scope.query === 'string' && scope.query.length <= 160 &&
    Array.isArray(scope.sources) && scope.sources.length <= 5 && scope.sources.every(s => (NEWS_SOURCES as readonly string[]).includes(s)) &&
    Array.isArray(scope.categories) && scope.categories.length <= 9 && scope.categories.every(c => (NEWS_CATEGORIES as readonly string[]).includes(c)) &&
    Array.isArray(scope.credibilityTiers) && scope.credibilityTiers.length <= 3 && scope.credibilityTiers.every(t => [1, 2, 3].includes(t)) &&
    Number.isInteger(scope.minVolume) && scope.minVolume >= 1 && scope.minVolume <= 100000;
}
export function parseStore(raw: string | null): AlertStore {
  if (raw === null) return emptyStore();
  if (raw.length > MAX_BYTES) throw new Error('Local alert storage exceeds its quota. Delete local watches to recover.');
  try {
    const s = JSON.parse(raw) as AlertStore;
    if (s.version !== 1 || typeof s.enabled !== 'boolean' || !Array.isArray(s.watches) || s.watches.length > MAX_WATCHES ||
        !Array.isArray(s.delivered) || s.delivered.length > 3000 ||
        !s.delivered.every(d => d && typeof d.id === 'string' && UUID.test(d.id) && timestamp(d.at)) ||
        !timestamp(s.lastDeliveryAt) || !timestamp(s.nextCheckAt) || !Number.isInteger(s.failures) || s.failures < 0 || s.failures > 6 ||
        new Set(s.watches.map(w => w?.region?.id)).size !== s.watches.length ||
        !s.watches.every(w => w && validateRegion(w.region) && validScope(w.scope) && typeof w.enabled === 'boolean' &&
          ['baseline', 'live', 'incomplete', 'error', 'paused', 'history-full'].includes(w.state) &&
          (w.failures === undefined || (Number.isInteger(w.failures) && w.failures >= 0 && w.failures <= 6)) &&
          (w.nextCheckAt === undefined || timestamp(w.nextCheckAt)) &&
          (w.checkpoint === null || (w.checkpoint && ids(w.checkpoint.seen, 1000) && timestamp(w.checkpoint.checkedAt) &&
            (w.checkpoint.observed === undefined || ids(w.checkpoint.observed, MAX_OBSERVED_IDS)))))) throw new Error();
    // Copy only owned fields; unknown imported fields never become private notification data.
    return { version: 1, enabled: s.enabled, watches: s.watches.map(w => ({
      region: { version: 1, id: w.region.id, name: w.region.name, geometry: w.region.geometry, createdAt: w.region.createdAt },
      scope: { sources: w.scope.sources, categories: w.scope.categories, credibilityTiers: w.scope.credibilityTiers, minVolume: w.scope.minVolume, query: w.scope.query },
      enabled: w.enabled, state: w.state, failures: w.failures ?? 0, nextCheckAt: w.nextCheckAt ?? 0,
      // Upgrade this experiment's earlier v1 records, retaining known baseline identities.
      checkpoint: w.checkpoint ? { seen: w.checkpoint.seen, observed: w.checkpoint.observed ?? w.checkpoint.seen, checkedAt: w.checkpoint.checkedAt } : null,
    })), delivered: s.delivered, lastDeliveryAt: s.lastDeliveryAt, nextCheckAt: s.nextCheckAt, failures: s.failures };
  } catch { throw new Error('Local alert data is invalid. Delete local watches to recover.'); }
}
export function readStore(storage: Pick<Storage, 'getItem'>, account: string): AlertStore {
  return parseStore(storage.getItem(storageKey(account)));
}
export function writeStore(storage: Pick<Storage, 'setItem'>, account: string, store: AlertStore) {
  const raw = JSON.stringify(store);
  parseStore(raw);
  storage.setItem(storageKey(account), raw);
}
