import { NewsItem, BBox } from '@/lib/core/types';

function normalizeLng(lng: number): number {
    return ((lng + 180) % 360 + 360) % 360 - 180;
}

/**
 * Snaps a bounding box to a grid to maximize cache hits on the backend.
 */
export function snapBBox(b: BBox): BBox {
    const z = b.zoom || 5;
    
    // At low zoom levels, fetch the entire globe to ensure no continents are cropped by viewport bounds
    if (z < 3) {
        return {
            ...b,
            minLat: -90,
            maxLat: 90,
            minLng: -180,
            maxLng: 180,
            zoom: Math.round(z),
        };
    }

    const grid = z < 4 ? 20 : z < 7 ? 10 : z < 10 ? 5 : 2;
    
    const snappedMinLat = Math.max(-90, Math.floor(b.minLat / grid) * grid);
    const snappedMaxLat = Math.min(90, Math.ceil(b.maxLat / grid) * grid);
    
    const snappedMinLngRaw = Math.floor(b.minLng / grid) * grid;
    const snappedMaxLngRaw = Math.ceil(b.maxLng / grid) * grid;

    // If the box width is >= 360, the viewport sees the whole world (or more).
    if (snappedMaxLngRaw - snappedMinLngRaw >= 360) {
        return {
            ...b,
            minLat: snappedMinLat,
            maxLat: snappedMaxLat,
            minLng: -180,
            maxLng: 180,
            zoom: Math.round(z),
        };
    }

    return {
        ...b,
        minLat: snappedMinLat,
        maxLat: snappedMaxLat,
        minLng: normalizeLng(snappedMinLngRaw),
        maxLng: normalizeLng(snappedMaxLngRaw),
        zoom: Math.round(z),
    };
}

/**
 * Checks if a news item's coordinates fall within a bounding box.
 * Also handles search query filtering if present in the bbox options.
 */
export function isWithinBBox(item: NewsItem, bbox: BBox): boolean {
    // Unmapped items are considered "global" and are handled by the mappedOnly filter instead.
    if (item.latitude == null || item.longitude == null) return true;
    
    // If a query is present, it must match. Note that applyNewsFilters also handles this, 
    // but we keep it here for real-time ingestion checks in useNewsData.
    if (bbox.query) {
        const q = bbox.query.toLowerCase();
        const matchesQuery = item.title.toLowerCase().includes(q) || 
                           (item.locationName || '').toLowerCase().includes(q) ||
                           (item.description || '').toLowerCase().includes(q);
        if (!matchesQuery) return false;
    }
    
    // At low zoom levels or full width, bypass longitude checks so no wrapped continents are hidden
    if ((bbox.zoom !== undefined && bbox.zoom < 3) || (bbox.maxLng - bbox.minLng >= 360)) {
        return item.latitude >= bbox.minLat && item.latitude <= bbox.maxLat;
    }

    const itemLng = normalizeLng(item.longitude);
    const minLng = normalizeLng(bbox.minLng);
    const maxLng = normalizeLng(bbox.maxLng);
    
    // Handle antimeridian crossing (minLng > maxLng)
    if (minLng > maxLng) {
        return (item.latitude >= bbox.minLat && item.latitude <= bbox.maxLat) &&
               (itemLng >= minLng || itemLng <= maxLng);
    }
    
    return (
        item.latitude >= bbox.minLat && 
        item.latitude <= bbox.maxLat && 
        itemLng >= minLng && 
        itemLng <= maxLng
    );
}
