import { viewportRegion } from '@/features/browser-geofence/region';
import type { Watch } from '@/features/browser-geofence/store';

export const id = (n: number) => `11111111-1111-4111-8111-${String(n).padStart(12, '0')}`;
export const scope = { sources: ['news', 'reddit', 'x', 'telegram', 'extra'], categories: ['all'], credibilityTiers: [1, 2, 3], minVolume: 1, query: '' };
export const now = Date.UTC(2026, 8, 30, 7, 2);
export function watch(n = 1): Watch {
  return { region: viewportRegion({ minLat: 0, maxLat: 20, minLng: 0, maxLng: 20 }, 'Private region', id(n), now),
    scope, enabled: true, checkpoint: null, state: 'baseline', failures: 0, nextCheckAt: 0 };
}
export function news(ids: number[] = [1], meta: Record<string, unknown> = {}) {
  return { items: ids.map(n => ({ id: id(n), longitude: 10, latitude: 10, publishedAt: '2000-01-01' })),
    lastUpdated: new Date().toISOString(), meta: { view: 'sidebar', scope: 'viewport', clustered: false, stale: false, isCapped: false, ...meta } };
}
export const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
