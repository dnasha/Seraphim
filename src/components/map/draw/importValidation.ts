import type { Feature, Point, LineString, Polygon } from 'geojson';

export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
export const MAX_IMPORT_FEATURES = 1000;
const MAX_VERTICES = 50_000;

export function validateImportedFeatures(value: unknown): Array<Feature<Point | LineString | Polygon>> {
  if (!value || typeof value !== 'object') throw new Error('Choose a GeoJSON FeatureCollection.');
  const collection = value as Record<string, unknown>;
  if (collection.type !== 'FeatureCollection' || !Array.isArray(collection.features)) {
    throw new Error('Choose a GeoJSON FeatureCollection.');
  }
  if (collection.features.length > MAX_IMPORT_FEATURES) throw new Error('Import up to 1,000 features at a time.');
  let vertices = 0;
  const position = (input: unknown): boolean => {
    if (!Array.isArray(input) || input.length < 2 || input.length > 3) return false;
    vertices++;
    return vertices <= MAX_VERTICES && input.every(v => typeof v === 'number' && Number.isFinite(v)) &&
      Math.abs(input[0]) <= 180 && Math.abs(input[1]) <= 90;
  };
  for (const feature of collection.features) {
    if (!feature || feature.type !== 'Feature' || !feature.geometry ||
        (feature.properties != null && (typeof feature.properties !== 'object' || Array.isArray(feature.properties)))) {
      throw new Error('Every feature must have a supported geometry and valid properties.');
    }
    const { type, coordinates } = feature.geometry;
    let valid = false;
    if (type === 'Point') valid = position(coordinates);
    if (type === 'LineString') valid = Array.isArray(coordinates) && coordinates.length >= 2 && coordinates.every(position);
    if (type === 'Polygon') {
      valid = Array.isArray(coordinates) && coordinates.length > 0 && coordinates.every((ring: unknown) =>
        Array.isArray(ring) && ring.length >= 4 && ring.every(position) &&
        ring[0][0] === ring.at(-1)[0] && ring[0][1] === ring.at(-1)[1]);
    }
    if (!valid) throw new Error('Use valid points, lines, or closed polygons with at most 50,000 vertices.');
    if (feature.properties?.isText && (type !== 'Point' || typeof feature.properties.text !== 'string' ||
        feature.properties.text.length > 2000 || (feature.properties.initialZoom != null &&
        (typeof feature.properties.initialZoom !== 'number' || !Number.isFinite(feature.properties.initialZoom) ||
         feature.properties.initialZoom < 0 || feature.properties.initialZoom > 24)))) {
      throw new Error('Text annotations must be points with text up to 2,000 characters and a valid zoom.');
    }
  }
  return collection.features as Array<Feature<Point | LineString | Polygon>>;
}
