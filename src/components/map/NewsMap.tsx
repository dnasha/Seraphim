/*
Main Map component for the Seraphim OSINT aggregator.
Renders an interactive map using MapLibre GL JS, handles news item clustering,
popups, overlays, and camera animations.
*/

'use client';

import { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { NewsItem } from '@/lib/types';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { BBox } from '@/hooks/useNewsData';

import { getMapLibreStyle, generateCategoryIcon, formatTimeAgo, getSourceBadgeColor, getCategoryColor } from './MapConstants';
import MapSettings from './MapSettings';
import MapActionTools from './MapActionTools';
import styles from './NewsMap.module.css';

interface NewsMapProps {
    items: NewsItem[];
    selectedItemId: string | null;
    selectionVersion: number;
    onSelectItem: (id: string | null) => void;
    isDarkMode: boolean;
    mappedOnly: boolean;
    onMappedOnlyChange: (val: boolean) => void;
    onBoundsChange?: (bbox: BBox) => void;
}

const CATEGORIES = ['general', 'world', 'crisis', 'nation', 'business', 'technology', 'science', 'health'];

export default function NewsMap({ items, selectedItemId, selectionVersion, onSelectItem, isDarkMode, mappedOnly, onMappedOnlyChange, onBoundsChange }: NewsMapProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const mapRef = useRef<maplibregl.Map | null>(null);
    const popupRef = useRef<maplibregl.Popup | null>(null);
    const eventsWiredRef = useRef(false);
    const [mapReady, setMapReady] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [forceIndividualPins, setForceIndividualPins] = useState(false);
    const [currentStyle, setCurrentStyle] = useState<string>(isDarkMode ? 'dark' : 'standard');
    const [overlays, setOverlays] = useState<Record<string, boolean>>({
        usgs: false,
        noaa: false,
        eonet: false
    });
    
    const settingsPanelRef = useRef<HTMLDivElement>(null);

    const onBoundsChangeRef = useRef(onBoundsChange);
    const onSelectItemRef = useRef(onSelectItem);
    const forceIndividualPinsRef = useRef(forceIndividualPins);
    const overlaysRef = useRef(overlays);

    const boundsDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Track the last selection to prevent redundant camera animations during re-renders.
    const lastFlownSelectionRef = useRef<string | null>(null);
    const lastFlownVersionRef = useRef(0);

    // Cache for GeoJSON data to restore it after map style reloads.
    const pendingGeoJsonRef = useRef<GeoJSON.FeatureCollection | null>(null);

    // Guard to prevent deselecting items when the popup is programmatically removed during flyTo.
    const isFlyingRef = useRef(false);

    useEffect(() => { onBoundsChangeRef.current = onBoundsChange; }, [onBoundsChange]);
    useEffect(() => { onSelectItemRef.current = onSelectItem; }, [onSelectItem]);
    useEffect(() => { forceIndividualPinsRef.current = forceIndividualPins; }, [forceIndividualPins]);
    useEffect(() => { overlaysRef.current = overlays; }, [overlays]);
    useEffect(() => { setCurrentStyle(isDarkMode ? 'dark' : 'standard'); }, [isDarkMode]);

    const geoItems = useMemo(() => items.filter(i => i.latitude != null && i.longitude != null), [items]);

    // Emits the current map bounds with a debounce to avoid excessive API calls.
    const emitBounds = useCallback((map: maplibregl.Map) => {
        if (boundsDebounceRef.current) clearTimeout(boundsDebounceRef.current);
        boundsDebounceRef.current = setTimeout(() => {
            const bounds = map.getBounds();
            const bbox: BBox = {
                minLat: bounds.getSouth(),
                maxLat: bounds.getNorth(),
                minLng: bounds.getWest(),
                maxLng: bounds.getEast(),
                zoom: map.getZoom(),
                forceRaw: forceIndividualPinsRef.current,
            };
            onBoundsChangeRef.current?.(bbox);
        }, 150);
    }, []);

    // Registers icons, sources, and layers. Called on map initialization and style changes.
    const addSourcesAndLayers = useCallback(async (map: maplibregl.Map) => {
        // Register category icons (idempotent and async-safe)
        const iconsToLoad = CATEGORIES.flatMap(cat => [
            { name: `${cat}_inactive`, active: false, cat },
            { name: `${cat}_active`, active: true, cat }
        ]).filter(item => !map.hasImage(item.name));

        if (iconsToLoad.length > 0) {
            const loaded = await Promise.all(iconsToLoad.map(async (item) => ({
                name: item.name,
                img: await generateCategoryIcon(item.cat, item.active)
            })));
            
            for (const { name, img } of loaded) {
                if (!map.hasImage(name)) {
                    try { map.addImage(name, img); } catch { /* ignore race-condition errors if style reloaded during load */ }
                }
            }
        }

        // Configure GeoJSON source with client-side clustering.
        if (!map.getSource('news-events')) {
            map.addSource('news-events', {
                type: 'geojson',
                data: pendingGeoJsonRef.current || { type: 'FeatureCollection', features: [] },
                cluster: !forceIndividualPinsRef.current,
                clusterMaxZoom: 5,
                clusterRadius: 20,
                clusterProperties: {
                    summedEventCount: ['+', ['coalesce', ['get', 'eventCount'], 1]]
                }
            });
        }

        // Layer for inactive individual news pins.
        if (!map.getLayer('unclustered-point')) {
            map.addLayer({
                id: 'unclustered-point',
                type: 'symbol',
                source: 'news-events',
                filter: ['all',
                    ['!', ['any', ['has', 'point_count'], ['>', ['coalesce', ['get', 'eventCount'], 0], 1]]],
                    ['!=', ['get', 'id'], '']
                ],
                layout: {
                    'icon-image': ['concat', ['coalesce', ['get', 'category'], 'general'], '_inactive'],
                    'icon-allow-overlap': true,
                    'icon-ignore-placement': true,
                },
                paint: {
                    'icon-opacity': [
                        'interpolate', ['linear'], ['zoom'],
                        4, 0.4,
                        8, 1.0
                    ]
                }
            });
        }

        // Layer for the currently selected news pin.
        if (!map.getLayer('unclustered-point-active')) {
            map.addLayer({
                id: 'unclustered-point-active',
                type: 'symbol',
                source: 'news-events',
                filter: ['all',
                    ['!', ['any', ['has', 'point_count'], ['>', ['coalesce', ['get', 'eventCount'], 0], 1]]],
                    ['==', ['get', 'id'], '']
                ],
                layout: {
                    'icon-image': ['concat', ['coalesce', ['get', 'category'], 'general'], '_active'],
                    'icon-allow-overlap': true,
                    'icon-ignore-placement': true,
                },
                paint: {
                    'icon-opacity': [
                        'interpolate', ['linear'], ['zoom'],
                        4, 0.6,
                        8, 1.0
                    ]
                }
            });
        }

        // Circle layer for clustered news items.
        if (!map.getLayer('clusters-circle')) {
            map.addLayer({
                id: 'clusters-circle',
                type: 'circle',
                source: 'news-events',
                filter: ['any', ['has', 'point_count'], ['>', ['coalesce', ['get', 'eventCount'], 0], 1]],
                layout: {
                    'circle-sort-key': ['coalesce', ['get', 'summedEventCount'], ['get', 'eventCount'], 0]
                },
                paint: {
                    'circle-color': [
                        'step', ['coalesce', ['get', 'summedEventCount'], ['get', 'eventCount'], 0],
                        '#fca5a5', 10,
                        '#f87171', 25,
                        '#ef4444', 50,
                        '#dc2626', 100,
                        '#b91c1c', 250,
                        '#991b1b', 500,
                        '#7f1d1d'
                    ],
                    'circle-radius': [
                        'interpolate', ['linear'], ['coalesce', ['get', 'summedEventCount'], ['get', 'eventCount'], 0],
                        2, 14,
                        10, 18,
                        50, 22,
                        100, 26,
                        250, 28,
                        500, 32,
                        1000, 36
                    ],
                    'circle-opacity': [
                        'interpolate', ['linear'], ['coalesce', ['get', 'summedEventCount'], ['get', 'eventCount'], 0],
                        2, 0.80,
                        20, 0.85,
                        100, 0.90,
                        500, 0.93,
                        1000, 0.95
                    ],
                    'circle-stroke-width': 2,
                    'circle-stroke-color': '#ffffff'
                }
            });
        }

        // Numeric labels for news clusters.
        if (!map.getLayer('clusters-count')) {
            map.addLayer({
                id: 'clusters-count',
                type: 'symbol',
                source: 'news-events',
                filter: ['any', ['has', 'point_count'], ['>', ['coalesce', ['get', 'eventCount'], 0], 1]],
                layout: {
                    'symbol-sort-key': ['*', -1, ['coalesce', ['get', 'summedEventCount'], ['get', 'eventCount'], 0]],
                    'text-field': ['to-string', ['coalesce', ['get', 'summedEventCount'], ['get', 'eventCount']]],
                    'text-size': 12,
                    'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
                    'text-allow-overlap': false,
                    'text-ignore-placement': false,
                    'text-padding': 6
                },
                paint: { 
                    'text-color': '#ffffff'
                }
            });
        }

        // USGS Earthquake live overlay.
        if (!map.getSource('overlay-usgs')) {
            map.addSource('overlay-usgs', {
                type: 'geojson',
                data: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson'
            });
        }
        if (!map.getLayer('overlay-usgs-point')) {
            map.addLayer({
                id: 'overlay-usgs-point',
                type: 'circle',
                source: 'overlay-usgs',
                layout: { visibility: overlaysRef.current['usgs'] ? 'visible' : 'none' },
                paint: {
                    'circle-radius': [
                        'interpolate', ['linear'], ['get', 'mag'],
                        1, 4,
                        5, 12,
                        8, 24
                    ],
                    'circle-color': '#f59e0b',
                    'circle-opacity': 0.6,
                    'circle-stroke-width': 1,
                    'circle-stroke-color': '#ffffff'
                }
            }, 'clusters-circle');
        }

        // NOAA Weather Radar live overlay.
        if (!map.getSource('overlay-noaa')) {
            map.addSource('overlay-noaa', {
                type: 'raster',
                tiles: [
                    'https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/nexrad-n0q-900913/{z}/{x}/{y}.png',
                    'https://mesonet1.agron.iastate.edu/cache/tile.py/1.0.0/nexrad-n0q-900913/{z}/{x}/{y}.png',
                    'https://mesonet2.agron.iastate.edu/cache/tile.py/1.0.0/nexrad-n0q-900913/{z}/{x}/{y}.png',
                    'https://mesonet3.agron.iastate.edu/cache/tile.py/1.0.0/nexrad-n0q-900913/{z}/{x}/{y}.png'
                ],
                tileSize: 256
            });
        }
        if (!map.getLayer('overlay-noaa-raster')) {
            map.addLayer({
                id: 'overlay-noaa-raster',
                type: 'raster',
                source: 'overlay-noaa',
                layout: { visibility: overlaysRef.current['noaa'] ? 'visible' : 'none' },
                paint: { 'raster-opacity': 0.6 }
            }, 'clusters-circle');
        }

        // NASA EONET (Disasters) live overlay.
        if (!map.getSource('overlay-eonet')) {
            map.addSource('overlay-eonet', {
                type: 'geojson',
                data: 'https://eonet.gsfc.nasa.gov/api/v3/events/geojson?status=open&days=30&category=wildfires,volcanoes,severeStorms,floods'
            });
        }
        if (!map.getLayer('overlay-eonet-point')) {
            map.addLayer({
                id: 'overlay-eonet-point',
                type: 'circle',
                source: 'overlay-eonet',
                layout: { visibility: overlaysRef.current['eonet'] ? 'visible' : 'none' },
                paint: {
                    'circle-color': '#ef4444',
                    'circle-radius': 5,
                    'circle-stroke-width': 1,
                    'circle-stroke-color': '#ffffff'
                }
            }, 'clusters-circle');
        }
    }, []);

    // Effect to initialize the map and wire up event listeners.
    useEffect(() => {
        if (!containerRef.current || mapRef.current) return;

        // Calculate initial zoom to fit a broad geographic area based on screen width.
        const getInitialZoom = () => {
            const width = window.innerWidth;
            const isMobile = width <= 860;
            const mapWidth = isMobile ? width : width - 360;
            
            if (isMobile) return 1.3;
            
            return Math.max(1.0, 1.6 + Math.log2(mapWidth / 1560));
        };
        
        const map = new maplibregl.Map({
            container: containerRef.current,
            style: getMapLibreStyle(currentStyle),
            center: [1.65, 28.0],
            zoom: getInitialZoom(),
            minZoom: 1.0,
            maxZoom: 18,
            attributionControl: false,
        });
        
        map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
        map.addControl(new maplibregl.AttributionControl({ compact: false }), 'bottom-right');

        popupRef.current = new maplibregl.Popup({
            closeButton: true,
            closeOnClick: false,
            className: 'news-popup-container',
            maxWidth: '400px',
            anchor: 'bottom',
        });

        popupRef.current.on('close', () => {
            // Avoid deselection if the popup was removed programmatically during an animation.
            if (!isFlyingRef.current) {
                onSelectItemRef.current(null);
            }
        });

        // Handles layer re-initialization after the map style is loaded.
        map.on('style.load', () => {
            addSourcesAndLayers(map).then(() => {
                if (!eventsWiredRef.current) {
                    eventsWiredRef.current = true;

                    map.on('click', 'unclustered-point', (e) => {
                        if (e.features?.[0]) onSelectItemRef.current(e.features[0].properties.id);
                    });
                    map.on('click', 'unclustered-point-active', (e) => {
                        if (e.features?.[0]) onSelectItemRef.current(e.features[0].properties.id);
                    });

                    map.on('click', 'clusters-circle', async (e) => {
                        const features = map.queryRenderedFeatures(e.point, { layers: ['clusters-circle'] });
                        if (!features.length) return;
                        const clusterId = features[0].properties.cluster_id;
                        
                        if (clusterId) {
                            const source = map.getSource('news-events') as maplibregl.GeoJSONSource;
                            const zoom = await source.getClusterExpansionZoom(clusterId);
                            map.easeTo({
                                center: features[0].geometry.type === 'Point' ? features[0].geometry.coordinates as [number, number] : undefined,
                                zoom
                            });
                        } else {
                            // Zoom in if it's a server-side cluster.
                            map.easeTo({
                                center: features[0].geometry.type === 'Point' ? features[0].geometry.coordinates as [number, number] : undefined,
                                zoom: map.getZoom() + 2
                            });
                        }
                    });

                    // Cursor feedback for interactive layers.
                    for (const layer of ['clusters-circle', 'unclustered-point', 'unclustered-point-active']) {
                        map.on('mouseenter', layer, () => { map.getCanvas().style.cursor = 'pointer'; });
                        map.on('mouseleave', layer, () => { map.getCanvas().style.cursor = ''; });
                    }

                    map.on('moveend', () => emitBounds(map));
                }
                setMapReady(true);
            });
        });

        mapRef.current = map;

        return () => {
            map.remove();
            mapRef.current = null;
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Sync bounds when individual pins are toggled.
    useEffect(() => {
        if (mapReady && mapRef.current) emitBounds(mapRef.current);
    }, [forceIndividualPins, mapReady, emitBounds]);

    // Handles map style and clustering toggle updates.
    useEffect(() => {
        if (!mapRef.current) return;
        setMapReady(false);
        mapRef.current.setStyle(getMapLibreStyle(currentStyle), { diff: false });
    }, [currentStyle, forceIndividualPins]);

    // Updates the GeoJSON source when news items change.
    useEffect(() => {
        if (!mapReady || !mapRef.current) return;

        const geojson: GeoJSON.FeatureCollection = {
            type: 'FeatureCollection',
            features: geoItems.map(item => ({
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [item.longitude!, item.latitude!] },
                properties: {
                    id: item.id,
                    category: item.category,
                    title: item.title,
                    source: item.source,
                    publishedAt: item.publishedAt,
                    locationName: item.locationName,
                    imageUrl: item.imageUrl,
                    description: item.description,
                    eventCount: item.eventCount
                }
            }))
        };

        pendingGeoJsonRef.current = geojson;

        const source = mapRef.current.getSource('news-events') as maplibregl.GeoJSONSource;
        if (source) source.setData(geojson);
    }, [geoItems, mapReady]);

    // Manages selection state, camera flyTo animations, and popup visibility.
    useEffect(() => {
        if (!mapReady || !mapRef.current || !popupRef.current) return;
        const map = mapRef.current;
        
        // Sync layer filters with current selection.
        if (map.getLayer('unclustered-point') && map.getLayer('unclustered-point-active')) {
            const activeId = selectedItemId || '';
            map.setFilter('unclustered-point', ['all',
                ['!', ['any', ['has', 'point_count'], ['>', ['coalesce', ['get', 'eventCount'], 0], 1]]],
                ['!=', ['get', 'id'], activeId]
            ]);
            map.setFilter('unclustered-point-active', ['all',
                ['!', ['any', ['has', 'point_count'], ['>', ['coalesce', ['get', 'eventCount'], 0], 1]]],
                ['==', ['get', 'id'], activeId]
            ]);
        }

        if (selectedItemId) {
            const item = geoItems.find(i => i.id === selectedItemId);
            if (item) {
                const pinColor = getCategoryColor(item.category);
                const categoryLabel = item.category
                    ? `<span class="news-popup-category" style="background:${pinColor}">${item.category}</span>`
                    : '';
                
                const descriptionHtml = item.description != null
                    ? (item.description
                        ? `<p class="news-popup-summary" data-event-id="${item.id}">${item.description}</p>`
                        : '')
                    : `<div class="news-popup-summary news-popup-summary--loading" data-event-id="${item.id}">
                        <div class="popup-skeleton-line"></div>
                        <div class="popup-skeleton-line" style="width:90%"></div>
                        <div class="popup-skeleton-line" style="width:75%"></div>
                      </div>`;

                const html = `
                    <div class="news-popup">
                        <div class="news-popup-header">
                            <h3 class="news-popup-title">${item.title}</h3>
                            <div class="news-popup-meta">
                                <span class="news-popup-source" style="background:${getSourceBadgeColor(item.source)};color:#fff">${item.source}</span>
                                ${categoryLabel}
                                <span class="news-popup-time">${formatTimeAgo(item.publishedAt)}</span>
                                ${item.locationName ? `
                                    <span class="news-popup-meta-sep">•</span>
                                    <span class="news-popup-location">
                                        <svg class="location-icon-svg" viewBox="0 0 24 24" width="12" height="12" fill="currentColor">
                                            <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
                                        </svg>
                                        ${item.locationName}
                                    </span>
                                ` : ''}
                            </div>
                        </div>
                        <div class="news-popup-content">
                            ${item.imageUrl ? `
                                <div class="news-popup-img-container">
                                    <img class="news-popup-img" src="${item.imageUrl}" alt="" referrerpolicy="no-referrer" onerror="this.style.display='none'" />
                                </div>
                            ` : ''}
                            ${descriptionHtml}
                            <a class="news-popup-link" href="${item.url}" target="_blank" rel="noopener noreferrer">View source →</a>
                        </div>
                    </div>
                `;

                // Only animate camera if selection is new or version changed.
                const isNewSelection =
                    lastFlownSelectionRef.current !== selectedItemId ||
                    lastFlownVersionRef.current !== selectionVersion;

                if (isNewSelection) {
                    lastFlownSelectionRef.current = selectedItemId;
                    lastFlownVersionRef.current = selectionVersion;

                    const currentZoom = map.getZoom();
                    const targetZoom = Math.max(currentZoom, 8.5);

                    isFlyingRef.current = true;
                    popupRef.current.remove();

                    map.once('moveend', () => {
                        if (popupRef.current) {
                            popupRef.current
                                .setLngLat([item.longitude!, item.latitude!])
                                .setHTML(html)
                                .addTo(map);
                        }
                        isFlyingRef.current = false;
                    });

                    map.flyTo({
                        center: [item.longitude!, item.latitude!],
                        zoom: targetZoom,
                        duration: 800,
                        padding: { top: 250, bottom: 0, left: 0, right: 0 }
                    });
                }
            }
        } else {
            if (!isFlyingRef.current) {
                popupRef.current.remove();
            }
            lastFlownSelectionRef.current = null;
            lastFlownVersionRef.current = 0;
        }
    }, [selectedItemId, selectionVersion, geoItems, mapReady]);

    // Live-updates popup descriptions when they finish loading.
    useEffect(() => {
        if (!mapReady || !popupRef.current || !popupRef.current.isOpen()) return;
        const el = popupRef.current.getElement();
        if (!el) return;

        geoItems.forEach(item => {
            const skeleton = el.querySelector<HTMLElement>(
                `div[data-event-id="${item.id}"].news-popup-summary--loading`
            );
            if (skeleton && item.description !== undefined) {
                skeleton.outerHTML = item.description
                    ? `<p class="news-popup-summary" data-event-id="${item.id}">${item.description}</p>`
                    : '';
            }
        });
    }, [geoItems, mapReady]);

    // Handles closing the settings panel when clicking outside.
    useEffect(() => {
        if (!settingsOpen) return;
        const handleClick = (e: MouseEvent) => {
            const panel = settingsPanelRef.current;
            if (panel && !panel.contains(e.target as Node)) setSettingsOpen(false);
        };
        const timer = setTimeout(() => document.addEventListener('click', handleClick), 0);
        return () => {
            clearTimeout(timer);
            document.removeEventListener('click', handleClick);
        };
    }, [settingsOpen]);

    // Toggles visibility of active live overlays.
    useEffect(() => {
        if (!mapReady || !mapRef.current) return;
        const map = mapRef.current;
        
        const setVis = (layer: string, show: boolean) => {
            if (map.getLayer(layer)) {
                map.setLayoutProperty(layer, 'visibility', show ? 'visible' : 'none');
            }
        };

        setVis('overlay-usgs-point', overlays['usgs']);
        setVis('overlay-noaa-raster', overlays['noaa']);
        setVis('overlay-eonet-point', overlays['eonet']);
    }, [overlays, mapReady, currentStyle]);

    return (
        <div className={styles.mapWrapper}>
            <MapSettings
                mapStyle={currentStyle}
                onStyleChange={setCurrentStyle}
                forceIndividualPins={forceIndividualPins}
                onForceIndividualPinsToggle={() => setForceIndividualPins(v => !v)}
                isOpen={settingsOpen}
                onToggleOpen={() => setSettingsOpen(o => !o)}
                panelRef={settingsPanelRef}
                mappedOnly={mappedOnly}
                onMappedOnlyChange={onMappedOnlyChange}
            />
            <MapActionTools
                overlays={overlays}
                onOverlayToggle={(overlay, active) => setOverlays(prev => ({ ...prev, [overlay]: active }))}
            />
            <div ref={containerRef} id="news-map" className={styles.newsMapContainer} />
        </div>
    );
}

