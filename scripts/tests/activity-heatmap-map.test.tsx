// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import NewsMap from '@/components/map/NewsMap';
import { DEFAULT_SYNCED_PREFERENCES } from '@/hooks/useSyncedPreferences';
import { activityPreferenceKey } from '@/components/map/activityHeatmap/useActivityHeatmapPreference';
import { ACTIVITY_HIT_LAYER, ACTIVITY_SOURCE } from '@/components/map/activityHeatmap/layers';
import { mapActivityFixture } from './fixtures/mapActivity';
import { DRAW_STORAGE_KEY } from '@/components/map/draw/drawPersistence';

type Harness = {
    emit: (event: string, payload?: unknown) => void;
    layers: Map<string, { layout?: { visibility?: string } }>;
    sources: Map<string, { data: GeoJSON.FeatureCollection; setData: ReturnType<typeof vi.fn> }>;
    setStyle: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn>;
    queryRenderedFeatures: ReturnType<typeof vi.fn>;
};
const mocks = vi.hoisted(() => ({ maps: [] as Harness[], pulseStart: vi.fn(), pulseStop: vi.fn(), pulseDispose: vi.fn(), drawingOwnership: undefined as ((owned: boolean) => void) | undefined }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('next/dynamic', () => ({ default: () => (props: { onInteractionOwnershipChange: (owned: boolean) => void }) => {
    mocks.drawingOwnership = props.onInteractionOwnershipChange;
    return null;
} }));
vi.mock('@/components/map/MapActionTools', () => ({ default: () => null }));
vi.mock('@/components/map/MapPopup', () => ({ default: () => <div>Selected detail</div> }));
vi.mock('@/components/map/MapConstants', () => ({
    getMapLibreStyle: () => ({ version: 8, sources: {}, layers: [] }),
    MAP_STYLES: { standard: { label: 'Standard' }, dark: { label: 'Dark' } },
}));
vi.mock('@/components/map/layers/mapIcons', () => ({ loadMapIcons: async () => {} }));
vi.mock('@/components/map/useMapCamera', () => ({ useMapCamera: () => ({ getInitialViewState: () => ({ center: [10, 30], zoom: 4 }), handleResetOrientation: vi.fn(), cancelCameraFlight: vi.fn() }) }));
vi.mock('@/components/map/pulseController', () => ({ createHotStoryPulseController: () => ({ start: mocks.pulseStart, stop: mocks.pulseStop, dispose: mocks.pulseDispose }) }));
vi.mock('@/components/map/mapProjection', () => ({ applyMapProjection: () => true }));
vi.mock('maplibre-gl', () => ({
    Map: class {
        layers = new Map(); sources = new Map(); handlers = new Map<string, Set<(payload: unknown) => void>>();
        constructor() { mocks.maps.push(this); }
        on(event: string, layer: string | ((payload: unknown) => void), handler?: (payload: unknown) => void) {
            const key = typeof layer === 'string' ? `${event}:${layer}` : event;
            if (!this.handlers.has(key)) this.handlers.set(key, new Set());
            this.handlers.get(key)!.add(typeof layer === 'string' ? handler! : layer); return this;
        }
        off(event: string, handler: (payload: unknown) => void) { this.handlers.get(event)?.delete(handler); }
        emit(event: string, payload: unknown = {}) { for (const handler of this.handlers.get(event) ?? []) handler(payload); }
        addSource(id: string, options: { data: GeoJSON.FeatureCollection }) {
            const source = { data: options.data, setData: vi.fn((data: GeoJSON.FeatureCollection) => { source.data = data; }) };
            this.sources.set(id, source);
        }
        addLayer(layer: { id: string }) { this.layers.set(layer.id, layer); }
        getLayer(id: string) { return this.layers.get(id); }
        getSource(id: string) { return this.sources.get(id); }
        removeLayer(id: string) { this.layers.delete(id); }
        removeSource(id: string) { this.sources.delete(id); }
        setLayoutProperty(id: string, property: string, value: unknown) { const layer = this.layers.get(id); layer.layout = { ...layer.layout, [property]: value }; }
        setPaintProperty() {} addControl() {} resize() {} triggerRepaint() {}
        setStyle = vi.fn(() => { this.layers.clear(); this.sources.clear(); });
        remove = vi.fn(); queryRenderedFeatures = vi.fn(() => []);
        getBounds() { return { getSouth: () => -90, getNorth: () => 90, getWest: () => -180, getEast: () => 180 }; }
        getCenter() { return { lat: 30, lng: 10 }; } getZoom() { return 4; }
        getCanvas() { return { style: { cursor: '' } }; }
        getBearing() { return 0; }
        project([x, y]: [number, number]) { return { x, y }; }
    },
    setWorkerUrl() {}, getVersion: () => 'test', GPUInitializationError: class extends Error {},
    NavigationControl: class {}, ScaleControl: class {}, AttributionControl: class {},
    Popup: class { on() { return this; } isOpen() { return false; } remove() {} },
}));

const defaults = {
    items: mapActivityFixture, selectedItemId: null, selectionVersion: 0, onSelectItem: vi.fn(),
    isDarkMode: false, animatedEffects: true, onAnimatedEffectsChange: vi.fn(), sortMode: 'hot' as const,
    initialCenter: [10, 30] as [number, number], initialZoom: 4, userTier: 'analyst' as const,
    preferenceOwnerId: 'account-a', syncedPreferences: { ...DEFAULT_SYNCED_PREFERENCES, forceIndividualPins: true },
};
const latest = () => mocks.maps.at(-1)!;
const advance = (ms = 1) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const load = () => act(async () => { latest().emit('style.load'); });
const toggle = () => fireEvent.click(screen.getByRole('switch', { name: 'Activity heatmap' }));

describe('heatmap integrated with NewsMap and Settings', () => {
    beforeEach(() => {
        vi.useFakeTimers(); localStorage.clear(); mocks.maps.length = 0;
        mocks.drawingOwnership = undefined;
        vi.clearAllMocks(); vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
    });
    afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

    it('toggles without style/query/cloud changes and restores individual pins and pulses', async () => {
        const bounds = vi.fn(), preferences = vi.fn();
        render(<NewsMap {...defaults} onBoundsChange={bounds} onSyncedPreferencesChange={preferences} />);
        await advance(); await load();
        fireEvent.click(screen.getByRole('button', { name: 'Map settings' }));
        const map = latest(), stylesBefore = map.setStyle.mock.calls.length, boundsBefore = bounds.mock.calls.length;
        toggle();
        expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('true');
        expect(map.sources.get(ACTIVITY_SOURCE)?.data.features).toHaveLength(1_000);
        expect(map.layers.get('clusters-count')?.layout?.visibility).toBe('none');
        expect(map.layers.get('hot-story-pulse')?.layout?.visibility).toBe('none');
        expect((screen.getByRole('button', { name: 'Force individual pins' }) as HTMLButtonElement).disabled).toBe(true);
        expect(preferences).not.toHaveBeenCalled(); expect(bounds).toHaveBeenCalledTimes(boundsBefore);
        expect(map.setStyle).toHaveBeenCalledTimes(stylesBefore);
        expect(mocks.pulseDispose).toHaveBeenCalled(); expect(mocks.pulseStop).toHaveBeenCalled();
        const starts = mocks.pulseStart.mock.calls.length;
        act(() => map.emit('moveend'));
        expect(mocks.pulseStart).toHaveBeenCalledTimes(starts);
        toggle();
        expect(map.sources.has(ACTIVITY_SOURCE)).toBe(false);
        expect(map.layers.get('unclustered-point')?.layout?.visibility).toBe('visible');
        expect(screen.getByRole('button', { name: 'Force individual pins' }).title).toContain('Group nearby');
        expect(map.setStyle).toHaveBeenCalledTimes(stylesBefore); expect(preferences).not.toHaveBeenCalled();
        expect(mocks.pulseStart.mock.calls.length).toBeGreaterThan(starts);
    });
    it('retains selected markers and canonical dot selection through theme reload and context recovery', async () => {
        localStorage.setItem(activityPreferenceKey('account-a'), '{"version":1,"enabled":true}');
        const { rerender } = render(<NewsMap {...defaults} selectedItemId="fixture-2" />);
        await advance(); await load();
        expect(latest().sources.get('selected-news-event')?.data.features[0].properties).toMatchObject({ canonicalId: 'fixture-2' });
        latest().queryRenderedFeatures.mockReturnValue([dot('fixture-3')]);
        act(() => latest().emit('click', { point: { x: 30, y: 30 } }));
        expect(defaults.onSelectItem).toHaveBeenCalledWith('fixture-3');
        rerender(<NewsMap {...defaults} selectedItemId="fixture-2" isDarkMode />);
        await advance(20); await load();
        expect(latest().sources.get(ACTIVITY_SOURCE)?.data.features).toHaveLength(1_000);
        expect(latest().layers.get('clusters-count')?.layout?.visibility).toBe('none');
        const original = latest();
        act(() => original.emit('webglcontextlost', { originalEvent: { preventDefault() {} } }));
        await advance(3_000); await load();
        expect(latest()).not.toBe(original); expect(original.remove).toHaveBeenCalled();
        expect(latest().layers.has(ACTIVITY_HIT_LAYER)).toBe(true);
        latest().queryRenderedFeatures.mockReturnValue([dot('fixture-4')]);
        act(() => latest().emit('click', { point: { x: 30, y: 30 } }));
        expect(defaults.onSelectItem).toHaveBeenLastCalledWith('fixture-4');
    });
    it('blocks heatmap and selected-marker picking while drawing owns the map, including after a style reload', async () => {
        localStorage.setItem(activityPreferenceKey('account-a'), '{"version":1,"enabled":true}');
        localStorage.setItem(DRAW_STORAGE_KEY, '{"version":1,"drawFeatures":[],"textAnnotations":[]}');
        const { rerender } = render(<NewsMap {...defaults} />);
        await advance(); await load();
        expect(mocks.drawingOwnership).toBeTypeOf('function');
        act(() => mocks.drawingOwnership!(true));
        const payload = { point: { x: 30, y: 30 }, features: [dot('fixture-3')] };
        latest().queryRenderedFeatures.mockReturnValue([dot('fixture-3')]);
        act(() => { latest().emit('click', payload); latest().emit('click:selected-point-active', payload); });
        expect(latest().queryRenderedFeatures).not.toHaveBeenCalled();
        expect(defaults.onSelectItem).not.toHaveBeenCalled();
        rerender(<NewsMap {...defaults} isDarkMode />);
        await advance(20); await load();
        act(() => latest().emit('click', payload));
        expect(defaults.onSelectItem).not.toHaveBeenCalled();
        act(() => mocks.drawingOwnership!(false));
        act(() => latest().emit('click', payload));
        expect(defaults.onSelectItem).toHaveBeenCalledExactlyOnceWith('fixture-3');
    });
    it('follows changed displayed data including empty/capped results and clears on account switch', async () => {
        localStorage.setItem(activityPreferenceKey('account-a'), '{"version":1,"enabled":true}');
        const { rerender } = render(<NewsMap {...defaults} isCapped />);
        await advance(); await load();
        expect(screen.getByText('Loaded result is capped.')).toBeTruthy();
        rerender(<NewsMap {...defaults} items={mapActivityFixture.slice(0, 10)} isCapped />);
        expect(latest().sources.get(ACTIVITY_SOURCE)?.data.features).toHaveLength(10);
        rerender(<NewsMap {...defaults} items={[]} />);
        expect(screen.getByText('No located stories in the displayed data.')).toBeTruthy();
        expect(latest().sources.get(ACTIVITY_SOURCE)?.data.features).toHaveLength(0);
        rerender(<NewsMap {...defaults} items={[]} preferenceOwnerId="account-b" />);
        expect(latest().sources.has(ACTIVITY_SOURCE)).toBe(false);
        expect(screen.queryByLabelText('Activity density legend')).toBeNull();
    });
});

function dot(canonicalId: string) {
    return { layer: { id: ACTIVITY_HIT_LAYER }, properties: { canonicalId }, geometry: { type: 'Point', coordinates: [30, 30] } };
}
