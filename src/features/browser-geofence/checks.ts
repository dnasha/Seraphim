import type { NewsItem, NewsResponse } from '@/lib/core/types';
import { appendNewsFilters, newsFilterKey } from '@/lib/utils/newsFilterParams';
import { canonicalNewsId } from '@/lib/utils/ranking';
import { containsEvent, regionBounds, UUID } from './region';
import { POLL_MS, type AlertStore, type Watch } from './store';

export class IncompleteCheck extends Error {}
export async function fetchWatch(watch: Watch, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<string[]> {
  const ids = new Set<string>();
  for (const bbox of regionBounds(watch.region)) {
    signal.throwIfAborted();
    const params = new URLSearchParams({
      view: 'sidebar', scope: 'viewport', force_raw: 'true', time_range: '1d', sort: 'new', limit: '1000',
      minLng: String(bbox.minLng), maxLng: String(bbox.maxLng), minLat: String(bbox.minLat), maxLat: String(bbox.maxLat),
    });
    appendNewsFilters(params, newsFilterKey(watch.scope));
    if (watch.scope.query) params.set('query', watch.scope.query);
    const response = await fetcher(`/api/news?${params}`, { signal, credentials: 'same-origin', cache: 'no-store' });
    if (!response.ok) throw new Error(response.status === 403 ? 'Saved filters are no longer available for this account.' : 'News check failed.');
    const data = await response.json() as NewsResponse;
    signal.throwIfAborted();
    if (!data || !Array.isArray(data.items) || data.items.length > 1000 || !data.meta || data.meta.isCapped !== false ||
        data.meta.stale !== false || data.meta.clustered !== false || data.meta.scope !== 'viewport' || data.meta.view !== 'sidebar' ||
        !Number.isFinite(Date.parse(data.lastUpdated)) || Date.now() - Date.parse(data.lastUpdated) > 10 * 60_000) {
      throw new IncompleteCheck('Result is incomplete or stale. Zoom in or narrow the saved filters.');
    }
    for (const item of data.items) {
      if (!item || typeof item.id !== 'string' || item.id.startsWith('cluster-z') || (item.storyCount ?? 1) > 1) {
        throw new IncompleteCheck('Aggregated events cannot establish region membership.');
      }
      const id = canonicalNewsId(item as NewsItem);
      if (!UUID.test(id) || !Number.isFinite(item.longitude) || !Number.isFinite(item.latitude)) {
        throw new IncompleteCheck('Event identity or location is unavailable.');
      }
      if (containsEvent(watch.region, item.longitude!, item.latitude!)) ids.add(id.toLowerCase());
    }
    if (ids.size > 1000) throw new IncompleteCheck('Combined region result exceeds the local checkpoint quota.');
  }
  return [...ids].sort();
}

/** Identity checkpoints use observed membership, never mutable publication timestamps. */
export function advanceWatch(watch: Watch, ids: string[], now: number): { watch: Watch; candidates: string[] } {
  const checkpoint = watch.checkpoint;
  // A first check or a gap beyond the query horizon establishes a new baseline.
  const baseline = !checkpoint || now - checkpoint.checkedAt >= 24 * 60 * 60_000;
  const seen = new Set(checkpoint?.seen ?? []);
  return {
    watch: { ...watch, checkpoint: { checkedAt: now, seen: ids }, state: 'live' },
    candidates: baseline ? [] : ids.filter(id => !seen.has(id)),
  };
}
export function reserveBatch(store: AlertStore, candidates: string[], now: number): string[] {
  store.delivered = store.delivered.filter(d => now - d.at < 48 * 60 * 60_000);
  const delivered = new Set(store.delivered.map(d => d.id));
  const fresh = [...new Set(candidates)].filter(id => !delivered.has(id));
  // Suppressed bursts are consumed too; no delayed backlog or repeated attempts.
  const room = 3000 - store.delivered.length;
  const accepted = fresh.slice(0, room);
  store.delivered.push(...accepted.map(id => ({ id, at: now })));
  if (now - store.lastDeliveryAt < POLL_MS || !accepted.length) return [];
  store.lastDeliveryAt = now;
  return accepted.slice(0, 20);
}
