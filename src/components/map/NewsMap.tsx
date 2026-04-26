'use client';

import { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { NewsItem } from '@/lib/types';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { BBox } from '@/hooks/useNewsData';

import { getMapLibreStyle, generateCategoryIcon, formatTimeAgo, getSourceBadgeColor, getCategoryColor } from './MapConstants';
import MapSettings from './MapSettings';
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
    
    const settingsPanelRef = useRef<HTMLDivElement>(null);

    const onBoundsChangeRef = useRef(onBoundsChange);
    const onSelectItemRef = useRef(onSelectItem);
    const forceIndividualPinsRef = useRef(forceIndividualPins);

    const boundsDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Track the last selection we flew to, so re-renders from description loading
    // don't repeatedly fire the camera animation.
    const lastFlownSelectionRef = useRef<string | null>(null);
    const lastFlownVersionRef = useRef(0);

    // Holds the latest GeoJSON so we can push it after a style reload.
    const pendingGeoJsonRef = useRef<GeoJSON.FeatureCollection | null>(null);

    // Guard: when we programmatically remove the popup during flyTo, the popup's
    // 'close' event fires. This flag prevents it from deselecting the item.
    const isFlyingRef = useRef(false);

    useEffect(() => { onBoundsChangeRef.current = onBoundsChange; }, [onBoundsChange]);
    useEffect(() => { onSelectItemRef.current = onSelectItem; }, [onSelectItem]);
    useEffect(() => { forceIndividualPinsRef.current = forceIndividualPins; }, [forceIndividualPins]);
    useEffect(() => { setCurrentStyle(isDarkMode ? 'dark' : 'standard'); }, [isDarkMode]);

    const geoItems = useMemo(() => items.filter(i => i.latitude != null && i.longitude != null), [items]);

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

    // Initialize icons, sources, and layers on style load.
    const addSourcesAndLayers = useCallback(async (map: maplibregl.Map) => {
        // 1. Register category icons
        for (const cat of CATEGORIES) {
            if (!map.hasImage(`${cat}_inactive`)) {
                map.addImage(`${cat}_inactive`, await generateCategoryIcon(cat, false));
            }
            if (!map.hasImage(`${cat}_active`)) {
                map.addImage(`${cat}_active`, await generateCategoryIcon(cat, true));
            }
        }

        // 2. GeoJSON source (with MapLibre client-side clustering)
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

        // 3. Individual pins - inactive
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

        // 4. Individual pins - active (selected)
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

        // 5. Cluster circles (visible at all zooms, rendered ON TOP of individual pins)
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

        // 6. Cluster count labels
        if (!map.getLayer('clusters-count')) {
            map.addLayer({
                id: 'clusters-count',
                type: 'symbol',
                source: 'news-events',
                filter: ['any', ['has', 'point_count'], ['>', ['coalesce', ['get', 'eventCount'], 0], 1]],
                layout: {
                    // Lower sort key = higher priority. Negative count gives large clusters priority.
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
    }, []);

    // Initialize map
    useEffect(() => {
        if (!containerRef.current || mapRef.current) return;
        
        const map = new maplibregl.Map({
            container: containerRef.current,
            style: getMapLibreStyle(currentStyle),
            center: [10, 40],
            zoom: 2.6,
            minZoom: 1.1,
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
            // Don't deselect if we programmatically removed the popup during a flyTo
            if (!isFlyingRef.current) {
                onSelectItemRef.current(null);
            }
        });

        // Re-initialize layers after style load or setStyle calls.
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
                            // Server-side cluster - just zoom in
                            map.easeTo({
                                center: features[0].geometry.type === 'Point' ? features[0].geometry.coordinates as [number, number] : undefined,
                                zoom: map.getZoom() + 2
                            });
                        }
                    });

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

    // Trigger initial fetch when pins toggled
    useEffect(() => {
        if (mapReady && mapRef.current) emitBounds(mapRef.current);
    }, [forceIndividualPins, mapReady, emitBounds]);

    // Update tile style
    // setStyle triggers a reload of all layers via style.load handler.
    useEffect(() => {
        if (!mapReady || !mapRef.current) return;
        mapRef.current.setStyle(getMapLibreStyle(currentStyle));
    }, [currentStyle, mapReady]);

    // Toggle client-side clustering
    // Recreate source to toggle clustering state.
    useEffect(() => {
        if (!mapReady || !mapRef.current) return;
        const map = mapRef.current;
        const source = map.getSource('news-events') as maplibregl.GeoJSONSource;
        if (!source) return;

        // Force style reload to apply new clustering configuration.
        map.setStyle(getMapLibreStyle(currentStyle));
    }, [forceIndividualPins, mapReady, currentStyle]);

    // Sync GeoJSON data
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

        // Cache so style reloads can restore the data
        pendingGeoJsonRef.current = geojson;

        const source = mapRef.current.getSource('news-events') as maplibregl.GeoJSONSource;
        if (source) source.setData(geojson);
    }, [geoItems, mapReady]);

    // Handle Selection, FlyTo, and Popup
    useEffect(() => {
        if (!mapReady || !mapRef.current || !popupRef.current) return;
        const map = mapRef.current;
        
        // Update active/inactive layer filters
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

                // Only fly the camera if this is a genuinely new selection
                const isNewSelection =
                    lastFlownSelectionRef.current !== selectedItemId ||
                    lastFlownVersionRef.current !== selectionVersion;

                if (isNewSelection) {
                    lastFlownSelectionRef.current = selectedItemId;
                    lastFlownVersionRef.current = selectionVersion;

                    const currentZoom = map.getZoom();
                    const targetZoom = Math.max(currentZoom, 11);

                    // Temporarily hide popup during camera transition.
                    isFlyingRef.current = true;
                    popupRef.current.remove();

                    map.once('moveend', () => {
                        // Re-add popup after camera settles
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

    // Live-patch popup descriptions
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

    // Settings panel close-on-click-outside
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
            <div ref={containerRef} id="news-map" className={styles.newsMapContainer} />
        </div>
    );
}
