import { describe, expect, it } from 'vitest';
import { DrawingHistory, drawingDocument, drawingShortcut, emptyDrawingDocument, type DrawingDocument } from '@/components/map/draw/drawingHistory';
import { appendDrawingImport, duplicateDrawing, replaceDrawFeatures } from '@/components/map/draw/drawingOperations';

const original = (): DrawingDocument => ({ drawFeatures: [{ type: 'Feature', id: '4bbcc679-10b9-4544-a193-ab96cc3b6e78',
  geometry: { type: 'LineString', coordinates: [[10, 20], [11, 21]] },
  properties: { mode: 'freehand-linestring', color: '#ef4444', size: 8, fill: false, fillOpacity: 0 } }],
  textAnnotations: [{ id: 'text', lngLat: [12, 22], text: 'Example annotation', initialZoom: 5 }] });
const collection = (features: unknown[]) => ({ type: 'FeatureCollection', features });

describe('bounded drawing document history', () => {
  it('roundtrips draw, move, vertices, style, text, erase, duplicate, delete, import and clear as complete documents', () => {
    const history = new DrawingHistory();
    const documents: DrawingDocument[] = [emptyDrawingDocument(), original()];
    history.commit(documents[1], 'Draw');
    const apply = (label: string, change: (doc: DrawingDocument) => void) => {
      const next = history.document; change(next); documents.push(structuredClone(next)); history.commit(next, label);
    };
    apply('Drag', doc => { if (doc.drawFeatures[0].geometry.type === 'LineString') doc.drawFeatures[0].geometry.coordinates = [[15, 20], [16, 21]]; });
    apply('Vertex', doc => { if (doc.drawFeatures[0].geometry.type === 'LineString') doc.drawFeatures[0].geometry.coordinates.push([17, 22]); });
    apply('Style', doc => { doc.drawFeatures[0].properties.color = '#10b981'; });
    apply('Text', doc => { doc.textAnnotations[0].text = 'Updated'; });
    apply('Duplicate', doc => { Object.assign(doc, duplicateDrawing(doc, String(doc.drawFeatures[0].id))!.document); });
    apply('Delete', doc => { doc.textAnnotations = []; });
    apply('Erase', doc => { doc.drawFeatures.shift(); });
    apply('Import', doc => { Object.assign(doc, appendDrawingImport(doc, collection(original().drawFeatures), 5)); });
    apply('Clear', doc => { doc.drawFeatures = []; doc.textAnnotations = []; });
    for (let index = documents.length - 2; index >= 0; index--) expect(history.undo()).toEqual(documents[index]);
    expect(history.undo()).toBeNull();
    for (let index = 1; index < documents.length; index++) expect(history.redo()).toEqual(documents[index]);
    expect(history.redo()).toBeNull();
  });
  it('excludes selection handles, provisional sketches and transient properties', () => {
    const doc = original();
    const history = new DrawingHistory(doc);
    const selected = structuredClone(doc.drawFeatures[0]); selected.properties.selected = true; selected.properties.edited = true;
    const handle = structuredClone(selected); handle.id = 'helper'; handle.properties.selectionPoint = true;
    const unfinished = structuredClone(selected); unfinished.id = 'unfinished'; unfinished.properties.currentlyDrawing = true;
    expect(history.commit(drawingDocument([selected, handle, unfinished], doc.textAnnotations), 'Selection')).toBe(false);
    expect(history.canUndo).toBe(false);
  });
  it('clears redo on a new edit, but no-op selection and restoration preserve redo', () => {
    const history = new DrawingHistory(original());
    history.commit(emptyDrawingDocument(), 'Clear'); history.undo();
    expect(history.commit(original(), 'Style reload')).toBe(false);
    expect(history.canRedo).toBe(true);
    const next = original(); next.textAnnotations[0].text = 'Changed';
    history.commit(next, 'Text'); expect(history.canRedo).toBe(false);
    history.undo(); expect(history.discardRedo()).toBe(true); expect(history.canRedo).toBe(false);
    expect(history.discardRedo()).toBe(false);
  });
  it('owns immutable copies and bounds history by both operation count and byte budget', () => {
    const source = original(); const history = new DrawingHistory(source, 2);
    source.textAnnotations[0].text = 'Caller mutation';
    expect(history.document).toEqual(original());
    for (let index = 0; index < 5; index++) { const next = original(); next.textAnnotations[0].text = String(index); history.commit(next, 'Text'); }
    expect(history.undo()).not.toBeNull(); expect(history.undo()).not.toBeNull(); expect(history.undo()).toBeNull();
    const small = new DrawingHistory(original(), 50, 1); small.commit(emptyDrawingDocument(), 'Clear');
    expect(small.canUndo).toBe(false); expect(small.document).toEqual(emptyDrawingDocument());
    history.reset(); expect(history.canRedo).toBe(false); expect(history.canUndo).toBe(false);
  });
});

describe('atomic drawing operations', () => {
  it('duplicates shape and text with retained style, offset geometry, fresh unique IDs, and no original mutation', () => {
    const source = original();
    const shape = duplicateDrawing(source, String(source.drawFeatures[0].id))!;
    const text = duplicateDrawing(shape.document, 'text')!;
    const ids = [...text.document.drawFeatures.map(feature => feature.id), ...text.document.textAnnotations.map(annotation => annotation.id)];
    expect(new Set(ids).size).toBe(ids.length);
    expect(shape.document.drawFeatures[1].properties).toEqual(source.drawFeatures[0].properties);
    expect(shape.document.drawFeatures[1].geometry).not.toEqual(source.drawFeatures[0].geometry);
    expect(text.document.textAnnotations[1].text).toEqual(source.textAnnotations[0].text);
    expect(source).toEqual(original());
  });
  it('imports generic GeoJSON without mode, renews repeated IDs, preserves text representation and rejects invalid input unchanged', () => {
    const doc = original();
    const point = { type: 'Feature', id: 'same', geometry: { type: 'Point', coordinates: [10, 20] }, properties: { color: '#ef4444' } };
    const result = appendDrawingImport(doc, collection([point, point, { ...point, properties: { isText: true, text: 'Imported', initialZoom: 4 } }]), 5);
    expect(result.drawFeatures.at(-1)?.properties.mode).toBe('point');
    expect(new Set(result.drawFeatures.map(feature => feature.id)).size).toBe(3);
    expect(result.textAnnotations.at(-1)?.text).toBe('Imported');
    for (const bad of [{ ...point, geometry: { type: 'Point', coordinates: [0, 91] } },
      { ...point, properties: { mode: 'unsupported' } }, { ...point, properties: { size: -1 } }]) {
      expect(() => appendDrawingImport(doc, collection([point, bad]), 5)).toThrow();
      expect(doc).toEqual(original());
    }
  });
  it('rolls back TerraDraw partial batch acceptance and leaves history unchanged after rejected import', () => {
    let stored = original().drawFeatures;
    const draw = { getSnapshot: () => structuredClone(stored), setMode: () => {},
      removeFeatures: (ids: (string | number)[]) => { stored = stored.filter(feature => !ids.includes(feature.id!)); },
      addFeatures: (features: typeof stored) => features.map(feature => {
        if (feature.properties.mode === 'circle' && feature.geometry.type === 'LineString') return { valid: false, reason: 'Invalid circle' };
        stored.push(structuredClone(feature)); return { id: feature.id, valid: true };
      }) };
    const history = new DrawingHistory(original());
    const batch = appendDrawingImport(original(), collection([{ ...original().drawFeatures[0], properties: { mode: 'circle' } }]), 5);
    expect(() => replaceDrawFeatures(draw, batch.drawFeatures)).toThrow('Invalid circle');
    expect(stored).toEqual(original().drawFeatures); expect(history.canUndo).toBe(false);
  });
});

it('only claims undo, redo and delete when drawing owns focus, leaving native editors and IME alone', () => {
  const key = (key: string, shiftKey = false) => ({ key, ctrlKey: true, metaKey: false, shiftKey, altKey: false, isComposing: false });
  expect(drawingShortcut(key('z'), true, false)).toBe('undo');
  expect(drawingShortcut(key('Z', true), true, false)).toBe('redo');
  expect(drawingShortcut({ ...key('y'), ctrlKey: false, metaKey: true }, true, false)).toBe('redo');
  expect(drawingShortcut(key('z'), false, false)).toBeNull();
  expect(drawingShortcut(key('z'), true, true)).toBeNull();
  expect(drawingShortcut({ ...key('z'), isComposing: true }, true, false)).toBeNull();
  expect(drawingShortcut({ ...key('Backspace'), ctrlKey: false }, true, false)).toBe('delete');
});
