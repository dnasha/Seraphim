// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DRAW_STORAGE_KEY, clearPersistedDrawState, drawingStorageKey, persistDrawState, readDrawStorage } from '@/components/map/draw/drawPersistence';
import type { DrawFeatures } from '@/components/map/draw/drawingHistory';
const features: DrawFeatures = [{ type: 'Feature', id: 'd171da70-dde6-4487-849c-55283c41d157',
  geometry: { type: 'Point', coordinates: [0, 0] }, properties: { mode: 'point', color: '#ef4444', size: 4 } }];
beforeEach(() => { localStorage.clear(); vi.restoreAllMocks(); });
describe('account-scoped drawing storage', () => {
  it('persists only the current document with version, isolates accounts, deletes the correct key, and does not touch legacy drawings', () => {
    const legacy = JSON.stringify({ version: 1, drawFeatures: features, textAnnotations: [] });
    localStorage.setItem(DRAW_STORAGE_KEY, legacy);
    expect(readDrawStorage('a').document).toBeNull();
    expect(persistDrawState(features, [], 'a')).toBeNull();
    expect(readDrawStorage('a').document?.drawFeatures).toEqual(features);
    expect(readDrawStorage('b').document).toBeNull();
    expect(JSON.parse(localStorage.getItem(drawingStorageKey('a'))!)).toEqual({ version: 2, drawFeatures: features, textAnnotations: [] });
    expect(clearPersistedDrawState('b')).toBeNull(); expect(readDrawStorage('a').document).not.toBeNull();
    clearPersistedDrawState('a'); expect(readDrawStorage('a').document).toBeNull();
    expect(localStorage.getItem(DRAW_STORAGE_KEY)).toBe(legacy);
    expect(readDrawStorage(null, true).document?.version).toBe(1);
    expect(persistDrawState(features, [])).toBeNull(); expect(localStorage.length).toBe(1);
  });
  it('rejects unknown versions, duplicate IDs, non-finite/out-of-range text coordinates and oversized payloads without rewriting storage', () => {
    const text = { id: 'text', lngLat: [0, 0], text: 'Example', initialZoom: 5 };
    for (const payload of [
      { version: 9, drawFeatures: features, textAnnotations: [] },
      { version: 2, drawFeatures: [...features, ...features], textAnnotations: [] },
      { version: 2, drawFeatures: features, textAnnotations: [{ ...text, lngLat: [0, 999] }] },
      { version: 2, drawFeatures: features, textAnnotations: [{ ...text, text: 'x'.repeat(2001) }] },
      { version: 2, drawFeatures: features, textAnnotations: [], unused: 'x'.repeat(2 * 1024 * 1024) },
    ]) {
      const raw = JSON.stringify(payload); localStorage.setItem(drawingStorageKey('a'), raw);
      expect(readDrawStorage('a').error).toBeTruthy(); expect(readDrawStorage('a').document).toBeNull();
      expect(localStorage.getItem(drawingStorageKey('a'))).toBe(raw);
    }
  });
  it('reports quota/access errors for save, load and deletion', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Full', 'QuotaExceededError'); });
    expect(persistDrawState(features, [], 'a')).toMatch(/could not be saved/);
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('Blocked'); });
    expect(readDrawStorage('a').error).toMatch(/could not be loaded/);
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('Blocked'); });
    expect(clearPersistedDrawState('a')).toMatch(/could not be deleted/);
  });
  it('loads a legacy copy without provisional/selection artifacts and leaves the original payload intact', () => {
    const helper = { ...features[0], id: 'helper', properties: { mode: 'select', selectionPoint: true } };
    const raw = JSON.stringify({ version: 1, drawFeatures: [...features, helper], textAnnotations: [] });
    localStorage.setItem(DRAW_STORAGE_KEY, raw);
    expect(readDrawStorage(null, true).document?.drawFeatures).toEqual(features);
    expect(localStorage.getItem(DRAW_STORAGE_KEY)).toBe(raw);
  });
});
