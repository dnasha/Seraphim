/**
 * GEOCODING ENRICHER
 * 
 * This module integrates the geocoding engine with the data pipeline.
 * It processes news items, extracts geographic metadata, and resolves
 * coordinates.
 * 
 * Key Features:
 * - Mass enrichment of news items.
 * - Canonical coordinates; visual offsets belong exclusively to the map client.
 */

import { NewsItem } from '@/lib/core/types';
import { extractLocation, geocodeLocation } from './engine';

/**
 * Enriches an array of news items with geographic data.
 * If coordinates are already present, the item is skipped.
 */
export async function enrichItemsWithLocation(items: NewsItem[]): Promise<NewsItem[]> {
    const enriched: NewsItem[] = [];
    for (const item of items) {
        if (item.latitude != null && item.longitude != null) {
            enriched.push(item);
            continue;
        }

        if (!item || typeof item !== 'object') continue;
        const toStr = (v: unknown) => {
            if (v === null || v === undefined) return '';
            if (typeof v === 'string') return v;
            try { return String(v); } catch { return ''; }
        };
        const title = toStr(item.title);
        const description = toStr(item.description);
        const ext = extractLocation(title, description);
        const placeName = ext.match;
        const candidates = ext.candidates;

        if (!placeName) {
            enriched.push({ ...item, foundLocations: candidates });
            continue;
        }

        const geo = await geocodeLocation(placeName);

        if (geo) {
            enriched.push({
                ...item,
                latitude: geo.lat,
                longitude: geo.lon,
                locationName: geo.displayName,
                foundLocations: candidates,
            });
        } else {
            enriched.push({ ...item, foundLocations: candidates });
        }
    }

    return enriched;
}
