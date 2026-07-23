// @vitest-environment jsdom

import type React from "react";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useMapCamera } from "@/components/map/useMapCamera";
import type { NewsItem } from "@/lib/core/types";

const story = (overrides: Partial<NewsItem> = {}): NewsItem => ({
  id: "event-1",
  title: "Event",
  url: "https://example.com/event-1",
  source: "Example",
  sourceType: "rss",
  publishedAt: "2026-01-01T00:00:00.000Z",
  latitude: 40,
  longitude: -74,
  ...overrides,
});

describe("useMapCamera", () => {
  it("does not let delayed initial-view correction interrupt a shared-event flight", () => {
    vi.useFakeTimers();
    const canvas = document.createElement("canvas");
    const flyTo = vi.fn();
    const jumpTo = vi.fn();
    const map = {
      getCanvas: () => canvas,
      getLayer: vi.fn(),
      getZoom: () => 2.1,
      getPadding: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
      flyTo,
      jumpTo,
      easeTo: vi.fn(),
      stop: vi.fn(),
      once: vi.fn(),
    };
    const popup = {
      isOpen: () => true,
      getLngLat: () => ({ lng: -74, lat: 40 }),
      setLngLat: vi.fn(() => popup),
    };

    renderHook(() =>
      useMapCamera({
        mapRef: { current: map } as unknown as React.MutableRefObject<null>,
        mapReady: true,
        popupRef: { current: popup } as unknown as React.MutableRefObject<null>,
        popupContainer: null,
        selectedItemId: "event-1",
        selectionVersion: 0,
        geoItems: [story()],
        latestGeoItemsRef: { current: [story()] },
        animatedEffects: false,
        isGlobe: false,
        forceIndividualPinsRef: { current: false },
        containerRef: { current: document.createElement("div") },
        initialCenter: [11.2907, 36.2494],
        initialZoom: 2.1,
      }),
    );

    expect(flyTo).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(100));
    expect(jumpTo).not.toHaveBeenCalled();
    expect(flyTo).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("relinquishes camera control after a user gesture during a flight", () => {
    const canvas = document.createElement("canvas");
    const moveendHandlers: Array<() => void> = [];
    const flyTo = vi.fn();
    const easeTo = vi.fn();
    const stop = vi.fn();
    const map = {
      getCanvas: () => canvas,
      getLayer: vi.fn(),
      getZoom: () => 3,
      getPadding: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
      flyTo,
      easeTo,
      stop,
      once: vi.fn((event: string, handler: () => void) => {
        if (event === "moveend") moveendHandlers.push(handler);
      }),
    };
    const popupPosition = { lng: -74, lat: 40 };
    const popup = {
      isOpen: () => true,
      getLngLat: () => popupPosition,
      setLngLat: vi.fn(([lng, lat]: [number, number]) => {
        popupPosition.lng = lng;
        popupPosition.lat = lat;
        return popup;
      }),
    };
    const mapRef = { current: map } as unknown as React.MutableRefObject<null>;
    const popupRef = { current: popup } as unknown as React.MutableRefObject<null>;
    const initialItem = story();
    const latestGeoItemsRef = { current: [initialItem] };
    const forceIndividualPinsRef = { current: false };
    const containerRef = { current: document.createElement("div") };

    const { rerender } = renderHook(
      ({ geoItems }) =>
        useMapCamera({
          mapRef,
          mapReady: true,
          popupRef,
          popupContainer: null,
          selectedItemId: "event-1",
          selectionVersion: 1,
          geoItems,
          latestGeoItemsRef,
          animatedEffects: false,
          isGlobe: false,
          forceIndividualPinsRef,
          containerRef,
        }),
      { initialProps: { geoItems: [initialItem] } },
    );

    expect(flyTo).toHaveBeenCalledTimes(1);

    act(() => canvas.dispatchEvent(new Event("pointerdown")));
    expect(stop).toHaveBeenCalledTimes(1);

    // The interrupted flight's moveend must not issue the old landing correction.
    act(() => moveendHandlers[0]());
    expect(easeTo).not.toHaveBeenCalled();

    const relocatedItem = story({ longitude: -75 });
    act(() => rerender({ geoItems: [relocatedItem] }));

    // A late coordinate update follows the pin but must not reclaim the camera.
    expect(popup.setLngLat).toHaveBeenLastCalledWith([-75, 40]);
    expect(flyTo).toHaveBeenCalledTimes(1);
  });

  it("flies to a selected event again when it returns after a refresh gap", () => {
    const canvas = document.createElement("canvas");
    const flyTo = vi.fn();
    const map = {
      getCanvas: () => canvas,
      getLayer: vi.fn(),
      getZoom: () => 3,
      getPadding: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
      flyTo,
      easeTo: vi.fn(),
      stop: vi.fn(),
      once: vi.fn(),
    };
    const popup = {
      isOpen: () => true,
      getLngLat: () => ({ lng: -74, lat: 40 }),
      setLngLat: vi.fn(() => popup),
    };
    const mapRef = { current: map } as unknown as React.MutableRefObject<null>;
    const popupRef = { current: popup } as unknown as React.MutableRefObject<null>;
    const item = story();
    const latestGeoItemsRef = { current: [item] };

    const { rerender } = renderHook(
      ({ geoItems }) => {
        latestGeoItemsRef.current = geoItems;
        return useMapCamera({
          mapRef,
          mapReady: true,
          popupRef,
          popupContainer: null,
          selectedItemId: "event-1",
          selectionVersion: 0,
          geoItems,
          latestGeoItemsRef,
          animatedEffects: false,
          isGlobe: false,
          forceIndividualPinsRef: { current: false },
          containerRef: { current: document.createElement("div") },
        });
      },
      { initialProps: { geoItems: [item] } },
    );

    expect(flyTo).toHaveBeenCalledTimes(1);

    act(() => rerender({ geoItems: [] }));
    act(() => rerender({ geoItems: [item] }));

    expect(flyTo).toHaveBeenCalledTimes(2);
    expect(flyTo).toHaveBeenLastCalledWith(expect.objectContaining({
      center: [-74, 40],
    }));
  });
});
