export const DRAW_STORAGE_KEY = 'seraphim-map-draw-tools-v1';

export interface TextAnnotation {
  id: string;
  lngLat: [number, number];
  text: string;
  initialZoom: number;
}

export interface PersistedDrawState {
  version: number;
  drawFeatures: unknown[];
  textAnnotations: TextAnnotation[];
}

export const isValidTextAnnotation = (annotation: unknown): annotation is TextAnnotation => {
  if (!annotation || typeof annotation !== 'object') return false;
  const candidate = annotation as Partial<TextAnnotation>;
  return typeof candidate.id === 'string'
    && Array.isArray(candidate.lngLat)
    && candidate.lngLat.length === 2
    && typeof candidate.lngLat[0] === 'number'
    && typeof candidate.lngLat[1] === 'number'
    && typeof candidate.text === 'string'
    && typeof candidate.initialZoom === 'number';
};

export const readPersistedDrawState = (): PersistedDrawState | null => {
  if (typeof window === 'undefined') return null;

  try {
    const raw = window.localStorage.getItem(DRAW_STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as {
      version?: number;
      drawFeatures?: unknown;
      textAnnotations?: unknown;
    };

    if (!Array.isArray(parsed.drawFeatures) || !Array.isArray(parsed.textAnnotations)) {
      console.warn('Ignoring invalid persisted map annotations payload.');
      return null;
    }

    return {
      version: typeof parsed.version === 'number' ? parsed.version : 1,
      drawFeatures: parsed.drawFeatures,
      textAnnotations: parsed.textAnnotations.filter(isValidTextAnnotation),
    };
  } catch (err) {
    console.warn('Failed to load persisted map annotations:', err);
    return null;
  }
};

export const persistDrawState = (drawFeatures: unknown[], annotations: TextAnnotation[]) => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(DRAW_STORAGE_KEY, JSON.stringify({
      version: 1,
      drawFeatures,
      textAnnotations: annotations,
    }));
  } catch (err) {
    console.warn('Failed to persist map annotations:', err);
  }
};

export const clearPersistedDrawState = () => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(DRAW_STORAGE_KEY);
  } catch (err) {
    console.warn('Failed to clear persisted map annotations:', err);
  }
};
