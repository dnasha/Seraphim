import type * as maplibregl from 'maplibre-gl';
import type { ActivityHeatmapData } from './data';

export const ACTIVITY_SOURCE = 'experiment-activity-heatmap-source';
export const ACTIVITY_LAYER = 'experiment-activity-heatmap-density';
export const ACTIVITY_HIT_LAYER = 'experiment-activity-heatmap-hit';
export const ACTIVITY_COLORS = {
    light: ['#2563eb', '#0891b2', '#7c3aed', '#be185d'],
    dark: ['#60a5fa', '#22d3ee', '#a78bfa', '#f472b6'],
} as const;
const ORDINARY_LAYERS = ['clusters-circle', 'clusters-count', 'unclustered-point', 'unclustered-point-active', 'hot-story-pulse'];

export type ActivityHeatmapState = { enabled: boolean; dark: boolean; data: ActivityHeatmapData };

export function activityHeatmapPaint(dark: boolean): NonNullable<maplibregl.HeatmapLayerSpecification['paint']> {
    const colors = ACTIVITY_COLORS[dark ? 'dark' : 'light'];
    return {
        'heatmap-weight': ['get', 'weight'],
        'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 0, 0.45, 7, 0.8, 14, 1.2],
        // Bounded screen-space kernels keep high zoom usable and mobile fill cost low.
        'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 0, 14, 7, 24, 14, 32, 18, 36],
        'heatmap-opacity': ['interpolate', ['linear'], ['zoom'], 0, 0.72, 8, 0.8, 18, 0.6],
        'heatmap-color': ['interpolate', ['linear'], ['heatmap-density'],
            0, 'rgba(0,0,0,0)', 0.15, colors[0], 0.4, colors[1], 0.7, colors[2], 1, colors[3]],
    };
}

/** Idempotent for toggle, style replacement, and map/context recreation. */
export function syncActivityHeatmap(map: maplibregl.Map, state: ActivityHeatmapState) {
    for (const id of ORDINARY_LAYERS) {
        if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', state.enabled ? 'none' : 'visible');
    }
    if (!state.enabled) {
        for (const id of [ACTIVITY_HIT_LAYER, ACTIVITY_LAYER]) {
            if (map.getLayer(id)) map.removeLayer(id);
        }
        if (map.getSource(ACTIVITY_SOURCE)) map.removeSource(ACTIVITY_SOURCE);
        return;
    }
    const source = map.getSource(ACTIVITY_SOURCE) as maplibregl.GeoJSONSource | undefined;
    if (source) source.setData(state.data);
    else map.addSource(ACTIVITY_SOURCE, { type: 'geojson', data: state.data, cluster: false });
    if (!map.getLayer(ACTIVITY_LAYER)) {
        map.addLayer({ id: ACTIVITY_LAYER, type: 'heatmap', source: ACTIVITY_SOURCE, paint: activityHeatmapPaint(state.dark) },
            map.getLayer('clusters-circle') ? 'clusters-circle' : undefined);
    } else {
        map.setPaintProperty(ACTIVITY_LAYER, 'heatmap-color', activityHeatmapPaint(state.dark)['heatmap-color']);
    }
    if (!map.getLayer(ACTIVITY_HIT_LAYER)) {
        map.addLayer({
            id: ACTIVITY_HIT_LAYER, type: 'circle', source: ACTIVITY_SOURCE,
            paint: {
                'circle-radius': ['interpolate', ['linear'], ['zoom'], 0, 1.5, 7, 2, 12, 3],
                'circle-color': state.dark ? '#f8fafc' : '#172554',
                'circle-opacity': ['interpolate', ['linear'], ['zoom'], 0, 0.12, 7, 0.2, 14, 0.42],
            },
        }, map.getLayer('selected-point-active') ? 'selected-point-active' : undefined);
    } else {
        map.setPaintProperty(ACTIVITY_HIT_LAYER, 'circle-color', state.dark ? '#f8fafc' : '#172554');
    }
}

/** A forgiving touch target around small dots; the existing selected marker owns its click. */
export function activityHitId(map: maplibregl.Map, point: maplibregl.Point): string | null {
    if (!map.getLayer(ACTIVITY_HIT_LAYER)) return null;
    const layers = [ACTIVITY_HIT_LAYER, 'selected-point-active'].filter(id => map.getLayer(id));
    const hits = map.queryRenderedFeatures([[point.x - 8, point.y - 8], [point.x + 8, point.y + 8]], { layers });
    if (hits.some(hit => hit.layer.id === 'selected-point-active')) return null;
    // Canonical ids deliberately resolve the representative's individual detail.
    // Never use a cluster-z id or pretend a representative is a cluster expansion.
    const id: unknown = hits[0]?.properties.canonicalId;
    return typeof id === 'string' ? id : null;
}
