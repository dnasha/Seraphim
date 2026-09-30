import { drawingDocument, type DrawingDocument, type DrawFeatures } from './drawingHistory';
import { MAX_IMPORT_BYTES, MAX_IMPORT_FEATURES, validateImportedFeatures } from './importValidation';

/** Legacy device-wide payload: only read after an explicit user action. */
export const DRAW_STORAGE_KEY = 'seraphim-map-draw-tools-v1';
const ACCOUNT_STORAGE_PREFIX = 'seraphim-experiment-drawing-history-v2:';
export const drawingStorageKey = (ownerId: string) => `${ACCOUNT_STORAGE_PREFIX}${encodeURIComponent(ownerId)}`;

export interface TextAnnotation {
  id: string;
  lngLat: [number, number];
  text: string;
  initialZoom: number;
}
export interface PersistedDrawState extends DrawingDocument { version: number }
export interface DrawStorageResult { document: PersistedDrawState | null; error: string | null }

export const isValidTextAnnotation = (annotation: unknown): annotation is TextAnnotation => {
  if (!annotation || typeof annotation !== 'object') return false;
  const candidate = annotation as Partial<TextAnnotation>;
  return typeof candidate.id === 'string' && candidate.id.length > 0 && candidate.id.length <= 100
    && Array.isArray(candidate.lngLat) && candidate.lngLat.length === 2
    && candidate.lngLat.every(value => typeof value === 'number' && Number.isFinite(value))
    && Math.abs(candidate.lngLat[0]) <= 180 && Math.abs(candidate.lngLat[1]) <= 90
    && typeof candidate.text === 'string' && candidate.text.length <= 2000
    && typeof candidate.initialZoom === 'number' && Number.isFinite(candidate.initialZoom)
    && candidate.initialZoom >= 0 && candidate.initialZoom <= 24;
};

function validateDocument(value: unknown, version: number): PersistedDrawState {
  if (!value || typeof value !== 'object') throw new Error('Invalid drawing document.');
  const parsed = value as Partial<PersistedDrawState>;
  if (parsed.version !== version || !Array.isArray(parsed.drawFeatures) || !Array.isArray(parsed.textAnnotations)
    || parsed.drawFeatures.length + parsed.textAnnotations.length > MAX_IMPORT_FEATURES
    || !parsed.textAnnotations.every(isValidTextAnnotation)) throw new Error('Invalid drawing document.');
  // Old saves could contain the selection handles from TerraDraw's raw snapshot.
  const document = drawingDocument(parsed.drawFeatures as DrawFeatures, parsed.textAnnotations);
  validateImportedFeatures({ type: 'FeatureCollection', features: document.drawFeatures });
  const ids = [...document.drawFeatures.map(feature => feature.id), ...document.textAnnotations.map(text => text.id)];
  if (ids.some(id => typeof id !== 'string' || id.length === 0 || id.length > 100) || new Set(ids).size !== ids.length) {
    throw new Error('Invalid or duplicate drawing IDs.');
  }
  const modes = new Set(['polygon', 'rectangle', 'circle', 'point', 'linestring', 'freehand-linestring']);
  if (document.drawFeatures.some(feature => !modes.has(String(feature.properties?.mode)))) {
    throw new Error('Unsupported drawing mode.');
  }
  if (document.drawFeatures.some(feature => feature.geometry.type !==
    (feature.properties.mode === 'point' ? 'Point' :
      ['linestring', 'freehand-linestring'].includes(String(feature.properties.mode)) ? 'LineString' : 'Polygon'))) {
    throw new Error('Drawing mode does not match its geometry.');
  }
  return { version, ...document };
}

export function readDrawStorage(ownerId?: string | null, legacy = false): DrawStorageResult {
  if (typeof window === 'undefined' || (!ownerId && !legacy)) return { document: null, error: null };
  try {
    const raw = window.localStorage.getItem(legacy ? DRAW_STORAGE_KEY : drawingStorageKey(ownerId!));
    if (!raw) return { document: null, error: null };
    if (new TextEncoder().encode(raw).length > MAX_IMPORT_BYTES) throw new Error('Saved drawings exceed the 2 MB limit.');
    return { document: validateDocument(JSON.parse(raw), legacy ? 1 : 2), error: null };
  } catch {
    return { document: null, error: 'Saved drawings could not be loaded. The saved copy has been left untouched.' };
  }
}

export const readPersistedDrawState = (ownerId?: string | null) => readDrawStorage(ownerId).document;

/** Returns a visible error instead of silently losing the current document. History is never saved. */
export function persistDrawState(drawFeatures: DrawFeatures, annotations: TextAnnotation[], ownerId?: string | null): string | null {
  if (typeof window === 'undefined' || !ownerId) return null;
  try {
    const payload = { version: 2, ...drawingDocument(drawFeatures, annotations) };
    validateDocument(payload, 2);
    const raw = JSON.stringify(payload);
    if (new TextEncoder().encode(raw).length > MAX_IMPORT_BYTES) return 'Drawings exceed the 2 MB save limit. Export or remove some drawings.';
    window.localStorage.setItem(drawingStorageKey(ownerId), raw);
    return null;
  } catch {
    return 'Drawings could not be saved on this device. Your edits remain available in this session.';
  }
}

export function clearPersistedDrawState(ownerId?: string | null): string | null {
  if (typeof window === 'undefined' || !ownerId) return null;
  try { window.localStorage.removeItem(drawingStorageKey(ownerId)); return null; }
  catch { return 'Saved drawings could not be deleted on this device.'; }
}

export function hasSavedDrawings(ownerId?: string | null): boolean {
  if (typeof window === 'undefined') return false;
  try { return Boolean(window.localStorage.getItem(ownerId ? drawingStorageKey(ownerId) : DRAW_STORAGE_KEY)); }
  catch { return false; }
}
