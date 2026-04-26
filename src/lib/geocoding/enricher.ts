import { NewsItem } from '../types';
import { extractLocation, geocodeLocation } from './engine';
import { NEWS_SOURCE_DEFAULTS } from './constants';

/*
 * Dan Sharan
 * geocoding enricher: attaches coordinates to news items
 * implements golden-angle spiral jitter to prevent pin stacking
 */


export async function enrichItemsWithLocation(items: NewsItem[]): Promise<NewsItem[]> {
    const enriched: NewsItem[] = [];
    const usedCoords = new Map<string, number>();

    for (const item of items) {
        if (item.latitude != null && item.longitude != null) {
            enriched.push(item);
            continue;
        }

        const ext = extractLocation(item.title, item.description ?? '');
        let placeName = ext.match;
        let candidates = ext.candidates;

        // fallback to news source default if no specific location is found
        if (!placeName && item.source) {
            const srcKey = item.source.toLowerCase().trim();
            placeName = NEWS_SOURCE_DEFAULTS[srcKey] || null;
            if (placeName) candidates = [placeName]; // source default
        }

        if (!placeName) {
            enriched.push({ ...item, foundLocations: candidates });
            continue;
        }

        const geo = await geocodeLocation(placeName);

        if (geo) {
            // compute jitter to handle coordinate collisions
            const coordKey = `${geo.lat.toFixed(2)},${geo.lon.toFixed(2)}`;
            const count = usedCoords.get(coordKey) || 0;
            usedCoords.set(coordKey, count + 1);

            let lat = geo.lat;
            let lon = geo.lon;
            if (count > 0) {
                // golden-angle spiral jitter
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
