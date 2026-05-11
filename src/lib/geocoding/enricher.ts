/**
 * GEOCODING ENRICHER
 * 
 * This module integrates the geocoding engine with the data pipeline.
 * It processes news items, extracts geographic metadata, and resolves
 * coordinates.
 * 
 * Key Features:
 * - Mass enrichment of news items.
 * - Golden-angle spiral jitter to prevent pin stacking for overlapping locations.
 * - Source-based default location fallbacks.
 */

import { NewsItem } from '@/lib/core/types';
import { extractLocation, geocodeLocation } from './engine';
import { NEWS_SOURCE_DEFAULTS } from './constants';

/**
 * Enriches an array of news items with geographic data.
 * If coordinates are already present, the item is skipped.
 */
export async function enrichItemsWithLocation(items: NewsItem[]): Promise<NewsItem[]> {
    const enriched: NewsItem[] = [];
    const usedCoords = new Map<string, number>();

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
        let placeName = ext.match;
        let candidates = ext.candidates;

        // Fallback to news source default if extraction yielded no results
        if (!placeName && item.source) {
            const srcKey = item.source.toLowerCase().trim();
            placeName = NEWS_SOURCE_DEFAULTS[srcKey] || null;
            if (placeName) candidates = [placeName];
        }

        if (!placeName) {
            enriched.push({ ...item, foundLocations: candidates });
            continue;
        }

        const geo = await geocodeLocation(placeName);

        if (geo) {
            // Coordinate Collision Handling:
            // When multiple news items share the exact same city/country coordinates,
            // they would stack perfectly on the map, making individual markers unclickable.
            const coordKey = `${geo.lat.toFixed(2)},${geo.lon.toFixed(2)}`;
            const count = usedCoords.get(coordKey) || 0;
            usedCoords.set(coordKey, count + 1);

            let lat = geo.lat;
            let lon = geo.lon;
            
            // Apply Golden-Angle Spiral Jitter:
            // This algorithm distributes overlapping markers in an aesthetically pleasing
            // spiral pattern (137.5 degrees) around the centroid, ensuring visibility
            // for all items in a cluster.
            if (count > 0) {
                const angle = (count * 137.5 * Math.PI) / 180;
                const radius = 0.15 + (count * 0.05);
                lat += radius * Math.cos(angle);
                lon += radius * Math.sin(angle);
            }

            enriched.push({
                ...item,
                latitude: lat,
                longitude: lon,
                locationName: placeName,
                foundLocations: candidates,
            });
        } else {
            enriched.push({ ...item, foundLocations: candidates });
        }
    }

    return enriched;
}
