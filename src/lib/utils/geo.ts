/*
  Geographic Utilities
  
  Provides core functions for coordinate manipulation, bounding box 
  calculations, and spatial visibility checks. These utilities ensure
  consistent map behavior across the antimeridian and optimize 
  network performance through grid-based snapping.
*/

import { NewsItem, BBox } from '@/lib/core/types';

/**
 * Normalizes a longitude value to the range [-180, 180].
 * Uses a double modulo approach to handle both positive and negative 
 * wraparound cases correctly.
 */
function normalizeLng(lng: number): number {
    return ((lng + 180) % 360 + 360) % 360 - 180;
}

/**
 * Snaps a bounding box to a resolution-aware grid.
 * 
 * This increases the likelihood of cache hits on the backend by 
 * consolidating slightly different viewports into a single canonical 
 * grid square. The grid size decreases as the user zooms in to 
 * maintain precision.
 */
export function snapBBox(b: BBox): BBox {
    const z = b.zoom || 5;
    
    /** 
     * Global View: At low zoom levels, we fetch the entire globe to 
     * prevent continents from being partially hidden at the edges.
     */
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

    /** Grid sizing logic based on zoom level */
    const grid = z < 4 ? 20 : z < 7 ? 10 : z < 10 ? 5 : 2;
    
    const snappedMinLat = Math.max(-90, Math.floor(b.minLat / grid) * grid);
    const snappedMaxLat = Math.min(90, Math.ceil(b.maxLat / grid) * grid);
    
    const snappedMinLngRaw = Math.floor(b.minLng / grid) * grid;
    const snappedMaxLngRaw = Math.ceil(b.maxLng / grid) * grid;

    /** 
     * Wraparound Guard: If the box width exceeds 360 degrees, 
     * we treat it as a full-globe request.
     */
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
 * Determines if a news item's location is within the specified bounding box.
 * 
 * Handles complex edge cases including:
 * 1. Global Viewports: Bypasses longitude checks when the whole world is visible.
 * 2. Antimeridian Crossing: Correctly identifies visibility when the bounding 
 *    box spans from positive to negative longitudes (e.g., across the Pacific).
 * 3. Real-time Filtering: Applies search query matches if a query is present.
 */
export function isWithinBBox(item: NewsItem, bbox: BBox): boolean {
    if (item.latitude == null || item.longitude == null) return false;
    
    /** 
     * Text Search: Item must match the query string in title, 
     * location, or description.
     */
    if (bbox.query) {
        const q = bbox.query.toLowerCase();
        const matchesQuery = item.title.toLowerCase().includes(q) || 
                           (item.locationName || '').toLowerCase().includes(q) ||
                           (item.description || '').toLowerCase().includes(q);
        if (!matchesQuery) return false;
    }
    
    /** 
     * Wide Viewport Optimization: Skip longitude checks if the zoom 
     * is low or the width covers the globe.
     */
    if ((bbox.zoom !== undefined && bbox.zoom < 3) || (bbox.maxLng - bbox.minLng >= 360)) {
        return item.latitude >= bbox.minLat && item.latitude <= bbox.maxLat;
    }

    const itemLng = normalizeLng(item.longitude);
    const minLng = normalizeLng(bbox.minLng);
    const maxLng = normalizeLng(bbox.maxLng);
    
    /** 
     * Antimeridian Logic: If minLng > maxLng, the box crosses the 180/-180 line.
     * Visibility is determined by being either >= minLng OR <= maxLng.
     */
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
