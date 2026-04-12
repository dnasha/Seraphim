'use client';

/*
Dan Sharan

news map component

uses leaflet and markercluster libraries
*/

import { useEffect, useRef, useState, useMemo } from 'react';
import { NewsItem } from '@/lib/types';
import type { 
    Map as LeafletMap, 
    TileLayer, 
    Marker, 
    MarkerClusterGroup, 
    MarkerCluster, 
    LayerGroup, 
    LatLng, 
    Point, 
    LatLngExpression,
    LeafletMouseEvent
} from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';

import {
    MAP_STYLES,
    createCategoryIcon,
    getCategoryColor,
    formatTimeAgo,
    getSourceBadgeColor
} from './MapConstants';
import MapSettings from './MapSettings';

// Help TypeScript with internal Leaflet properties
interface ExtendedMap extends LeafletMap {
    _getNewPixelOrigin: (center: LatLng, zoom?: number) => Point;
    _getMapPanePos: () => Point;
    _move: (center: LatLng, zoom: number, data?: unknown, suppressEvent?: boolean) => void;
    _moveStart: (zoomChanged: boolean, noMoveStart: boolean) => void;
    _moveEnd: (zoomChanged: boolean) => void;
}

/**
 * Anti-jitter sub-pixel patches
 * Leaflet's _getNewPixelOrigin and latLngToLayerPoint both call ._round(),
 * snapping to integer pixels every frame causing 1px random-direction wobble.
 * We remove rounding during smooth zoom and restore it on settle.
 */
function createSubpixelManager(
    map: LeafletMap,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    L: any // runtime Leaflet object
) {
    const emap = map as unknown as ExtendedMap;
    const origGetNewPixelOrigin = emap._getNewPixelOrigin;
    const origLatLngToLayerPoint = emap.latLngToLayerPoint;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const L_ref = (window as any).L || L;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const origGridSetZoomTransform = (L_ref?.GridLayer?.prototype as any)?._setZoomTransform;

    // Patch Marker prototype globally if not already done
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const MarkerProto = L_ref?.Marker?.prototype as any;
    if (MarkerProto && !MarkerProto._origUpdate) {
        MarkerProto._origUpdate = MarkerProto.update;
        MarkerProto._origAnimateZoom = MarkerProto._animateZoom;

        MarkerProto.update = function () {
            if (this._icon && this._map && (this._map as any)._isSmoothZooming) {
                const pos = this._map.latLngToLayerPoint(this._latlng);
                this._setPos(pos);
                return this;
            }
            return this._origUpdate();
        };

        MarkerProto._animateZoom = function (opt: any) {
            if (this._map && (this._map as any)._isSmoothZooming) {
                const pos = this._map._latLngToNewLayerPoint(this._latlng, opt.zoom, opt.center);
                this._setPos(pos);
                return;
            }
            return this._origAnimateZoom(opt);
        };
    }

    return {
        enable: () => {
            (map as any)._isSmoothZooming = true;
            emap._getNewPixelOrigin = (center: LatLng, zoom?: number) => {
                const viewHalf = emap.getSize().divideBy(2);
                const pt = emap.project(center, zoom)
                    .subtract(viewHalf)
                    .add(emap._getMapPanePos());
                // No rounding here
                return pt;
            };

            emap.latLngToLayerPoint = (latlng: LatLngExpression) => {
                const projectedPoint = emap.project(L.latLng(latlng));
                const pt = projectedPoint.subtract(emap.getPixelOrigin());
                // No rounding here
                return pt;
            };

            if (L_ref?.GridLayer?.prototype) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (L_ref.GridLayer.prototype as any)._setZoomTransform = function (
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    this: any, level: any, center: LatLng, zoom: number
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
            (map as any)._isSmoothZooming = false;
            emap._getNewPixelOrigin = origGetNewPixelOrigin;
            emap.latLngToLayerPoint = origLatLngToLayerPoint;
            if (origGridSetZoomTransform && L_ref?.GridLayer?.prototype) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (L_ref.GridLayer.prototype as any)._setZoomTransform = origGridSetZoomTransform;
            }
        }
    };
}

interface NewsMapProps {
    items: NewsItem[];
    selectedItemId: string | null;
    selectionVersion: number;
    onSelectItem: (id: string | null) => void;
    isDarkMode: boolean;
}

export default function NewsMap({ items, selectedItemId, selectionVersion, onSelectItem, isDarkMode }: NewsMapProps) {
    const mapRef = useRef<LeafletMap | null>(null);
    const tileLayerRef = useRef<TileLayer | null>(null);
    const markersRef = useRef<Map<string, Marker>>(new Map());
    const clusterGroupRef = useRef<MarkerClusterGroup | null>(null);
    const directGroupRef = useRef<LayerGroup | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const initializedRef = useRef(false);
    
    // Store Leaflet module once loaded
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const LRef = useRef<any>(null);

    const [mapReady, setMapReady] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [clusteringEnabled, setClusteringEnabled] = useState(false);
    const settingsPanelRef = useRef<HTMLDivElement>(null);
    const selectedIdRef = useRef(selectedItemId);
    const lastHighlightedIdRef = useRef<string | null>(null);

    useEffect(() => {
        selectedIdRef.current = selectedItemId;
    }, [selectedItemId]);

    const geoItems = useMemo(() => items.filter(i => i.latitude != null && i.longitude != null), [items]);

    // close panel on outside click
    useEffect(() => {
        if (!settingsOpen) return;
        const handleClick = (e: MouseEvent) => {
            const panel = settingsPanelRef.current;
            if (panel && !panel.contains(e.target as Node)) {
                setSettingsOpen(false);
            }
        };
        const timer = setTimeout(() => document.addEventListener('click', handleClick), 0);
        return () => {
            clearTimeout(timer);
            document.removeEventListener('click', handleClick);
        };
    }, [settingsOpen]);

    // initialize map once
    useEffect(() => {
        if (!containerRef.current) return;

        let aborted = false;

        const loadLeaflet = async () => {
            if (!LRef.current) {
                const leafletModule = await import('leaflet');
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                LRef.current = (leafletModule as any).default || leafletModule;
                await import('leaflet.markercluster');
            }
            
            const L = LRef.current;

            if (aborted) return;
            if (initializedRef.current && mapRef.current) return;

            const styleName = isDarkMode ? 'dark' : 'standard';
            const style = MAP_STYLES[styleName];

            const container = containerRef.current!;
            if ((container as unknown as Record<string, unknown>)._leaflet_id) {
                delete (container as unknown as Record<string, unknown>)._leaflet_id;
            }

            const map = L.map(container, {
                center: [40, 10],
                zoom: 2.6,
                zoomControl: false,
                attributionControl: true,
                preferCanvas: true,
                scrollWheelZoom: false,
                minZoom: 2.3,
                zoomSnap: 0,
                zoomDelta: 0.5,
                worldCopyJump: true,
                maxBounds: L.latLngBounds(
                    L.latLng(-85, -Infinity),
                    L.latLng(85, Infinity)
                ),
                maxBoundsViscosity: 1.0,
            });

            // ── Custom Smooth Wheel Zoom (Google Maps-style) ──────────────
            {
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

                    currentZoom += diff * SMOOTH_FACTOR;
                    const center = computeCenter(currentZoom);
                    emap._move(center, currentZoom);

                    rafId = requestAnimationFrame(smoothZoomLoop);
                };

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

                container.addEventListener('wheel', (e: WheelEvent) => {
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
                }, { passive: false });

                const zoomCtrl = new L.Control({ position: 'topright' });
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

                map.on('zoomend', () => {
                    if (!zooming) {
                        targetZoom = map.getZoom();
                        currentZoom = targetZoom;
                    }
                });
            }

            tileLayerRef.current = L.tileLayer(style.url, {
                maxZoom: 19,
                attribution: style.attribution,
                noWrap: false,
            }).addTo(map);

            map.on('click', (e: LeafletMouseEvent) => {
                if ((e.originalEvent as unknown as { _stopped?: boolean })._stopped) return;
                onSelectItem(null);
            });

            mapRef.current = map;
            initializedRef.current = true;
            setTimeout(() => {
                if (!aborted) map.invalidateSize();
            }, 100);
            setMapReady(true);
        };

        loadLeaflet();

        return () => {
            aborted = true;
            if (mapRef.current) {
                mapRef.current.remove();
                mapRef.current = null;
                tileLayerRef.current = null;
                clusterGroupRef.current = null;
                directGroupRef.current = null;
                initializedRef.current = false;
                setMapReady(false);
            }
        };
    }, []); // Only runs once on mount. 

    // Handle map style changes separately to avoid Re-initializing the whole map
    useEffect(() => {
        if (!mapRef.current || !mapReady || !LRef.current) return;
        const L = LRef.current;
        const style = MAP_STYLES[isDarkMode ? 'dark' : 'standard'];
        
        if (tileLayerRef.current) {
            mapRef.current.removeLayer(tileLayerRef.current);
        }

        tileLayerRef.current = L.tileLayer(style.url, {
            maxZoom: 19,
            attribution: style.attribution,
            noWrap: false,
        }).addTo(mapRef.current);
    }, [isDarkMode, mapReady]);


    // handle container resizing
    useEffect(() => {
        if (!mapReady || !mapRef.current || !containerRef.current) return;
        const resizeObserver = new ResizeObserver(() => {
            mapRef.current?.invalidateSize();
        });
        resizeObserver.observe(containerRef.current);
        return () => resizeObserver.disconnect();
    }, [mapReady]);

    // sync markers
    useEffect(() => {
        if (!mapReady || !mapRef.current || !LRef.current) return;
        const L = LRef.current;
        const map = mapRef.current;

        const currentIsClustered = !!clusterGroupRef.current;
        if (currentIsClustered !== clusteringEnabled) {
            if (clusterGroupRef.current) map.removeLayer(clusterGroupRef.current);
            if (directGroupRef.current) map.removeLayer(directGroupRef.current);
            clusterGroupRef.current = null;
            directGroupRef.current = null;
            markersRef.current.clear();
        }

        let targetLayer: LayerGroup | MarkerClusterGroup;
        if (clusteringEnabled) {
            if (!clusterGroupRef.current) {
                const group = L.markerClusterGroup({
                    maxClusterRadius: 35,
                    spiderfyOnMaxZoom: true,
                    showCoverageOnHover: false,
                    zoomToBoundsOnClick: true,
                    disableClusteringAtZoom: 7,
                    removeOutsideVisibleBounds: true,
                    chunkedLoading: true,
                    iconCreateFunction: (cluster: MarkerCluster) => {
                        const count = cluster.getChildCount();
                        let size = 36;
                        let className = 'cluster-small';
                        if (count >= 35) { size = 50; className = 'cluster-large'; }
                        else if (count >= 10) { size = 42; className = 'cluster-medium'; }

                        return L.divIcon({
                            html: `<div class="cluster-icon ${className}"><span>${count}</span></div>`,
                            className: 'custom-cluster-icon',
                            iconSize: [size, size],
                        });
                    },
                });
                clusterGroupRef.current = group;
                map.addLayer(group);
            }
            targetLayer = clusterGroupRef.current!;
        } else {
            if (!directGroupRef.current) {
                const group = L.layerGroup();
                directGroupRef.current = group;
                map.addLayer(group);
            }
            targetLayer = directGroupRef.current!;
        }

        const currentMarkerIds = new Set(markersRef.current.keys());
        const nextItemMap = new Map(geoItems.map(i => [i.id, i]));
        const nextItemIds = new Set(nextItemMap.keys());
        
        const added = Array.from(nextItemIds).filter(id => !currentMarkerIds.has(id));
        const removed = Array.from(currentMarkerIds).filter(id => !nextItemIds.has(id));

        removed.forEach(id => {
            const marker = markersRef.current.get(id);
            if (marker) {
                targetLayer.removeLayer(marker);
                markersRef.current.delete(id);
            }
        });

        const toAdd: Marker[] = [];
        added.forEach(id => {
            const item = nextItemMap.get(id)!;
            const icon = createCategoryIcon(L, item.category, item.id === selectedIdRef.current);
            const marker = L.marker([item.latitude!, item.longitude!], { icon });

            const pinColor = getCategoryColor(item.category);
            const categoryLabel = item.category
                ? `<span class="news-popup-category" style="background:${pinColor}">${item.category}</span>`
                : '';

            const popupHtml = `
                <div class="news-popup">
                ${item.imageUrl ? `<img class="news-popup-img" src="${item.imageUrl}" alt="" referrerpolicy="no-referrer" onerror="this.style.display='none'" />` : ''}
                <div class="news-popup-body">
                    <div class="news-popup-meta">
                    <span class="news-popup-source" style="background:${getSourceBadgeColor(item.source)};color:#fff">${item.source}</span>
                    ${categoryLabel}
                    <span class="news-popup-time">${formatTimeAgo(item.publishedAt)}</span>
                    </div>
                    <h3 class="news-popup-title">${item.title}</h3>
                    ${item.locationName ? `
                    <div class="news-popup-location">
                        <svg class="location-icon-svg" viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
                        <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
                        </svg>
                        ${item.locationName}
                    </div>` : ''}
                    <div class="news-popup-summary">${item.description || ''}</div>
                    <a class="news-popup-link" href="${item.url}" target="_blank" rel="noopener noreferrer">Read full article →</a>
                </div>
                </div>
            `;

            marker.bindPopup(popupHtml, {
                maxWidth: 400,
                minWidth: 320,
                className: 'news-popup-container',
            });

            marker.on('click', (e: LeafletMouseEvent) => {
                L.DomEvent.stopPropagation(e);
                const isSelected = selectedIdRef.current === item.id;
                onSelectItem(isSelected ? null : item.id);
            });

            markersRef.current.set(item.id, marker);
            toAdd.push(marker);
        });

        if (toAdd.length > 0) {
            if (clusteringEnabled) {
                (targetLayer as MarkerClusterGroup).addLayers(toAdd);
            } else {
                toAdd.forEach(m => (targetLayer as LayerGroup).addLayer(m));
            }
        }

        if (geoItems.length > 0 && (added.length > 0 || removed.length > 0)) {
            let itemsToFrame = geoItems.filter(i => i.latitude! > -60 && i.latitude! < 75);
            if (itemsToFrame.length === 0) itemsToFrame = geoItems;
            const bounds = L.latLngBounds(itemsToFrame.map(i => [i.latitude!, i.longitude!] as [number, number]));
            map.fitBounds(bounds, { padding: [40, 40], maxZoom: 6 });
        }
    }, [mapReady, clusteringEnabled, onSelectItem, geoItems]);

    // highlight active marker
    useEffect(() => {
        if (!mapReady || !mapRef.current || !LRef.current) return;
        const L = LRef.current;
        const map = mapRef.current;

        const prevId = lastHighlightedIdRef.current;
        const nextId = selectedItemId;

        if (prevId === nextId && !nextId) return;

        if (prevId && prevId !== nextId) {
            const prevMarker = markersRef.current.get(prevId);
            if (prevMarker) {
                const el = prevMarker.getElement();
                if (el) {
                    const iconInner = el.querySelector('.marker-icon');
                    if (iconInner) iconInner.classList.remove('marker-icon-active');
                }
                const item = geoItems.find(i => i.id === prevId);
                prevMarker.setIcon(createCategoryIcon(L, item?.category, false));
            }
        }
        
        if (nextId) {
            const nextMarker = markersRef.current.get(nextId);
            if (nextMarker) {
                const el = nextMarker.getElement();
                if (el) {
                    const iconInner = el.querySelector('.marker-icon');
                    if (iconInner) iconInner.classList.add('marker-icon-active');
                }
                const item = geoItems.find(i => i.id === nextId);
                nextMarker.setIcon(createCategoryIcon(L, item?.category, true));
                
                const latlng = nextMarker.getLatLng();
                const currentZoom = map.getZoom();
                const targetZoom = Math.max(currentZoom, 7);

                const showPopup = () => {
                    nextMarker.openPopup();
                    const newEl = nextMarker.getElement();
                    if (newEl) {
                        const iconInner = newEl.querySelector('.marker-icon');
                        if (iconInner) iconInner.classList.add('marker-icon-active');
                    }
                };

                const flyToMarker = (targetLatlng: LatLng, zoom: number) => {
                    const p = map.project(targetLatlng, zoom).subtract([0, 140]);
                    const target = map.unproject(p, zoom);
                    const currentCenter = map.getCenter();
                    const dist = currentCenter.distanceTo(target);
                    if (zoom === currentZoom && dist < 50) {
                        showPopup();
                    } else {
                        map.once('moveend', () => setTimeout(showPopup, 50));
                        map.flyTo(target, zoom, { animate: true, duration: 0.8 });
                    }
                };

                if (clusteringEnabled && clusterGroupRef.current) {
                    const visibleParent = clusterGroupRef.current.getVisibleParent(nextMarker);
                    if (visibleParent === nextMarker) {
                        flyToMarker(latlng, targetZoom);
                    } else {
                        clusterGroupRef.current.zoomToShowLayer(nextMarker, () => {
                            setTimeout(() => flyToMarker(latlng, Math.max(map.getZoom(), 7)), 100);
                        });
                    }
                } else {
                    flyToMarker(latlng, targetZoom);
                }
            }
        } else {
            map.closePopup();
        }

        lastHighlightedIdRef.current = nextId;
    }, [selectedItemId, selectionVersion, clusteringEnabled, geoItems, mapReady]);

    return (
        <div className="map-wrapper">
            <MapSettings
                mapStyle={isDarkMode ? 'dark' : 'standard'}
                onStyleChange={() => {}} // Internal style changes handled by isDarkMode prop
                clusteringEnabled={clusteringEnabled}
                onClusteringToggle={() => setClusteringEnabled(v => !v)}
                isOpen={settingsOpen}
                onToggleOpen={() => setSettingsOpen(o => !o)}
                panelRef={settingsPanelRef}
            />
            <div ref={containerRef} id="news-map" className="news-map-container" />
        </div>
    );
}
