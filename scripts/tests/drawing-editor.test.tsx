// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TerraDraw as TerraDrawType } from 'terra-draw';
import MapDrawTools from '@/components/map/MapDrawTools';
import { drawingStorageKey, DRAW_STORAGE_KEY } from '@/components/map/draw/drawPersistence';
import { drawingDocument } from '@/components/map/draw/drawingHistory';
import type * as maplibregl from 'maplibre-gl';

type Adapter = ConstructorParameters<typeof TerraDrawType>[0]['adapter'];
type Callbacks = Parameters<Adapter['register']>[0];
const harness = vi.hoisted(() => ({ draws: [] as TerraDrawType[], adapters: [] as { callbacks: Callbacks }[] }));
vi.mock('terra-draw', async importOriginal => {
  const actual = await importOriginal<typeof import('terra-draw')>();
  return { ...actual, TerraDraw: class extends actual.TerraDraw {
    constructor(options: ConstructorParameters<typeof TerraDrawType>[0]) { super(options); harness.draws.push(this); }
  } };
});
vi.mock('terra-draw-maplibre-gl-adapter', () => ({ TerraDrawMapLibreGLAdapter: class implements Adapter {
  callbacks!: Callbacks;
  constructor() { harness.adapters.push(this); }
  project = (lng: number, lat: number) => ({ x: lng * 10, y: lat * 10 });
  unproject = (x: number, y: number) => ({ lng: x / 10, lat: y / 10 });
  setCursor() {} getLngLatFromEvent() { return null; } setDoubleClickToZoom() {}
  getMapEventElement() { return document.querySelector('canvas')!; }
  getCoordinatePrecision() { return 9; }
  register(callbacks: Callbacks) { this.callbacks = callbacks; }
  unregister() {} render() {} clear() { this.callbacks.onClear(); }
} }));
vi.mock('maplibre-gl', () => ({ Marker: class {
  container: HTMLElement; coordinates = { lng: 0, lat: 0 };
  constructor({ element }: { element: HTMLElement }) { this.container = element; }
  setLngLat([lng, lat]: [number, number]) { this.coordinates = { lng, lat }; return this; }
  addTo() { document.body.append(this.container); return this; }
  on() { return this; } getLngLat() { return this.coordinates; } remove() { this.container.remove(); }
} }));

function makeMap() {
  const canvas = document.createElement('canvas'); canvas.tabIndex = 0; document.body.append(canvas);
  const events = new Map<string, (event: unknown) => void>();
  const sources = new Map(); const layers = new Map();
  const map = { style: {}, getCanvas: () => canvas, getZoom: () => 3,
    getCenter: () => ({ lng: 0, lat: 0 }), project: () => ({ x: 0, y: 0 }), unproject: () => ({ lng: 1, lat: 1 }),
    dragPan: { enable: vi.fn(), disable: vi.fn() }, touchZoomRotate: { enable: vi.fn(), disable: vi.fn() },
    touchPitch: { enable: vi.fn(), disable: vi.fn() },
    getStyle: () => ({ sources: Object.fromEntries(sources), layers: [...layers].map(([id]) => ({ id })) }),
    getSource: (id: string) => sources.get(id), getLayer: (id: string) => layers.get(id),
    addSource: (id: string) => sources.set(id, { setData: vi.fn() }), addLayer: (layer: { id: string }) => layers.set(layer.id, layer),
    removeSource: (id: string) => sources.delete(id), removeLayer: (id: string) => layers.delete(id), setFilter() {},
    on: (name: string, callback: (event: unknown) => void) => events.set(name, callback),
    off: (name: string) => events.delete(name), queryRenderedFeatures: () => [],
  };
  return { mapRef: { current: map as unknown as maplibregl.Map }, canvas, events };
}
const currentDraw = () => harness.draws.at(-1)!;
const currentAdapter = () => harness.adapters.at(-1)!;
const mouse = (lng: number, lat: number) => ({ lng, lat, containerX: lng * 10, containerY: lat * 10,
  button: 'left' as const, heldKeys: [], isContextMenu: false });
const documentState = () => drawingDocument(currentDraw().getSnapshot(), []);
const advance = (ms = 0) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const click = (name: string) => fireEvent.click(screen.getByRole('button', { name }));

describe('real TerraDraw editor lifecycle', () => {
  beforeEach(() => {
    localStorage.clear(); harness.draws.length = 0; harness.adapters.length = 0;
    vi.useFakeTimers();
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(0), 16));
    vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
  });
  afterEach(() => { cleanup(); document.body.innerHTML = ''; vi.useRealTimers(); vi.unstubAllGlobals(); });
  it('keeps a wide compact landscape sheet collapsed initially and does not drag it off screen', async () => {
    vi.stubGlobal('innerWidth', 920);
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    const map = makeMap();
    render(<MapDrawTools mapRef={map.mapRef} mapReady isOpen userTier="analyst" ownerId="a" />);
    await advance();
    expect(screen.getByRole('button', { name: 'Expand panel' })).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Pin' })).toBeNull();
    click('Expand panel');
    expect(screen.getByRole('button', { name: 'Pin' })).toBeDefined();
    const wrapper = document.querySelector<HTMLElement>('[data-drawing-tools]')!;
    fireEvent.mouseDown(wrapper.firstElementChild!.firstElementChild!, { button: 0, clientX: 100, clientY: 100 });
    fireEvent.mouseMove(window, { clientX: 200, clientY: 200 });
    fireEvent.mouseUp(window);
    expect(wrapper.style.top).toBe('');
    expect(wrapper.style.left).toBe('');
  });
  it('commits one completed drag, ignores selection, preserves style, and restores history after style reload', async () => {
    const map = makeMap();
    const props = { mapRef: map.mapRef, mapReady: true, isOpen: true, userTier: 'analyst' as const, ownerId: 'a' };
    const view = render(<MapDrawTools {...props} />);
    click('Pin'); act(() => currentAdapter().callbacks.onClick(mouse(10, 20)));
    const initial = documentState();
    click('Select'); act(() => currentDraw().selectFeature(initial.drawFeatures[0].id!));
    expect(documentState()).toEqual(initial);
    fireEvent.pointerDown(map.canvas);
    act(() => currentAdapter().callbacks.onDragStart(mouse(10, 20), () => {}));
    for (let lng = 11; lng < 20; lng++) act(() => currentAdapter().callbacks.onDrag(mouse(lng, 20), () => {}));
    act(() => currentAdapter().callbacks.onDragEnd(mouse(20, 20), () => {}));
    fireEvent.pointerUp(map.canvas); await advance();
    const moved = documentState(); expect(moved).not.toEqual(initial);
    expect(moved.drawFeatures[0].properties).toEqual(initial.drawFeatures[0].properties);
    click('Undo'); expect(documentState()).toEqual(initial);
    click('Undo'); expect(documentState().drawFeatures).toHaveLength(0); // exactly two operations: draw + drag
    click('Redo'); click('Redo'); expect(documentState()).toEqual(moved);
    act(() => currentDraw().selectFeature(initial.drawFeatures[0].id!));
    view.rerender(<MapDrawTools {...props} mapReady={false} />);
    await advance(200); // Stopping selection must not schedule layers/timers after teardown.
    expect(map.mapRef.current.getSource('experiment-drawing-history-freehand-source')).toBeUndefined();
    view.rerender(<MapDrawTools {...props} />);
    expect(documentState()).toEqual(moved);
    click('Undo'); expect(documentState()).toEqual(initial);
    expect([...map.events.keys()]).toContain('zoomend');
  });
  it('coalesces style edits, makes duplicate/delete/clear reversible, and renews IDs', async () => {
    const map = makeMap(); render(<MapDrawTools mapRef={map.mapRef} mapReady isOpen userTier="analyst" ownerId="a" />);
    click('Pin'); act(() => currentAdapter().callbacks.onClick(mouse(10, 20)));
    const initial = documentState();
    click('Select'); act(() => currentDraw().selectFeature(initial.drawFeatures[0].id!));
    const input = screen.getByTitle('Custom draw size');
    fireEvent.change(input, { target: { value: '5' } });
    await advance(100); fireEvent.change(input, { target: { value: '6' } });
    await advance(100); fireEvent.change(input, { target: { value: '8' } });
    await advance(500);
    expect(documentState().drawFeatures[0].properties.size).toBe(8);
    click('Undo'); expect(documentState()).toEqual(initial);
    click('Redo'); act(() => currentDraw().selectFeature(initial.drawFeatures[0].id!));
    click('Duplicate'); expect(documentState().drawFeatures).toHaveLength(2);
    expect(new Set(documentState().drawFeatures.map(feature => feature.id)).size).toBe(2);
    act(() => currentDraw().selectFeature(initial.drawFeatures[0].id!)); click('Delete');
    expect(documentState().drawFeatures).toHaveLength(1); click('Undo'); expect(documentState().drawFeatures).toHaveLength(2);
    click('Clear'); expect(documentState().drawFeatures).toHaveLength(0); click('Undo'); expect(documentState().drawFeatures).toHaveLength(2);
  });
  it.each(['complete', 'recover'] as const)('keeps a newer drag owned when an older release callback runs (%s)', async ending => {
    const map = makeMap();
    const props = { mapRef: map.mapRef, mapReady: true, isOpen: true, userTier: 'analyst' as const, ownerId: 'a' };
    const view = render(<MapDrawTools {...props} />);
    click('Pin'); act(() => currentAdapter().callbacks.onClick(mouse(10, 20)));
    const initial = documentState(); const saved = localStorage.getItem(drawingStorageKey('a'));
    click('Select'); act(() => currentDraw().selectFeature(initial.drawFeatures[0].id!));
    const pointer = (type: string) => {
      const event = new Event(type, { bubbles: true });
      Object.assign(event, { pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, buttons: type === 'pointerdown' ? 1 : 0 });
      fireEvent(map.canvas, event);
    };
    const timers = vi.spyOn(globalThis, 'setTimeout');
    pointer('pointerdown'); pointer('pointerup');
    const [releasedCallback, delay] = timers.mock.calls.at(-1)!;
    expect(delay).toBe(0);
    // Start the next gesture before the selection's deferred release runs.
    pointer('pointerdown');
    act(() => currentAdapter().callbacks.onDragStart(mouse(10, 20), () => {}));
    act(() => currentAdapter().callbacks.onDrag(mouse(20, 20), () => {}));
    const moved = documentState(); expect(moved).not.toEqual(initial);
    const replayRelease = () => act(() => {
      if (typeof releasedCallback !== 'function') throw new Error('Expected a deferred release callback');
      releasedCallback(); // Also model an already queued callback that cancellation cannot remove.
    });
    replayRelease();
    expect(localStorage.getItem(drawingStorageKey('a'))).toBe(saved);
    if (ending === 'recover') {
      view.rerender(<MapDrawTools {...props} mapReady={false} />);
      replayRelease(); // The disposed engine must not mutate the recovering document.
      view.rerender(<MapDrawTools {...props} />); await advance();
      expect(documentState()).toEqual(initial);
      expect(localStorage.getItem(drawingStorageKey('a'))).toBe(saved);
    } else {
      act(() => currentAdapter().callbacks.onDragEnd(mouse(20, 20), () => {}));
      pointer('pointerup'); replayRelease(); await advance();
      expect(documentState()).toEqual(moved);
      click('Undo'); expect(documentState()).toEqual(initial);
    }
    click('Undo'); expect(documentState().drawFeatures).toHaveLength(0);
    click('Redo'); expect(documentState()).toEqual(initial);
    timers.mockRestore();
  });
  it('creates and edits text as one blur operation, leaves native undo alone, and synchronizes restored textarea content', async () => {
    const map = makeMap(); render(<MapDrawTools mapRef={map.mapRef} mapReady isOpen userTier="analyst" ownerId="a" />);
    await advance(); click('Text'); act(() => map.events.get('click')?.({ lngLat: { lng: 10, lat: 20 } })); await advance(40);
    const input = screen.getByTitle('Edit the text annotation');
    fireEvent.change(input, { target: { value: 'Example' } }); fireEvent.change(input, { target: { value: 'Example annotation' } });
    fireEvent.blur(input);
    click('Undo'); expect(screen.queryByTitle('Edit the text annotation')).toBeNull();
    click('Redo'); const restored = screen.getByTitle('Edit the text annotation');
    expect(restored).toHaveProperty('value', 'Example annotation');
    fireEvent.focus(restored); fireEvent.change(restored, { target: { value: 'Changed' } });
    expect(fireEvent.keyDown(restored, { key: 'z', ctrlKey: true })).toBe(true);
    expect(screen.getByTitle('Edit the text annotation')).toHaveProperty('value', 'Changed');
    fireEvent.blur(restored); click('Undo'); expect(restored).toHaveProperty('value', 'Example annotation');
  });
  it('cancels account work, clears private UI/history on switch or external deletion, and never adopts/deletes legacy saves', async () => {
    const map = makeMap(); localStorage.setItem(DRAW_STORAGE_KEY, JSON.stringify({ version: 1, drawFeatures: [], textAnnotations: [] }));
    const props = { mapRef: map.mapRef, mapReady: true, isOpen: true, userTier: 'analyst' as const };
    const view = render(<MapDrawTools {...props} ownerId="a" />);
    click('Pin'); act(() => currentAdapter().callbacks.onClick(mouse(10, 20)));
    const saved = localStorage.getItem(drawingStorageKey('a'));
    view.rerender(<MapDrawTools {...props} ownerId="b" />);
    expect(documentState().drawFeatures).toHaveLength(0); expect(screen.getByRole('button', { name: 'Undo' })).toHaveProperty('disabled', true);
    expect(localStorage.getItem(drawingStorageKey('a'))).toBe(saved);
    view.rerender(<MapDrawTools {...props} ownerId="a" />); expect(documentState().drawFeatures).toHaveLength(1);
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: drawingStorageKey('a'), newValue: null })));
    expect(documentState().drawFeatures).toHaveLength(0); expect(screen.getByRole('button', { name: 'Undo' })).toHaveProperty('disabled', true);
    view.rerender(<MapDrawTools {...props} ownerId={null} userTier="guest" />);
    expect(localStorage.getItem(DRAW_STORAGE_KEY)).not.toBeNull();
  });
  it('keeps pointer-created text and initial typing in one operation and abandons empty creation without history', async () => {
    const map = makeMap(); render(<MapDrawTools mapRef={map.mapRef} mapReady isOpen userTier="analyst" ownerId="a" />);
    await advance(); click('Text');
    const place = async () => {
      fireEvent.pointerDown(map.canvas); fireEvent.pointerUp(map.canvas);
      act(() => map.events.get('click')?.({ lngLat: { lng: 10, lat: 20 } }));
      await advance(40);
      return screen.getByTitle('Edit the text annotation');
    };
    const empty = await place(); fireEvent.blur(empty);
    expect(screen.getByRole('button', { name: 'Undo' })).toHaveProperty('disabled', true);
    const input = await place(); fireEvent.change(input, { target: { value: 'Initial text' } }); fireEvent.blur(input);
    click('Undo'); expect(screen.queryByTitle('Edit the text annotation')).toBeNull();
    expect(screen.getByRole('button', { name: 'Undo' })).toHaveProperty('disabled', true);
    click('Redo'); expect(screen.getByTitle('Edit the text annotation')).toHaveProperty('value', 'Initial text');
  });
  it('protects unreadable and engine-rejected saved copies throughout local edits and clear', async () => {
    for (const raw of ['broken JSON', JSON.stringify({ version: 2, drawFeatures: [{ type: 'Feature',
      id: '11111111-1111-4111-8111-111111111111', properties: { mode: 'circle' },
      geometry: { type: 'Polygon', coordinates: [[[0, 0], [10, 10], [0, 10], [10, 0], [0, 0]]] } }], textAnnotations: [] })]) {
      const map = makeMap(); localStorage.setItem(drawingStorageKey('a'), raw);
      const view = render(<MapDrawTools mapRef={map.mapRef} mapReady isOpen userTier="analyst" ownerId="a" />);
      await advance();
      expect(screen.getByRole('alert').textContent).toMatch(/protected|untouched/);
      click('Pin'); act(() => currentAdapter().callbacks.onClick(mouse(10, 20)));
      expect(localStorage.getItem(drawingStorageKey('a'))).toBe(raw);
      click('Clear'); expect(localStorage.getItem(drawingStorageKey('a'))).toBe(raw);
      click('Pin'); act(() => currentAdapter().callbacks.onClick(mouse(10, 20)));
      click('Save current drawings instead');
      expect(localStorage.getItem(drawingStorageKey('a'))).not.toBe(raw);
      expect(screen.queryByRole('alert')).toBeNull();
      view.unmount();
    }
  });
  it('cancels an interrupted drag during map recovery consistently with current storage and history', async () => {
    const map = makeMap(); const props = { mapRef: map.mapRef, mapReady: true, isOpen: true, userTier: 'analyst' as const, ownerId: 'a' };
    const view = render(<MapDrawTools {...props} />);
    click('Pin'); act(() => currentAdapter().callbacks.onClick(mouse(10, 20))); const initial = documentState();
    const saved = localStorage.getItem(drawingStorageKey('a'));
    click('Select'); act(() => currentDraw().selectFeature(initial.drawFeatures[0].id!));
    fireEvent.pointerDown(map.canvas);
    act(() => currentAdapter().callbacks.onDragStart(mouse(10, 20), () => {}));
    act(() => currentAdapter().callbacks.onDrag(mouse(20, 20), () => {}));
    expect(documentState()).not.toEqual(initial);
    view.rerender(<MapDrawTools {...props} mapReady={false} />);
    view.rerender(<MapDrawTools {...props} />); await advance(100);
    expect(documentState()).toEqual(initial); expect(localStorage.getItem(drawingStorageKey('a'))).toBe(saved);
    click('Undo'); expect(documentState().drawFeatures).toHaveLength(0);
    click('Redo'); expect(documentState()).toEqual(initial);
  });
  it('ends erasing globally before hover and commits one coherent undo transaction', async () => {
    const map = makeMap(); render(<MapDrawTools mapRef={map.mapRef} mapReady isOpen userTier="analyst" ownerId="a" />);
    click('Pin'); act(() => currentAdapter().callbacks.onClick(mouse(10, 20)));
    act(() => currentAdapter().callbacks.onClick(mouse(30, 20))); const initial = documentState();
    const rendered = (id: string | number | undefined) => [{ properties: { id }, layer: { id: 'experiment-drawing-history-point' } }] as unknown as maplibregl.MapGeoJSONFeature[];
    const query = vi.spyOn(map.mapRef.current, 'queryRenderedFeatures').mockReturnValue(rendered(initial.drawFeatures[0].id));
    const pointer = (target: HTMLElement, type: string, buttons: number, pointerId = 1) => {
      const event = new Event(type, { bubbles: true });
      Object.assign(event, { pointerType: 'mouse', pointerId, isPrimary: pointerId === 1, button: 0, buttons, clientX: 100, clientY: 100 });
      fireEvent(target, event);
    };
    click('Eraser'); pointer(map.canvas, 'pointerdown', 1);
    pointer(map.canvas, 'pointercancel', 0, 2);
    pointer(map.canvas, 'pointerup', 0, 2); await advance();
    expect(JSON.parse(localStorage.getItem(drawingStorageKey('a'))!).drawFeatures).toEqual(initial.drawFeatures);
    pointer(screen.getByRole('button', { name: 'Undo' }), 'pointerup', 0); await advance();
    expect(documentState().drawFeatures).toHaveLength(1);
    query.mockReturnValue(rendered(initial.drawFeatures[1].id)); pointer(map.canvas, 'pointermove', 0);
    expect(documentState().drawFeatures).toHaveLength(1);
    click('Undo'); expect(documentState()).toEqual(initial);
    expect(JSON.parse(localStorage.getItem(drawingStorageKey('a'))!).drawFeatures).toEqual(initial.drawFeatures);
  });
  it('publishes ownership for click tools, selection and annotation gestures and clears it on close/recovery/unmount', async () => {
    const map = makeMap(); const ownership = vi.fn();
    const props = { mapRef: map.mapRef, mapReady: true, isOpen: true, userTier: 'analyst' as const, ownerId: 'a', onInteractionOwnershipChange: ownership };
    const view = render(<MapDrawTools {...props} />); expect(ownership).toHaveBeenLastCalledWith(false);
    for (const mode of ['Pin', 'Area', 'Ruler', 'Select', 'Text']) { click(mode); expect(ownership).toHaveBeenLastCalledWith(true); }
    await advance(); act(() => map.events.get('click')?.({ lngLat: { lng: 10, lat: 20 } })); await advance(40);
    const text = screen.getByTitle('Edit the text annotation'); fireEvent.change(text, { target: { value: 'Existing text' } }); fireEvent.blur(text);
    view.rerender(<MapDrawTools {...props} isOpen={false} />); expect(ownership).toHaveBeenLastCalledWith(false);
    fireEvent.pointerDown(text); expect(ownership).toHaveBeenLastCalledWith(true);
    fireEvent.pointerUp(text); await advance(); expect(ownership).toHaveBeenLastCalledWith(false);
    view.rerender(<MapDrawTools {...props} />); expect(ownership).toHaveBeenLastCalledWith(true);
    view.rerender(<MapDrawTools {...props} mapReady={false} />); expect(ownership).toHaveBeenLastCalledWith(false);
    view.unmount(); expect(ownership).toHaveBeenLastCalledWith(false);
  });
});
