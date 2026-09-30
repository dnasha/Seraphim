// @vitest-environment jsdom
import type React from 'react';
import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useMapCamera } from '@/components/map/useMapCamera';
import type { NewsItem } from '@/lib/core/types';
afterEach(cleanup);

it('does not move the live viewport when replay frames remove and restore the selected representative', () => {
    const item: NewsItem = { id: 'representative', title: 'Fixture', url: 'https://example.com', source: 'Fixture', sourceType: 'rss', publishedAt: '2026-09-30T00:00:00Z', latitude: 45, longitude: 10, description: 'Fixture details' };
    const flyTo = vi.fn();
    const easeTo = vi.fn();
    const canvas = document.createElement('canvas');
    const map = { getCanvas: () => canvas, getLayer: vi.fn(), getZoom: () => 3, getPadding: () => ({ top: 0, bottom: 0, left: 0, right: 0 }), flyTo, easeTo, stop: vi.fn(), once: vi.fn() };
    const popup = { isOpen: () => true, getLngLat: () => ({ lng: 10, lat: 45 }), setLngLat: vi.fn(() => popup) };
    const mapRef = { current: map } as unknown as React.MutableRefObject<null>;
    const popupRef = { current: popup } as unknown as React.MutableRefObject<null>;
    const containerRef = { current: document.createElement('div') };
    const { rerender } = renderHook(({ items, presentationOnly, version }) => useMapCamera({
        mapRef, popupRef, containerRef, mapReady: true, popupContainer: null,
        selectedItemId: 'representative', selectionVersion: version, presentationOnly,
        geoItems: items, latestGeoItemsRef: { current: items }, animatedEffects: false,
        isGlobe: false, forceIndividualPinsRef: { current: false },
    }), { initialProps: { items: [item], presentationOnly: true, version: 0 } });
    expect(flyTo).not.toHaveBeenCalled();
    rerender({ items: [], presentationOnly: true, version: 0 });
    rerender({ items: [item], presentationOnly: true, version: 0 });
    rerender({ items: [{ ...item, longitude: 11 }], presentationOnly: true, version: 0 });
    expect(flyTo).not.toHaveBeenCalled();
    expect(easeTo).not.toHaveBeenCalled();
    // Returning live retains the explicit selection behavior for a new user action.
    rerender({ items: [item], presentationOnly: false, version: 1 });
    expect(flyTo).toHaveBeenCalledTimes(1);
});
