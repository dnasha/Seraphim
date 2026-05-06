import { NewsItem } from './types';

/**
 * Bounding Box representation for geographical filtering.
 */
export interface BBox {
    minLat: number;
    maxLat: number;
    minLng: number;
    maxLng: number;
    zoom?: number;
    forceRaw?: boolean;
    since?: string;
    until?: string;
    timeRange?: string;
    query?: string;
    sortMode?: string;
}

/**
 * Snaps a bounding box to a grid to maximize cache hits on the backend.
 */
export function snapBBox(b: BBox): BBox {
    const z = b.zoom || 5;
    const grid = z < 4 ? 20 : z < 7 ? 10 : z < 10 ? 5 : 2;
    return {
        ...b,
        minLat: Math.floor(b.minLat / grid) * grid,
        maxLat: Math.ceil(b.maxLat / grid) * grid,
        minLng: Math.floor(b.minLng / grid) * grid,
        maxLng: Math.ceil(b.maxLng / grid) * grid,
        zoom: Math.round(z),
    };
}

/**
 * Checks if a news item's coordinates fall within a bounding box.
 * Also handles search query filtering if present in the bbox options.
 */
export function isWithinBBox(item: NewsItem, bbox: BBox): boolean {
    if (bbox.query) {
        const q = bbox.query.toLowerCase();
        return item.title.toLowerCase().includes(q) || !!item.locationName?.toLowerCase().includes(q);
    }
    if (item.latitude == null || item.longitude == null) return false;
    
    // Handle antimeridian crossing (minLng > maxLng)
    if (bbox.minLng > bbox.maxLng) {
        return (item.latitude >= bbox.minLat && item.latitude <= bbox.maxLat) &&
               (item.longitude >= bbox.minLng || item.longitude <= bbox.maxLng);
    }
    
    return (
        item.latitude >= bbox.minLat && 
        item.latitude <= bbox.maxLat && 
        item.longitude >= bbox.minLng && 
        item.longitude <= bbox.maxLng
    );
}
