import type { NewsItem } from '@/lib/core/types';
import { canonicalNewsId } from '@/lib/utils/ranking';

export type ActivityPointProperties = { canonicalId: string; weight: number };
export type ActivityHeatmapData = GeoJSON.FeatureCollection<GeoJSON.Point, ActivityPointProperties>;

export function hasActivityCoordinates(item: NewsItem): boolean {
    return Number.isFinite(item.longitude) && Number.isFinite(item.latitude)
        && Math.abs(item.longitude!) <= 180 && Math.abs(item.latitude!) <= 90;
}

/** Counts events, never publisher/source volume. Aggregated rows are approximate. */
export function activityWeight(item: NewsItem): number {
    const count = item.storyCount;
    return typeof count === 'number' && Number.isSafeInteger(count) && count > 1 ? count : 1;
}

/** Use the displayed input, before pin jitter. No fetching, scope changes, or article payloads. */
export function buildActivityHeatmapData(items: readonly NewsItem[]): ActivityHeatmapData {
    const representatives = new Map<string, NewsItem>();
    for (const item of items) {
        if (!hasActivityCoordinates(item)) continue;
        const id = canonicalNewsId(item);
        // A selected detail may coexist with its map representative. Keep one
        // contribution, favoring the aggregate instead of adding it twice.
        const prior = representatives.get(id);
        if (!prior || activityWeight(item) > activityWeight(prior)) representatives.set(id, item);
    }
    return {
        type: 'FeatureCollection',
        features: Array.from(representatives, ([canonicalId, item]) => ({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [item.longitude!, item.latitude!] },
            properties: { canonicalId, weight: activityWeight(item) },
        })),
    };
}
