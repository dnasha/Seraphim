import { describe, expect, it, vi } from 'vitest';
import type * as maplibregl from 'maplibre-gl';
import { activityWeight, buildActivityHeatmapData } from '@/components/map/activityHeatmap/data';
import { ACTIVITY_SOURCE, ACTIVITY_LAYER, ACTIVITY_HIT_LAYER, activityHeatmapPaint, activityHitId, syncActivityHeatmap } from '@/components/map/activityHeatmap/layers';
import { applyClientJitter } from '@/components/map/utils';
import { mapActivityFixture } from './fixtures/mapActivity';

const event = mapActivityFixture[0];

describe('activity heatmap data', () => {
    it('weights raw events once, ignoring source volume and impact, and uses aggregate storyCount', () => {
        expect(activityWeight({ ...event, storyCount: undefined, sourcesCount: 500, impactScore: 999 })).toBe(1);
        expect(activityWeight({ ...event, storyCount: 20 })).toBe(20);
        for (const count of [0, -1, 1.5, NaN, Infinity, Number.MAX_VALUE]) expect(activityWeight({ ...event, storyCount: count })).toBe(1);
    });
    it('never double counts repeated representatives or their individual detail', () => {
        const detail = { ...event, id: 'event-a' };
        const aggregate = { ...event, id: 'cluster-z3-event-a', originalId: 'event-a', storyCount: 15 };
        for (const items of [[detail, aggregate, aggregate], [aggregate, detail]]) {
            const data = buildActivityHeatmapData(items);
            expect(data.features).toHaveLength(1);
            expect(data.features[0].properties).toEqual({ canonicalId: 'event-a', weight: 15 });
            expect(JSON.stringify(data)).not.toContain('cluster-z');
        }
    });
    it('preserves original collocated coordinates instead of pin jitter, without mutating input', () => {
        const a = { ...event, id: 'a' }, b = { ...event, id: 'b' };
        const jittered = applyClientJitter([a, b]);
        expect(jittered[1].latitude).not.toBe(b.latitude);
        expect(buildActivityHeatmapData([a, b]).features.map(feature => feature.geometry.coordinates))
            .toEqual([[a.longitude, a.latitude], [b.longitude, b.latitude]]);
        expect(b.latitude).toBe(event.latitude);
    });
    it('rejects missing, nonfinite or out of bounds coordinates and handles empty data', () => {
        expect(buildActivityHeatmapData([event, ...[undefined, NaN, Infinity, 91].map(latitude => ({ ...event, id: String(latitude), latitude })),
            { ...event, id: 'bad-lon', longitude: 181 }]).features).toHaveLength(1);
        expect(buildActivityHeatmapData([]).features).toEqual([]);
        expect(buildActivityHeatmapData([{ ...event, longitude: -180, latitude: 90 }]).features).toHaveLength(1);
    });
    it('keeps the 1,000-item worker payload small and contains only geometry, identity and weight', () => {
        const data = buildActivityHeatmapData(mapActivityFixture);
        expect(data.features).toHaveLength(1_000);
        expect(JSON.stringify(data).length).toBeLessThan(160_000);
        expect(Object.keys(data.features[0].properties)).toEqual(['canonicalId', 'weight']);
        // Filtering/replay changes only the input; no cached or additional events leak back in.
        expect(buildActivityHeatmapData(mapActivityFixture.slice(0, 10)).features).toHaveLength(10);
    });
});

function layerMap() {
    const layers = new Map<string, maplibregl.LayerSpecification>();
    for (const id of ['clusters-circle', 'clusters-count', 'unclustered-point', 'unclustered-point-active', 'hot-story-pulse', 'selected-point-active']) {
        layers.set(id, { id, type: 'circle', source: 'news-events', layout: { visibility: 'visible' } });
    }
    const sources = new Map<string, { options: maplibregl.SourceSpecification; setData: ReturnType<typeof vi.fn> }>();
    const map = {
        getLayer: (id: string) => layers.get(id), getSource: (id: string) => sources.get(id),
        setLayoutProperty: vi.fn((id: string, property: string, value: string) => { Object.assign(layers.get(id)!.layout!, { [property]: value }); }),
        addSource: vi.fn((id: string, options: maplibregl.SourceSpecification) => sources.set(id, { options, setData: vi.fn() })),
        addLayer: vi.fn((layer: maplibregl.LayerSpecification) => layers.set(layer.id, layer)),
        setPaintProperty: vi.fn(), removeLayer: vi.fn((id: string) => layers.delete(id)),
        removeSource: vi.fn((id: string) => sources.delete(id)), queryRenderedFeatures: vi.fn(),
    };
    return { map: map as unknown as maplibregl.Map, calls: map, layers, sources };
}

describe('heatmap rendering modes', () => {
    it('uses an unclustered source, hides ordinary clutter, keeps selection and restores mode on disable', () => {
        const { map, calls, layers, sources } = layerMap();
        const state = { enabled: true, dark: false, data: buildActivityHeatmapData([event]) };
        syncActivityHeatmap(map, state);
        expect(sources.get(ACTIVITY_SOURCE)?.options).toMatchObject({ cluster: false, data: state.data });
        for (const id of ['clusters-circle', 'clusters-count', 'hot-story-pulse', 'unclustered-point', 'unclustered-point-active']) expect(layers.get(id)?.layout?.visibility).toBe('none');
        expect(layers.get('selected-point-active')?.layout?.visibility).toBe('visible');
        expect(calls.addLayer).toHaveBeenCalledWith(expect.objectContaining({ id: ACTIVITY_LAYER }), 'clusters-circle');
        expect(calls.addLayer).toHaveBeenCalledWith(expect.objectContaining({ id: ACTIVITY_HIT_LAYER }), 'selected-point-active');
        syncActivityHeatmap(map, { ...state, enabled: false });
        expect(layers.has(ACTIVITY_LAYER)).toBe(false);
        expect(sources.has(ACTIVITY_SOURCE)).toBe(false);
        expect(layers.get('clusters-circle')?.layout?.visibility).toBe('visible');
        expect(layers.get('unclustered-point')?.layout?.visibility).toBe('visible');
        syncActivityHeatmap(map, { ...state, enabled: false });
        expect(calls.removeSource).toHaveBeenCalledTimes(1);
    });
    it('updates displayed data and theme and reinstalls after styles/context recreation without duplicates', () => {
        const { map, calls, layers, sources } = layerMap();
        const state = { enabled: true, dark: false, data: buildActivityHeatmapData([event]) };
        syncActivityHeatmap(map, state);
        const empty = buildActivityHeatmapData([]);
        syncActivityHeatmap(map, { ...state, dark: true, data: empty });
        expect(calls.addSource).toHaveBeenCalledTimes(1);
        expect(sources.get(ACTIVITY_SOURCE)?.setData).toHaveBeenCalledWith(empty);
        expect(calls.setPaintProperty).toHaveBeenCalledWith(ACTIVITY_LAYER, 'heatmap-color', activityHeatmapPaint(true)['heatmap-color']);
        layers.delete(ACTIVITY_LAYER); layers.delete(ACTIVITY_HIT_LAYER); sources.clear();
        syncActivityHeatmap(map, state);
        expect(calls.addSource).toHaveBeenCalledTimes(2);
        expect(layers.has(ACTIVITY_HIT_LAYER)).toBe(true);
    });
    it('provides canonical small-dot interaction with touch tolerance and preserves selected clicks', () => {
        const { map, calls } = layerMap();
        expect(activityHitId(map, { x: 20, y: 30 } as maplibregl.Point)).toBeNull();
        syncActivityHeatmap(map, { enabled: true, dark: false, data: buildActivityHeatmapData([event]) });
        calls.queryRenderedFeatures.mockReturnValue([{ layer: { id: ACTIVITY_HIT_LAYER }, properties: { canonicalId: 'representative-a' } }]);
        expect(activityHitId(map, { x: 20, y: 30 } as maplibregl.Point)).toBe('representative-a');
        expect(calls.queryRenderedFeatures).toHaveBeenCalledWith([[12, 22], [28, 38]], { layers: [ACTIVITY_HIT_LAYER, 'selected-point-active'] });
        calls.queryRenderedFeatures.mockReturnValue([{ layer: { id: 'selected-point-active' }, properties: { canonicalId: 'selected' } }]);
        expect(activityHitId(map, { x: 20, y: 30 } as maplibregl.Point)).toBeNull();
        calls.queryRenderedFeatures.mockReturnValue([]);
        expect(activityHitId(map, { x: 20, y: 30 } as maplibregl.Point)).toBeNull();
    });
});
