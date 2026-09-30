import type { TerraDraw } from 'terra-draw';
import { drawingDocument, type DrawingDocument, type DrawFeatures } from './drawingHistory';
import { MAX_IMPORT_BYTES, MAX_IMPORT_FEATURES, validateImportedFeatures } from './importValidation';

export const newDrawingId = () => crypto.randomUUID();
const modes: Record<string, string> = { Point: 'point', LineString: 'linestring', Polygon: 'polygon' };
const supportedModes = new Set(['point', 'linestring', 'polygon', 'rectangle', 'circle', 'freehand-linestring']);
export const DRAW_COORDINATE_PRECISION = 9;
const roundPosition = (position: number[]) => position.map(value => Number(value.toFixed(DRAW_COORDINATE_PRECISION)));
function roundGeometry(feature: DrawFeatures[number]) {
  if (feature.geometry.type === 'Point') feature.geometry.coordinates = roundPosition(feature.geometry.coordinates);
  else if (feature.geometry.type === 'LineString') feature.geometry.coordinates = feature.geometry.coordinates.map(roundPosition);
  else feature.geometry.coordinates = feature.geometry.coordinates.map(ring => ring.map(roundPosition));
}

export function appendDrawingImport(current: DrawingDocument, value: unknown, zoom: number): DrawingDocument {
  const features = validateImportedFeatures(value);
  if (features.length + current.drawFeatures.length + current.textAnnotations.length > MAX_IMPORT_FEATURES) {
    throw new Error('The map can hold up to 1,000 features. Remove some drawings first.');
  }
  const next = structuredClone(current);
  for (const feature of features) {
    if (feature.properties?.isText && feature.geometry.type === 'Point') {
      next.textAnnotations.push({ id: newDrawingId(), text: feature.properties.text,
        lngLat: [feature.geometry.coordinates[0], feature.geometry.coordinates[1]],
        initialZoom: feature.properties.initialZoom ?? zoom });
    } else {
      const mode = feature.properties?.mode ?? modes[feature.geometry.type];
      if (!supportedModes.has(mode)) throw new Error('This GeoJSON contains an unsupported drawing mode.');
      // IDs from another document must never collide with an existing shape or text.
      const imported = { ...structuredClone(feature), id: newDrawingId(),
        properties: { ...feature.properties, mode } } as DrawFeatures[number];
      roundGeometry(imported);
      next.drawFeatures.push(imported);
    }
  }
  const document = drawingDocument(next.drawFeatures, next.textAnnotations);
  validateImportedFeatures({ type: 'FeatureCollection', features: document.drawFeatures });
  if (new TextEncoder().encode(JSON.stringify(document)).length > MAX_IMPORT_BYTES - 32) {
    throw new Error('The combined drawings exceed the 2 MB limit. Remove some drawings first.');
  }
  return document;
}

export function duplicateDrawing(current: DrawingDocument, id: string,
  offset: [number, number] = [0.05, 0.05]): { document: DrawingDocument; id: string } | null {
  if (current.drawFeatures.length + current.textAnnotations.length >= MAX_IMPORT_FEATURES) {
    throw new Error('The map can hold up to 1,000 features. Remove some drawings first.');
  }
  const next = structuredClone(current);
  const freshId = newDrawingId();
  const shift = (position: number[]) => [
    ((position[0] + offset[0] + 180) % 360 + 360) % 360 - 180,
    Math.max(-90, Math.min(90, position[1] + offset[1])), ...position.slice(2),
  ];
  const text = next.textAnnotations.find(annotation => annotation.id === id);
  if (text) next.textAnnotations.push({ ...structuredClone(text), id: freshId, lngLat: shift(text.lngLat) as [number, number] });
  else {
    const feature = next.drawFeatures.find(feature => feature.id === id);
    if (!feature) return null;
    const copy = structuredClone(feature);
    copy.id = freshId;
    if (copy.geometry.type === 'Point') copy.geometry.coordinates = shift(copy.geometry.coordinates);
    else if (copy.geometry.type === 'LineString') copy.geometry.coordinates = copy.geometry.coordinates.map(shift);
    else copy.geometry.coordinates = copy.geometry.coordinates.map(ring => ring.map(shift));
    roundGeometry(copy);
    next.drawFeatures.push(copy);
  }
  return { document: next, id: freshId };
}

/** TerraDraw can partially accept a batch; restore the original document on any rejection. */
export function replaceDrawFeatures(draw: Pick<TerraDraw, 'getSnapshot' | 'setMode' | 'removeFeatures' | 'addFeatures'>,
  features: DrawFeatures): void {
  const previous = drawingDocument(draw.getSnapshot(), []).drawFeatures;
  const load = (next: DrawFeatures) => {
    draw.setMode('static');
    const ids = draw.getSnapshot().map(feature => feature.id).filter((id): id is string | number => id !== undefined);
    if (ids.length) draw.removeFeatures(ids);
    const results = draw.addFeatures(structuredClone(next));
    const invalid = results.find(result => !result.valid);
    if (invalid || results.length !== next.length) throw new Error(invalid?.reason ?? 'Some drawings could not be loaded.');
  };
  try { load(features); }
  catch (error) {
    load(previous);
    throw error;
  }
}
