// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import NewsMap from '@/components/map/NewsMap';

type MapHarness = {
    emit: (event: string, payload?: unknown) => void;
    handlers: Map<string, (event: unknown) => void>;
    remove: ReturnType<typeof vi.fn>;
    setStyle: ReturnType<typeof vi.fn>;
    loaded: ReturnType<typeof vi.fn>;
    isSourceLoaded: ReturnType<typeof vi.fn>;
    getSource: ReturnType<typeof vi.fn>;
};
const mocks = vi.hoisted(() => ({
    maps: [] as MapHarness[],
    failure: null as 'gpu' | 'generic' | null,
    construct: vi.fn(),
    layers: vi.fn(async () => {}),
}));

vi.mock('next/dynamic', () => ({ default: () => () => null }));
vi.mock('@/components/map/MapSettings', () => ({ default: () => null }));
vi.mock('@/components/map/MapActionTools', () => ({ default: () => null }));
vi.mock('@/components/map/MapPopup', () => ({ default: () => null }));
vi.mock('@/components/map/UpgradeButton', () => ({ default: () => null }));
vi.mock('@/components/map/MapConstants', () => ({
    getMapLibreStyle: () => ({ version: 8, sources: {}, layers: [] }),
    MAP_STYLES: { standard: {}, dark: {} },
}));
vi.mock('@/components/map/useMapLayers', () => ({ useMapLayers: () => ({ addSourcesAndLayers: mocks.layers }) }));
vi.mock('@/components/map/useMapCamera', () => ({ useMapCamera: () => ({
    getInitialViewState: () => ({ center: [0, 0], zoom: 1.2 }),
    handleResetOrientation: () => {}, cancelCameraFlight: () => {},
}) }));
vi.mock('@/components/map/pulseController', () => ({ createHotStoryPulseController: () => ({ stop() {}, start() {}, dispose() {} }) }));
vi.mock('@/components/map/mapProjection', () => ({ applyMapProjection: () => true }));
vi.mock('maplibre-gl', () => {
    class GPUInitializationError extends Error {}
    class MockMap {
        handlers = new Map<string, (event: unknown) => void>();
        remove = vi.fn();
        constructor() {
            mocks.construct();
            if (mocks.failure === 'gpu') throw new GPUInitializationError('No WebGL');
            if (mocks.failure === 'generic') throw new Error('Initialization failed');
            mocks.maps.push(this);
        }
        on(event: string, layer: string | ((event: unknown) => void), handler?: (event: unknown) => void) {
            this.handlers.set(typeof layer === 'string' ? `${event}:${layer}` : event, typeof layer === 'string' ? handler! : layer);
            return this;
        }
        emit(event: string, payload: unknown = {}) { this.handlers.get(event)?.(payload); }
        off(event: string, handler: (event: unknown) => void) {
            if (this.handlers.get(event) === handler) this.handlers.delete(event);
        }
        addControl() {}
        resize() {}
        setStyle = vi.fn();
        loaded = vi.fn(() => false);
        isSourceLoaded = vi.fn(() => false);
        triggerRepaint() {}
        getLayer() { return undefined; }
        getSource = vi.fn();
        isStyleLoaded() { return true; }
        getBounds() { return { getSouth: () => -90, getNorth: () => 90, getWest: () => -180, getEast: () => 180 }; }
        getCenter() { return { lat: 0, lng: 0 }; }
        getZoom() { return 1.2; }
    }
    return {
        Map: MockMap, GPUInitializationError, setWorkerUrl() {}, getVersion: () => 'test',
        NavigationControl: class {}, ScaleControl: class {}, AttributionControl: class {},
        Popup: class { on() { return this; } isOpen() { return false; } remove() {} },
    };
});

const props = {
    items: [], selectedItemId: null, selectionVersion: 0, onSelectItem: vi.fn(),
    isDarkMode: false, animatedEffects: false, onAnimatedEffectsChange: vi.fn(),
    initialCenter: [0, 0] as [number, number], initialZoom: 1.2, sortMode: 'hot' as const,
};
const latestMap = () => mocks.maps.at(-1)!;
const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const loadMap = (map = latestMap()) => act(async () => { map.emit('style.load'); });

describe('map error recovery', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        mocks.maps.length = 0;
        mocks.failure = null;
        mocks.construct.mockClear();
        mocks.layers.mockReset().mockResolvedValue(undefined);
        props.onSelectItem.mockClear();
        vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
    });
    afterEach(() => {
        cleanup();
        vi.useRealTimers();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('publishes the viewport before style loading and does not rebuild the initial style', () => {
        const onBoundsChange = vi.fn();
        render(<NewsMap {...props} onBoundsChange={onBoundsChange} />);
        expect(onBoundsChange).toHaveBeenCalledTimes(1);
        expect(onBoundsChange).toHaveBeenCalledWith(expect.objectContaining({ minLng: -180, maxLng: 180, zoom: 1.2 }));
        expect(mocks.layers).not.toHaveBeenCalled();
        expect(latestMap().setStyle).not.toHaveBeenCalled();
    });

    it('waits for tiles and current story source to render before reporting startup ready', async () => {
        const onLoadStateChange = vi.fn();
        const { rerender } = render(<NewsMap {...props} dataReady={false} onLoadStateChange={onLoadStateChange} />);
        await loadMap();
        const map = latestMap();
        map.loaded.mockReturnValue(true);
        map.isSourceLoaded.mockReturnValue(true);
        act(() => map.emit('render'));
        expect(onLoadStateChange).not.toHaveBeenCalledWith('ready');

        map.loaded.mockReturnValue(false);
        rerender(<NewsMap {...props} dataReady onLoadStateChange={onLoadStateChange} />);
        act(() => map.emit('render'));
        expect(onLoadStateChange).not.toHaveBeenCalledWith('ready');

        map.loaded.mockReturnValue(true);
        map.isSourceLoaded.mockReturnValue(false);
        act(() => map.emit('render'));
        expect(onLoadStateChange).not.toHaveBeenCalledWith('ready');

        map.isSourceLoaded.mockReturnValue(true);
        act(() => map.emit('render'));
        expect(onLoadStateChange).toHaveBeenLastCalledWith('ready');
    });

    it('does not drop story data that arrives while the sidebar is resizing', async () => {
        let resize!: () => void;
        vi.stubGlobal('ResizeObserver', class {
            constructor(callback: () => void) { resize = callback; }
            observe() {} disconnect() {}
        });
        const { rerender } = render(<NewsMap {...props} />);
        const setData = vi.fn();
        latestMap().getSource.mockReturnValue({ setData });
        await loadMap();
        act(() => resize());
        setData.mockClear();
        rerender(<NewsMap {...props} items={[{
            id: 'arrived-during-resize', title: 'New story', source: 'Example', sourceType: 'rss',
            url: 'https://example.com', publishedAt: '2026-09-22T00:00:00Z', latitude: 10, longitude: 20,
        }]} />);
        expect(setData).toHaveBeenCalledWith(expect.objectContaining({ features: [expect.objectContaining({
            properties: expect.objectContaining({ id: 'arrived-during-resize' }),
        })] }));
    });

    it('shows an actionable WebGL error without automatically rebuilding the map', async () => {
        mocks.failure = 'gpu';
        render(<NewsMap {...props} />);
        await advance(1);
        expect(screen.getByRole('alert').textContent).toContain('Enable hardware acceleration');
        await advance(20_000);
        expect(mocks.construct).toHaveBeenCalledTimes(1);
        expect(screen.getByRole('alert').textContent).toContain('Enable hardware acceleration');
    });

    it('times out stalled loading and keeps the same error card until a manual retry succeeds', async () => {
        render(<NewsMap {...props} />);
        act(() => latestMap().emit('error', { error: new Error('Failed to fetch map tile') }));
        expect(mocks.construct).toHaveBeenCalledTimes(1);
        await advance(15_000);
        const alert = screen.getByRole('alert', { name: 'Map unavailable' });
        fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
        expect(screen.getByRole('alert')).toBe(alert);
        expect((screen.getByRole('button', { name: 'Trying again…' }) as HTMLButtonElement).disabled).toBe(true);
        expect(mocks.construct).toHaveBeenCalledTimes(2);
        expect(mocks.maps[0].remove).toHaveBeenCalledTimes(1);
        await loadMap();
        await advance(15_000);
        expect(screen.queryByRole('alert')).toBeNull();
        expect(screen.queryByRole('status')).toBeNull();
    });

    it('coalesces an error burst into one recovery attempt and ignores stale layer completion', async () => {
        let finishLayers!: () => void;
        mocks.layers.mockImplementationOnce(() => new Promise<void>(resolve => { finishLayers = resolve; }));
        render(<NewsMap {...props} />);
        const original = latestMap();
        act(() => {
            original.emit('style.load');
            original.emit('error', { error: new Error('Failed to initialize renderer') });
            original.emit('error', { error: new Error('Failed to initialize renderer again') });
        });
        expect(mocks.construct).toHaveBeenCalledTimes(2);
        await act(async () => { finishLayers(); });
        expect(screen.getByRole('status').textContent).toContain('Loading map');
        await loadMap();
        expect(screen.queryByRole('status')).toBeNull();
    });

    it('rewires story interactions on a replacement map after context loss', async () => {
        render(<NewsMap {...props} />);
        await loadMap();
        const original = latestMap();
        act(() => original.emit('webglcontextlost', { originalEvent: { preventDefault() {} } }));
        await advance(3_000);
        await loadMap();
        expect(latestMap()).not.toBe(original);
        act(() => latestMap().emit('click:unclustered-point', { features: [{ properties: { canonicalId: 'story-1' } }] }));
        expect(props.onSelectItem).toHaveBeenCalledWith('story-1');
    });

    it('bounds automatic initialization retries and gives a manual retry a fresh recovery budget', async () => {
        mocks.failure = 'generic';
        render(<NewsMap {...props} />);
        for (let attempt = 0; attempt < 3; attempt++) await advance(1);
        expect(mocks.construct).toHaveBeenCalledTimes(3);
        expect(screen.getByRole('alert').textContent).toContain('Check your connection');
        fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
        await advance(1);
        expect(mocks.construct).toHaveBeenCalledTimes(5);
        expect(screen.getByRole('button', { name: 'Trying again…' })).toBeTruthy();
    });

    it('clears initialization timers on unmount', async () => {
        mocks.failure = 'generic';
        const { unmount } = render(<NewsMap {...props} />);
        unmount();
        await advance(20_000);
        expect(mocks.construct).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(0);
    });
});
