import { booleanPointInPolygon } from '@turf/boolean-point-in-polygon';
import { booleanWithin } from '@turf/boolean-within';
import { kinks } from '@turf/kinks';
import { polygon } from '@turf/helpers';
import type { Polygon, MultiPolygon, Position } from 'geojson';
import type { BBox } from '@/lib/core/types';

export interface RegionSpec {
  version: 1;
  id: string;
  name: string;
  geometry: Polygon | MultiPolygon;
  createdAt: string;
}
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const validDate = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));
export function regionPolygons(region: RegionSpec): Position[][][] {
  return region.geometry.type === 'Polygon' ? [region.geometry.coordinates] : region.geometry.coordinates;
}

/** Antimeridian geometries must be split into bounded polygons at +/-180. */
export function validateRegion(value: unknown): value is RegionSpec {
  if (!value || typeof value !== 'object') return false;
  const r = value as RegionSpec;
  if (r.version !== 1 || typeof r.id !== 'string' || !UUID.test(r.id) ||
      typeof r.name !== 'string' || !r.name.trim() || r.name.length > 60 || !validDate(r.createdAt) ||
      !r.geometry || !['Polygon', 'MultiPolygon'].includes(r.geometry.type)) return false;
  try {
    const polygons = regionPolygons(r);
    if (!Array.isArray(polygons) || !polygons.length || polygons.length > 4) return false;
    let vertices = 0;
    for (const rings of polygons) {
      if (!Array.isArray(rings) || !rings.length || rings.length > 9) return false;
      for (const ring of rings) {
        if (!Array.isArray(ring) || ring.length < 4 || (vertices += ring.length) > 128) return false;
        if (ring.some(p => !Array.isArray(p) || p.length !== 2 || !Number.isFinite(p[0]) ||
            !Number.isFinite(p[1]) || Math.abs(p[0]) > 180 || Math.abs(p[1]) > 90)) return false;
        if (ring[0][0] !== ring.at(-1)![0] || ring[0][1] !== ring.at(-1)![1]) return false;
        if (ring.slice(1).some((p, i) => Math.abs(p[0] - ring[i][0]) > 180)) return false;
        if (kinks(polygon([ring])).features.length) return false;
        const area = ring.slice(1).reduce((sum, p, i) => sum + ring[i][0] * p[1] - p[0] * ring[i][1], 0);
        if (Math.abs(area) < 1e-8) return false;
      }
      const outer = polygon([rings[0]]);
      for (let i = 1; i < rings.length; i++) {
        if (!booleanWithin(polygon([rings[i]]), outer)) return false;
        for (let j = 1; j < i; j++) {
          // Also rejects overlapping or nested holes.
          if (rings[i].some(p => booleanPointInPolygon(p, polygon([rings[j]]))) ||
              rings[j].some(p => booleanPointInPolygon(p, polygon([rings[i]]))) ||
              kinks(polygon([rings[i], rings[j]])).features.length) return false;
        }
      }
      const points = rings[0];
      if (Math.max(...points.map(p => p[0])) - Math.min(...points.map(p => p[0])) > 60 ||
          Math.max(...points.map(p => p[1])) - Math.min(...points.map(p => p[1])) > 60) return false;
    }
    return true;
  } catch { return false; }
}

const rectangle = (west: number, east: number, south: number, north: number): Position[][] =>
  [[[west, south], [east, south], [east, north], [west, north], [west, south]]];
export function viewportRegion(bbox: BBox, name: string, id: string, now: number): RegionSpec {
  if (![bbox.minLng, bbox.maxLng, bbox.minLat, bbox.maxLat].every(Number.isFinite)) throw new Error('Map bounds are unavailable.');
  let width = bbox.maxLng - bbox.minLng;
  if (width < 0) width += 360;
  if (width <= 0 || width > 60 || bbox.maxLat <= bbox.minLat || bbox.maxLat - bbox.minLat > 60) {
    throw new Error('Zoom in: watches cover at most 60° in each direction.');
  }
  const west = ((bbox.minLng + 180) % 360 + 360) % 360 - 180;
  const east = west + width;
  const geometry: Polygon | MultiPolygon = east <= 180
    ? { type: 'Polygon', coordinates: rectangle(west, east, bbox.minLat, bbox.maxLat) }
    : { type: 'MultiPolygon', coordinates: [rectangle(west, 180, bbox.minLat, bbox.maxLat), rectangle(-180, east - 360, bbox.minLat, bbox.maxLat)] };
  const result: RegionSpec = { version: 1, id, name: name.trim(), geometry, createdAt: new Date(now).toISOString() };
  if (!validateRegion(result)) throw new Error('Invalid region or name (1–60 characters).');
  return result;
}
export function regionBounds(region: RegionSpec): BBox[] {
  return regionPolygons(region).map(rings => ({
    minLng: Math.min(...rings[0].map(p => p[0])), maxLng: Math.max(...rings[0].map(p => p[0])),
    minLat: Math.min(...rings[0].map(p => p[1])), maxLat: Math.max(...rings[0].map(p => p[1])),
  }));
}
export function containsEvent(region: RegionSpec, longitude: number, latitude: number): boolean {
  return Number.isFinite(longitude) && Number.isFinite(latitude) && regionPolygons(region)
    .some(rings => booleanPointInPolygon([longitude, latitude], polygon(rings)));
}
