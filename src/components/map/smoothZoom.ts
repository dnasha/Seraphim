import type { Map as LeafletMap, LatLng, Point } from 'leaflet';

interface ExtendedMap extends LeafletMap {
    _getNewPixelOrigin: (center: LatLng, zoom?: number) => Point;
    _getMapPanePos: () => Point;
    _move: (center: LatLng, zoom: number, data?: unknown, suppressEvent?: boolean) => void;
    _moveStart: (zoomChanged: boolean, noMoveStart: boolean) => void;
    _moveEnd: (zoomChanged: boolean) => void;
    _latLngToNewLayerPoint: (latlng: LatLng, zoom: number, center: LatLng) => Point;
}

interface SmoothLeafletMap extends ExtendedMap {
    _isSmoothZooming?: boolean;
}

interface MarkerPrototype {
    _origUpdate?: () => void;
    _origAnimateZoom?: (opt: { zoom: number; center: LatLng }) => void;
    update: () => void;
    _animateZoom: (opt: { zoom: number; center: LatLng }) => void;
    _icon?: HTMLElement;
    _map?: SmoothLeafletMap;
    _latlng: LatLng;
    _setPos: (pos: Point) => void;
}

interface GridLayerPrototype {
    _setZoomTransform?: (level: { origin: Point; zoom: number; el: HTMLElement }, center: LatLng, zoom: number) => void;
}

/**
 * Patches Leaflet's internal rendering to allow for sub-pixel precision.
 * Leaflet normally rounds coordinates to integers, which causes "jitter" during smooth zooms.
 */
export function createSubpixelManager(
    map: LeafletMap,
    L: typeof import('leaflet')
) {
    const emap = map as unknown as SmoothLeafletMap;
    const origGetNewPixelOrigin = emap._getNewPixelOrigin;
    const origLatLngToLayerPoint = emap.latLngToLayerPoint;
    const L_ref = (window as unknown as { L?: typeof import('leaflet') }).L || L;
    const GridLayerProto = L_ref?.GridLayer?.prototype as GridLayerPrototype;
    const origGridSetZoomTransform = GridLayerProto?._setZoomTransform;

    // Patch Marker prototype globally if not already done
    const MarkerProto = L_ref?.Marker?.prototype as unknown as MarkerPrototype;
    if (MarkerProto && !MarkerProto._origUpdate) {
        MarkerProto._origUpdate = MarkerProto.update;
        MarkerProto._origAnimateZoom = MarkerProto._animateZoom;

        MarkerProto.update = function (this: MarkerPrototype) {
            if (this._icon && this._map && this._map._isSmoothZooming) {
                const pos = this._map.latLngToLayerPoint(this._latlng);
                this._setPos(pos);
                return this;
            }
            this._origUpdate?.();
            return this;
        };

        MarkerProto._animateZoom = function (this: MarkerPrototype, opt: { zoom: number; center: LatLng }) {
            if (this._map && this._map._isSmoothZooming) {
                const pos = this._map._latLngToNewLayerPoint(this._latlng, opt.zoom, opt.center);
                this._setPos(pos);
                return;
            }
            return this._origAnimateZoom?.(opt);
        };
    }

    return {
        enable: () => {
            emap._isSmoothZooming = true;
            emap._getNewPixelOrigin = (center: LatLng, zoom?: number) => {
                const viewHalf = emap.getSize().divideBy(2);
                const pt = emap.project(center, zoom)
                    .subtract(viewHalf)
                    .add(emap._getMapPanePos());
                // No rounding here
                return pt;
            };

            emap.latLngToLayerPoint = (latlng: LatLng) => {
                const projectedPoint = emap.project(L.latLng(latlng));
                const pt = projectedPoint.subtract(emap.getPixelOrigin());
                // No rounding here
                return pt;
            };

            if (GridLayerProto) {
                GridLayerProto._setZoomTransform = function (
                    this: { _map: SmoothLeafletMap }, 
                    level: { origin: Point; zoom: number; el: HTMLElement }, 
                    center: LatLng, 
                    zoom: number
                ) {
                    const scale = this._map.getZoomScale(zoom, level.zoom);
                    const translate = level.origin.multiplyBy(scale)
                        .subtract((this._map as ExtendedMap)._getNewPixelOrigin(center, zoom));
                    
                    // sub-pixel precision for tiles too
                    if (L_ref.Browser.any3d) {
                        L_ref.DomUtil.setTransform(level.el, translate, scale);
                    } else {
                        L_ref.DomUtil.setPosition(level.el, translate);
                    }
                };
            }
        },
        disable: () => {
            emap._isSmoothZooming = false;
            emap._getNewPixelOrigin = origGetNewPixelOrigin;
            emap.latLngToLayerPoint = origLatLngToLayerPoint;
            if (origGridSetZoomTransform && GridLayerProto) {
                GridLayerProto._setZoomTransform = origGridSetZoomTransform;
            }
        }
    };
}

/**
 * Implements Google Maps-style smooth continuous zoom for Leaflet.
 */
export function setupSmoothZoom(map: LeafletMap, L: typeof import('leaflet'), container: HTMLElement) {
    const emap = map as unknown as ExtendedMap;
    const subpixel = createSubpixelManager(map, L);

    let targetZoom = map.getZoom();
    let currentZoom = targetZoom;
    let rafId: number | null = null;
    let zooming = false;

    let anchorLatLng: LatLng | null = null;
    let anchorContainerPt: Point | null = null;

    const SMOOTH_FACTOR = 0.18;
    const ZOOM_SPEED = 1 / 220;
    const EPSILON = 0.0005;

    /**
     * Calculates the map center required to keep a specific LatLng at a fixed screen position.
     */
    const computeCenter = (zoom: number): LatLng => {
        if (anchorLatLng && anchorContainerPt) {
            const worldPt = emap.project(anchorLatLng, zoom);
            const viewHalf = emap.getSize().divideBy(2);
            return emap.unproject(
                worldPt.subtract(anchorContainerPt).add(viewHalf),
                zoom
            );
        }
        return emap.getCenter();
    };

    /**
     * The main interpolation loop for smooth zooming.
     */
    const smoothZoomLoop = () => {
        const diff = targetZoom - currentZoom;

        if (Math.abs(diff) < EPSILON) {
            currentZoom = targetZoom;
            subpixel.disable();
            const center = computeCenter(currentZoom);
            emap._move(center, currentZoom);
            emap._moveEnd(true);
            zooming = false;
            anchorLatLng = null;
            anchorContainerPt = null;
            rafId = null;
            return;
        }

        // move incrementally towards target zoom
        currentZoom += diff * SMOOTH_FACTOR;
        const center = computeCenter(currentZoom);
        emap._move(center, currentZoom);

        rafId = requestAnimationFrame(smoothZoomLoop);
    };

    /**
     * Locks the interaction anchor point and prepares for a zoom sequence.
     */
    const beginZoom = (containerPt: Point) => {
        zooming = true;
        currentZoom = emap.getZoom();
        targetZoom = currentZoom;
        subpixel.enable();
        anchorContainerPt = containerPt;
        anchorLatLng = emap.containerPointToLatLng(anchorContainerPt);
        emap._moveStart(true, false);
    };

    const kick = () => {
        if (rafId === null) {
            rafId = requestAnimationFrame(smoothZoomLoop);
        }
    };

    const wheelHandler = (e: WheelEvent) => {
        e.preventDefault();
        e.stopPropagation();

        let delta = e.deltaY;
        if (e.deltaMode === 1) delta *= 40;
        else if (e.deltaMode === 2) delta *= 800;

        if (!zooming) {
            const rect = container.getBoundingClientRect();
            beginZoom(L.point(
                Math.round(e.clientX - rect.left),
                Math.round(e.clientY - rect.top),
            ));
        }

        targetZoom -= delta * ZOOM_SPEED;
        targetZoom = Math.max(map.getMinZoom(), Math.min(map.getMaxZoom(), targetZoom));
        kick();
    };

    // disable passive listener to allow preventDefault for smooth zoom hijacking
    container.addEventListener('wheel', wheelHandler, { passive: false });

    // custom zoom control to trigger the smooth logic
    const zoomCtrl = new (L.Control as unknown as new (options: { position: string }) => import('leaflet').Control)({ position: 'topright' });
    zoomCtrl.onAdd = function () {
        const div = L.DomUtil.create('div', 'leaflet-control-zoom leaflet-bar');
        const btnIn = L.DomUtil.create('a', 'leaflet-control-zoom-in', div);
        btnIn.innerHTML = '+';
        btnIn.href = '#';
        btnIn.title = 'Zoom in';
        btnIn.setAttribute('role', 'button');
        btnIn.setAttribute('aria-label', 'Zoom in');

        const btnOut = L.DomUtil.create('a', 'leaflet-control-zoom-out', div);
        btnOut.innerHTML = '&#x2212;';
        btnOut.href = '#';
        btnOut.title = 'Zoom out';
        btnOut.setAttribute('role', 'button');
        btnOut.setAttribute('aria-label', 'Zoom out');

        const handleBtn = (delta: number) => (e: Event) => {
            L.DomEvent.preventDefault(e);
            L.DomEvent.stopPropagation(e);
            if (!zooming) {
                const sz = map.getSize();
                beginZoom(L.point(sz.x / 2, sz.y / 2));
            }
            targetZoom += delta;
            targetZoom = Math.max(map.getMinZoom(), Math.min(map.getMaxZoom(), targetZoom));
            kick();
        };

        L.DomEvent.on(btnIn, 'click', handleBtn(1));
        L.DomEvent.on(btnOut, 'click', handleBtn(-1));
        L.DomEvent.disableClickPropagation(div);
        L.DomEvent.disableScrollPropagation(div);
        return div;
    };
    zoomCtrl.addTo(map);

    const zoomEndHandler = () => {
        if (!zooming) {
            targetZoom = map.getZoom();
            currentZoom = targetZoom;
        }
    };
    map.on('zoomend', zoomEndHandler);

    return () => {
        container.removeEventListener('wheel', wheelHandler);
        map.off('zoomend', zoomEndHandler);
        if (rafId !== null) cancelAnimationFrame(rafId);
        map.removeControl(zoomCtrl);
    };
}
