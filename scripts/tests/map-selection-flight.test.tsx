// @vitest-environment jsdom
import type React from "react";
import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { FlyToOptions } from "maplibre-gl";
import { calculateSelectionCameraPadding as paddingFor, useMapCamera } from "@/components/map/useMapCamera";
import type { NewsItem } from "@/lib/core/types";

const story = (overrides: Partial<NewsItem> = {}): NewsItem => ({
  id: "event-1", title: "Event", url: "https://example.com/event-1",
  source: "Example", sourceType: "rss", publishedAt: "2026-01-01T00:00:00.000Z",
  latitude: 40, longitude: -74, ...overrides,
});

afterEach(() => vi.unstubAllGlobals());

function flightHarness(item: NewsItem, height: number, mobile = false) {
  vi.stubGlobal("innerWidth", mobile ? 390 : 1280);
  vi.stubGlobal("innerHeight", 800);
  let resize = () => {};
  let frame = () => {};
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: () => void) { resize = callback; }
    observe() {}
    disconnect() {}
  });
  vi.stubGlobal("requestAnimationFrame", (callback: () => void) => { frame = callback; return 1; });
  vi.stubGlobal("cancelAnimationFrame", () => { frame = () => {}; });
  const canvas = document.createElement("canvas");
  const container = document.createElement("div");
  Object.defineProperty(container, "clientHeight", { value: 800 });
  const element = document.createElement("div");
  let popupHeight = height;
  element.getBoundingClientRect = () => ({ height: popupHeight }) as DOMRect;
  let padding = { top: 0, bottom: 0, left: 0, right: 0 };
  let moving = false;
  let handlers: Array<() => void> = [];
  const emitEnd = () => { const pending = handlers; handlers = []; pending.forEach(fn => fn()); };
  const flyTo = vi.fn<(options: FlyToOptions) => void>(() => { emitEnd(); moving = true; });
  const map = {
    getCanvas: () => canvas, getLayer: vi.fn(), getZoom: () => 3,
    getPadding: () => padding, isMoving: () => moving, flyTo, easeTo: vi.fn(),
    stop: vi.fn(() => { moving = false; emitEnd(); }),
    once: (_event: string, callback: () => void) => handlers.push(callback),
  };
  let position = { lng: item.longitude!, lat: item.latitude! };
  const popup = {
    getElement: () => element, isOpen: () => true, getLngLat: () => position,
    setLngLat: ([lng, lat]: [number, number]) => { position = { lng, lat }; return popup; },
  };
  const refs = {
    mapRef: { current: map } as unknown as React.MutableRefObject<null>,
    popupRef: { current: popup } as unknown as React.MutableRefObject<null>,
    containerRef: { current: container }, latestGeoItemsRef: { current: [item] },
    forceIndividualPinsRef: { current: false },
  };
  const hook = renderHook(({ selected, version }) => {
    refs.latestGeoItemsRef.current = [selected];
    return useMapCamera({
      ...refs, mapReady: true, popupContainer: element,
      selectedItemId: selected.id, selectionVersion: version,
      geoItems: [selected], animatedEffects: false, isGlobe: false,
    });
  }, { initialProps: { selected: item, version: 1 } });
  return {
    ...hook, map, canvas,
    target: () => flyTo.mock.calls.at(-1)![0],
    resize: (height: number) => act(() => { popupHeight = height; resize(); frame(); }),
    update: (selected: NewsItem, height: number, version = 1) => act(() => {
      popupHeight = height;
      hook.rerender({ selected, version });
      resize(); frame();
    }),
    land: () => act(() => {
      padding = flyTo.mock.calls.at(-1)![0].padding as typeof padding;
      moving = false;
      emitEnd();
    }),
  };
}

it("fits a loaded tall card in the initial flight without an arrival animation", () => {
  const h = flightHarness(story({ description: "Loaded" }), 720);
  expect(h.target().padding).toEqual(paddingFor(800, 720, false));
  h.resize(720);
  expect(h.map.flyTo).toHaveBeenCalledTimes(1);
  h.land();
  expect(h.result.current.isFlyingRef.current).toBe(false);
  expect(h.map.easeTo).not.toHaveBeenCalled();
  h.unmount();
});

it("refines loading space and exact coordinates during flight without a landing nudge", () => {
  const h = flightHarness(story(), 200);
  expect(h.target().padding).toEqual(paddingFor(800, 732, false));
  h.update(story({ description: "Loaded", longitude: -75 }), 600);
  expect(h.target()).toMatchObject({ center: [-75, 40], zoom: 8.5, padding: paddingFor(800, 600, false) });
  expect(h.map.flyTo).toHaveBeenCalledTimes(2);
  expect(h.result.current.isFlyingRef.current).toBe(true);
  h.land();
  h.resize(600);
  expect(h.map.easeTo).not.toHaveBeenCalled();
  expect(h.map.flyTo).toHaveBeenCalledTimes(2);
  h.unmount();
});

it("keeps reserved room when slow details arrive after a short flight", () => {
  const h = flightHarness(story(), 200);
  h.land();
  h.update(story({ description: "Late details" }), 720);
  expect(h.map.flyTo).toHaveBeenCalledTimes(1);
  expect(h.map.easeTo).not.toHaveBeenCalled();
  h.unmount();
});

it("recalculates room when switching or explicitly reselecting a story", () => {
  const h = flightHarness(story(), 200);
  h.land();
  h.update(story({ description: "Short" }), 240, 2);
  expect(h.target().padding).toEqual(paddingFor(800, 240, false));
  h.update(story({ id: "event-2", description: "Tall", longitude: 20 }), 680);
  expect(h.target()).toMatchObject({ center: [20, 40], padding: paddingFor(800, 680, false) });
  h.land();
  expect(h.map.easeTo).not.toHaveBeenCalled();
  h.unmount();
});

it("retargets a growing card before arrival and yields to manual map gestures", () => {
  const h = flightHarness(story({ description: "Loaded" }), 400);
  h.resize(680);
  expect(h.map.flyTo).toHaveBeenCalledTimes(2);
  expect(h.target().padding).toEqual(paddingFor(800, 680, false));
  act(() => h.canvas.dispatchEvent(new Event("wheel")));
  h.resize(720);
  expect(h.map.flyTo).toHaveBeenCalledTimes(2);
  expect(h.map.easeTo).not.toHaveBeenCalled();
  expect(h.result.current.isFlyingRef.current).toBe(false);
  h.unmount();
});

it("includes the mobile sheet in the initial destination", () => {
  const h = flightHarness(story(), 482, true);
  expect(h.target().padding).toEqual(paddingFor(800, 482, true));
  h.land();
  h.update(story({ description: "Mobile details" }), 482);
  expect(h.map.easeTo).not.toHaveBeenCalled();
  expect(h.map.flyTo).toHaveBeenCalledTimes(1);
  h.unmount();
});

it("releases camera ownership when a zero-distance flight finishes synchronously", () => {
  const item = story({ description: "Loaded" });
  const h = flightHarness(item, 300);
  h.land();
  h.map.flyTo.mockImplementation(() => {});
  h.update(item, 300, 2);
  expect(h.result.current.isFlyingRef.current).toBe(false);
  expect(h.map.easeTo).not.toHaveBeenCalled();
  h.unmount();
});
