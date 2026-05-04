/*
DrawingManager — Native MapLibre GL drawing engine.
Handles geometric drawing (polygons, rectangles, circles, freehand) directly on the map
using MapLibre event handlers and GeoJSON source/layer management.
*/

import maplibregl from 'maplibre-gl';

// Types for drawing modes and features.
export type DrawMode = 'polygon' | 'rectangle' | 'circle' | 'freehand' | 'select' | null;

interface DrawnFeature {
    id: string;
    type: 'polygon' | 'rectangle' | 'circle' | 'freehand';
    coordinates: GeoJSON.Position[][];
    color: string;
}

// Map source and layer identifiers.
const SOURCE_COMPLETED = 'drawing-completed';
const SOURCE_PREVIEW = 'drawing-preview';
const LAYER_FILLS = 'drawing-fills';
const LAYER_OUTLINES = 'drawing-outlines';
const LAYER_PREVIEW_FILL = 'drawing-preview-fill';
const LAYER_PREVIEW_LINE = 'drawing-preview-line';
const LAYER_VERTICES = 'drawing-vertices';
const LAYER_SELECT_HIGHLIGHT = 'drawing-select-highlight';

const EMPTY_FC: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

// Generates a unique ID for drawn features.
function uid(): string {
    return 'draw-' + Math.random().toString(36).slice(2, 10);
}

// Approximates a circle with a polygon given center and radius.
function makeCirclePolygon(center: [number, number], radiusKm: number, steps = 64): GeoJSON.Position[] {
    const coords: GeoJSON.Position[] = [];
    for (let i = 0; i <= steps; i++) {
        const angle = (i / steps) * 2 * Math.PI;
        const dx = radiusKm / (111.32 * Math.cos((center[1] * Math.PI) / 180));
        const dy = radiusKm / 110.574;
        coords.push([center[0] + dx * Math.cos(angle), center[1] + dy * Math.sin(angle)]);
    }
    return coords;
}

// Calculates distance between two points in kilometers using the Haversine formula.
function haversineKm(a: [number, number], b: [number, number]): number {
    const toRad = (d: number) => (d * Math.PI) / 180;
    const dLat = toRad(b[1] - a[1]);
    const dLon = toRad(b[0] - a[0]);
    const lat1 = toRad(a[1]);
    const lat2 = toRad(b[1]);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    return 6371 * 2 * Math.asin(Math.sqrt(h));
}

export class DrawingManager {
    private map: maplibregl.Map;
    private features: Map<string, DrawnFeature> = new Map();
    private mode: DrawMode = null;
    private color: string = '#ef4444';

    // In-progress drawing state
    private vertices: GeoJSON.Position[] = [];
    private isDragging = false;
    private dragOrigin: [number, number] | null = null;

    // Currently selected feature
    private selectedId: string | null = null;

    // Bound event handlers for lifecycle management
    private _onClick: (e: maplibregl.MapMouseEvent) => void;
    private _onMouseMove: (e: maplibregl.MapMouseEvent) => void;
    private _onMouseDown: (e: maplibregl.MapMouseEvent) => void;
    private _onMouseUp: (e: maplibregl.MapMouseEvent) => void;
    private _onDblClick: (e: maplibregl.MapMouseEvent) => void;
    private _onKeyDown: (e: KeyboardEvent) => void;
    private _onContextMenu: (e: maplibregl.MapMouseEvent) => void;

    private _attached = false;

    constructor(map: maplibregl.Map) {
        this.map = map;

        this._onClick = this.handleClick.bind(this);
        this._onMouseMove = this.handleMouseMove.bind(this);
        this._onMouseDown = this.handleMouseDown.bind(this);
        this._onMouseUp = this.handleMouseUp.bind(this);
        this._onDblClick = this.handleDblClick.bind(this);
        this._onKeyDown = this.handleKeyDown.bind(this);
        this._onContextMenu = this.handleContextMenu.bind(this);
    }

    // Lifecycle methods to attach and detach map event listeners.
    attach(): void {
        if (this._attached) return;
        this._attached = true;

        this.ensureSources();

        this.map.on('click', this._onClick);
        this.map.on('mousemove', this._onMouseMove);
        this.map.on('mousedown', this._onMouseDown);
        this.map.on('mouseup', this._onMouseUp);
        this.map.on('dblclick', this._onDblClick);
        this.map.on('contextmenu', this._onContextMenu);
        document.addEventListener('keydown', this._onKeyDown);
    }

    detach(): void {
        if (!this._attached) return;
        this._attached = false;

        this.map.off('click', this._onClick);
        this.map.off('mousemove', this._onMouseMove);
        this.map.off('mousedown', this._onMouseDown);
        this.map.off('mouseup', this._onMouseUp);
        this.map.off('dblclick', this._onDblClick);
        this.map.off('contextmenu', this._onContextMenu);
        document.removeEventListener('keydown', this._onKeyDown);

        this.resetInProgress();
        this.removeSources();
    }

    // Public API for controlling the drawing state.
    setMode(newMode: DrawMode): void {
        // Finish any in-progress drawing before switching
        if (this.vertices.length > 0) {
            this.finishCurrent();
        }
        this.mode = newMode;
        this.selectedId = null;
        this.updateHighlight();

        if (newMode && newMode !== 'select') {
            this.map.dragPan.disable();
            this.map.getCanvas().style.cursor = 'crosshair';
        } else {
            this.map.dragPan.enable();
            this.map.getCanvas().style.cursor = newMode === 'select' ? 'pointer' : '';
        }
    }

    getMode(): DrawMode {
        return this.mode;
    }

    setColor(c: string): void {
        this.color = c;
    }

    clearAll(): void {
        this.features.clear();
        this.resetInProgress();
        this.selectedId = null;
        this.renderCompleted();
        this.renderPreview();
        this.updateHighlight();
    }

    deleteSelected(): void {
        if (this.selectedId) {
            this.features.delete(this.selectedId);
            this.selectedId = null;
            this.renderCompleted();
            this.updateHighlight();
        }
    }

    // Re-creates sources and layers, useful after a map style change.
    reattachLayers(): void {
        this.ensureSources();
        this.renderCompleted();
        this.renderPreview();
        this.updateHighlight();
    }

    // Internal methods for managing MapLibre sources and layers.
    private ensureSources(): void {
        const map = this.map;

        if (!map.getSource(SOURCE_COMPLETED)) {
            map.addSource(SOURCE_COMPLETED, { type: 'geojson', data: EMPTY_FC });
        }
        if (!map.getSource(SOURCE_PREVIEW)) {
            map.addSource(SOURCE_PREVIEW, { type: 'geojson', data: EMPTY_FC });
        }

        if (!map.getLayer(LAYER_FILLS)) {
            map.addLayer({
                id: LAYER_FILLS,
                type: 'fill',
                source: SOURCE_COMPLETED,
                paint: {
                    'fill-color': ['get', 'color'],
                    'fill-opacity': 0.25,
                },
            });
        }

        if (!map.getLayer(LAYER_OUTLINES)) {
            map.addLayer({
                id: LAYER_OUTLINES,
                type: 'line',
                source: SOURCE_COMPLETED,
                paint: {
                    'line-color': ['get', 'color'],
                    'line-width': 2,
                    'line-opacity': 0.9,
                },
            });
        }

        if (!map.getLayer(LAYER_SELECT_HIGHLIGHT)) {
            map.addLayer({
                id: LAYER_SELECT_HIGHLIGHT,
                type: 'line',
                source: SOURCE_COMPLETED,
                filter: ['==', ['get', 'id'], ''],
                paint: {
                    'line-color': '#ffffff',
                    'line-width': 3,
                    'line-dasharray': [3, 2],
                    'line-opacity': 0.9,
                },
            });
        }

        if (!map.getLayer(LAYER_PREVIEW_FILL)) {
            map.addLayer({
                id: LAYER_PREVIEW_FILL,
                type: 'fill',
                source: SOURCE_PREVIEW,
                paint: {
                    'fill-color': ['get', 'color'],
                    'fill-opacity': 0.15,
                },
            });
        }

        if (!map.getLayer(LAYER_PREVIEW_LINE)) {
            map.addLayer({
                id: LAYER_PREVIEW_LINE,
                type: 'line',
                source: SOURCE_PREVIEW,
                paint: {
                    'line-color': ['get', 'color'],
                    'line-width': 2,
                    'line-dasharray': [4, 3],
                    'line-opacity': 0.8,
                },
            });
        }

        if (!map.getLayer(LAYER_VERTICES)) {
            map.addLayer({
                id: LAYER_VERTICES,
                type: 'circle',
                source: SOURCE_PREVIEW,
                filter: ['==', ['geometry-type'], 'Point'],
                paint: {
                    'circle-radius': 4,
                    'circle-color': '#ffffff',
                    'circle-stroke-width': 2,
                    'circle-stroke-color': ['get', 'color'],
                },
            });
        }
    }

    private removeSources(): void {
        const map = this.map;
        const layers = [LAYER_VERTICES, LAYER_PREVIEW_LINE, LAYER_PREVIEW_FILL, LAYER_SELECT_HIGHLIGHT, LAYER_OUTLINES, LAYER_FILLS];
        for (const id of layers) {
            if (map.getLayer(id)) map.removeLayer(id);
        }
        if (map.getSource(SOURCE_COMPLETED)) map.removeSource(SOURCE_COMPLETED);
        if (map.getSource(SOURCE_PREVIEW)) map.removeSource(SOURCE_PREVIEW);
    }

    // Methods for updating the map data based on current state.
    private renderCompleted(): void {
        const src = this.map.getSource(SOURCE_COMPLETED) as maplibregl.GeoJSONSource;
        if (!src) return;

        const features: GeoJSON.Feature[] = [];
        for (const [, f] of this.features) {
            features.push({
                type: 'Feature',
                properties: { id: f.id, color: f.color, drawType: f.type },
                geometry: { type: 'Polygon', coordinates: f.coordinates },
            });
        }
        src.setData({ type: 'FeatureCollection', features });
    }

    private renderPreview(): void {
        const src = this.map.getSource(SOURCE_PREVIEW) as maplibregl.GeoJSONSource;
        if (!src) return;

        const features: GeoJSON.Feature[] = [];

        if (this.vertices.length >= 2) {
            // Polygon preview (close the ring for rendering)
            const ring = [...this.vertices, this.vertices[0]];
            features.push({
                type: 'Feature',
                properties: { color: this.color },
                geometry: { type: 'Polygon', coordinates: [ring] },
            });
        } else if (this.vertices.length === 1) {
            // Just a line segment if we only have one point
            features.push({
                type: 'Feature',
                properties: { color: this.color },
                geometry: { type: 'LineString', coordinates: this.vertices },
            });
        }

        // Add point features for each vertex
        for (const v of this.vertices) {
            features.push({
                type: 'Feature',
                properties: { color: this.color },
                geometry: { type: 'Point', coordinates: v },
            });
        }

        src.setData({ type: 'FeatureCollection', features });
    }

    private updateHighlight(): void {
        if (this.map.getLayer(LAYER_SELECT_HIGHLIGHT)) {
            this.map.setFilter(LAYER_SELECT_HIGHLIGHT, ['==', ['get', 'id'], this.selectedId || '']);
        }
    }

    // Helper methods for managing in-progress drawing state.
    private resetInProgress(): void {
        this.vertices = [];
        this.isDragging = false;
        this.dragOrigin = null;
        this.renderPreview();
    }

    private finishCurrent(): void {
        if (this.vertices.length < 3) {
            this.resetInProgress();
            return;
        }

        const ring = [...this.vertices, this.vertices[0]];
        const id = uid();
        this.features.set(id, {
            id,
            type: this.mode === 'freehand' ? 'freehand' : this.mode === 'circle' ? 'circle' : this.mode === 'rectangle' ? 'rectangle' : 'polygon',
            coordinates: [ring],
            color: this.color,
        });
        this.resetInProgress();
        this.renderCompleted();
    }

    // Event handlers for mouse and keyboard interactions.
    private handleClick(e: maplibregl.MapMouseEvent): void {
        if (!this.mode) return;

        if (this.mode === 'select') {
            this.handleSelectClick(e);
            return;
        }

        if (this.mode === 'polygon') {
            this.vertices.push([e.lngLat.lng, e.lngLat.lat]);
            this.renderPreview();
        }
    }

    private handleDblClick(e: maplibregl.MapMouseEvent): void {
        if (this.mode === 'polygon' && this.vertices.length >= 3) {
            e.preventDefault();
            this.finishCurrent();
        }
    }

    private handleMouseDown(e: maplibregl.MapMouseEvent): void {
        if (!this.mode || this.mode === 'polygon' || this.mode === 'select') return;

        this.isDragging = true;
        this.dragOrigin = [e.lngLat.lng, e.lngLat.lat];

        if (this.mode === 'freehand') {
            this.vertices = [[e.lngLat.lng, e.lngLat.lat]];
        }

        e.preventDefault();
    }

    private handleMouseMove(e: maplibregl.MapMouseEvent): void {
        if (!this.mode) return;

        const lngLat: [number, number] = [e.lngLat.lng, e.lngLat.lat];

        if (this.mode === 'polygon' && this.vertices.length > 0) {
            const previewVerts = [...this.vertices, lngLat];
            const src = this.map.getSource(SOURCE_PREVIEW) as maplibregl.GeoJSONSource;
            if (!src) return;

            const features: GeoJSON.Feature[] = [];

            if (previewVerts.length >= 2) {
                const ring = [...previewVerts, previewVerts[0]];
                features.push({
                    type: 'Feature',
                    properties: { color: this.color },
                    geometry: { type: 'Polygon', coordinates: [ring] },
                });
            }

            for (const v of this.vertices) {
                features.push({
                    type: 'Feature',
                    properties: { color: this.color },
                    geometry: { type: 'Point', coordinates: v },
                });
            }
            src.setData({ type: 'FeatureCollection', features });
            return;
        }

        if (!this.isDragging || !this.dragOrigin) return;

        if (this.mode === 'rectangle') {
            const [ox, oy] = this.dragOrigin;
            this.vertices = [
                [ox, oy],
                [lngLat[0], oy],
                [lngLat[0], lngLat[1]],
                [ox, lngLat[1]],
            ];
            this.renderPreview();
        } else if (this.mode === 'circle') {
            const radius = haversineKm(this.dragOrigin, lngLat);
            if (radius > 0.01) {
                this.vertices = makeCirclePolygon(this.dragOrigin, radius);
                this.renderPreview();
            }
        } else if (this.mode === 'freehand') {
            this.vertices.push(lngLat);
            this.renderPreview();
        }
    }

    private handleMouseUp(): void {
        if (!this.isDragging) return;
        this.isDragging = false;

        if ((this.mode === 'rectangle' || this.mode === 'circle' || this.mode === 'freehand') && this.vertices.length >= 3) {
            this.finishCurrent();
        } else {
            this.resetInProgress();
        }
    }

    private handleSelectClick(e: maplibregl.MapMouseEvent): void {
        const features = this.map.queryRenderedFeatures(e.point, { layers: [LAYER_FILLS] });
        if (features.length > 0) {
            const id = features[0].properties?.id as string;
            this.selectedId = this.selectedId === id ? null : id;
        } else {
            this.selectedId = null;
        }
        this.updateHighlight();
    }

    private handleKeyDown(e: KeyboardEvent): void {
        if (e.key === 'Escape') {
            if (this.vertices.length > 0) {
                this.resetInProgress();
            } else if (this.selectedId) {
                this.selectedId = null;
                this.updateHighlight();
            }
        }
        if (e.key === 'Delete' || e.key === 'Backspace') {
            if (this.selectedId) {
                e.preventDefault();
                this.deleteSelected();
            }
        }
    }

    private handleContextMenu(e: maplibregl.MapMouseEvent): void {
        if (this.mode === 'polygon' && this.vertices.length > 0) {
            e.preventDefault();
            this.vertices.pop();
            this.renderPreview();
        }
    }
}

