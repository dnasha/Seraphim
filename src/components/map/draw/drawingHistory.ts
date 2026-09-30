import type { TerraDraw } from 'terra-draw';
import type { TextAnnotation } from './drawPersistence';

export type DrawFeatures = ReturnType<TerraDraw['getSnapshot']>;
export interface DrawingDocument {
  drawFeatures: DrawFeatures;
  textAnnotations: TextAnnotation[];
}

export const emptyDrawingDocument = (): DrawingDocument => ({ drawFeatures: [], textAnnotations: [] });

const helperProperties = ['selectionPoint', 'midPoint', 'closingPoint', 'snappingPoint', 'coordinatePoint'];
const transientProperties = ['selected', 'edited', 'currentlyDrawing', 'selectionPointFeatureId',
  'coordinatePointFeatureId', 'coordinatePointIds', 'provisionalCoordinateCount', 'committedCoordinateCount'];

/** Selection handles and unfinished sketches never belong to a saved document. */
export function drawingDocument(drawFeatures: DrawFeatures, textAnnotations: TextAnnotation[]): DrawingDocument {
  return {
    drawFeatures: drawFeatures.filter(feature => !feature.properties.currentlyDrawing &&
      !helperProperties.some(key => feature.properties[key])).map(feature => {
      const copy = structuredClone(feature);
      for (const key of transientProperties) delete copy.properties[key];
      return copy;
    }),
    textAnnotations: structuredClone(textAnnotations),
  };
}

interface Entry { document: DrawingDocument; label: string; bytes: number }

/** Pure, session-only history. Call commit once at the end of a semantic operation. */
export class DrawingHistory {
  private current: DrawingDocument;
  private past: Entry[] = [];
  private future: Entry[] = [];
  constructor(initial: DrawingDocument = emptyDrawingDocument(),
    private readonly maxEntries = 50, private readonly maxBytes = 8 * 1024 * 1024) {
    this.current = drawingDocument(initial.drawFeatures, initial.textAnnotations);
  }
  get document() { return structuredClone(this.current); }
  get hasDrawings() { return this.current.drawFeatures.length > 0 || this.current.textAnnotations.length > 0; }
  get canUndo() { return this.past.length > 0; }
  get canRedo() { return this.future.length > 0; }
  get undoLabel() { return this.past.at(-1)?.label; }
  get redoLabel() { return this.future.at(-1)?.label; }
  get undoDocument() { return this.past.at(-1) ? structuredClone(this.past.at(-1)!.document) : null; }
  get redoDocument() { return this.future.at(-1) ? structuredClone(this.future.at(-1)!.document) : null; }
  reset(document: DrawingDocument = emptyDrawingDocument()) {
    this.current = drawingDocument(document.drawFeatures, document.textAnnotations);
    this.past = [];
    this.future = [];
  }
  discardRedo(): boolean {
    const changed = this.future.length > 0;
    this.future = [];
    return changed;
  }
  private entry(document: DrawingDocument, label: string): Entry {
    return { document: structuredClone(document), label, bytes: new TextEncoder().encode(JSON.stringify(document)).length };
  }
  private bound() {
    while (this.past.length + this.future.length > Math.max(0, this.maxEntries) ||
      [...this.past, ...this.future].reduce((sum, entry) => sum + entry.bytes, 0) > this.maxBytes) {
      if (this.past.length) this.past.shift();
      else if (this.future.length) this.future.shift();
      else break;
    }
  }
  commit(document: DrawingDocument, label: string): boolean {
    const next = drawingDocument(document.drawFeatures, document.textAnnotations);
    if (JSON.stringify(next) === JSON.stringify(this.current)) return false;
    this.past.push(this.entry(this.current, label));
    this.current = next;
    this.future = [];
    this.bound();
    return true;
  }
  undo(): DrawingDocument | null {
    const entry = this.past.pop();
    if (!entry) return null;
    this.future.push(this.entry(this.current, entry.label));
    this.current = entry.document;
    this.bound();
    return this.document;
  }
  redo(): DrawingDocument | null {
    const entry = this.future.pop();
    if (!entry) return null;
    this.past.push(this.entry(this.current, entry.label));
    this.current = entry.document;
    this.bound();
    return this.document;
  }
}

export function drawingShortcut(event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey' | 'isComposing'>,
  ownsFocus: boolean, editable: boolean): 'undo' | 'redo' | 'delete' | null {
  if (!ownsFocus || editable || event.altKey || event.isComposing) return null;
  const key = event.key.toLowerCase();
  if (event.ctrlKey || event.metaKey) {
    if (key === 'z') return event.shiftKey ? 'redo' : 'undo';
    if (key === 'y' && !event.shiftKey) return 'redo';
  } else if (key === 'delete' || key === 'backspace') return 'delete';
  return null;
}
