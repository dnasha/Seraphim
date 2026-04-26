'use client';

/*
 * NewsMap component using Leaflet and markerclustering.
 */

import { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { NewsItem } from '@/lib/types';
import type { Map as LeafletMap, TileLayer, LeafletMouseEvent } from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
import { BBox } from '@/hooks/useNewsData';

import { MAP_STYLES } from './MapConstants';
import MapSettings from './MapSettings';
import styles from './NewsMap.module.css';

import { setupSmoothZoom } from './smoothZoom';
import { MarkerManager } from './markerManager';

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

export default function NewsMap({ items, selectedItemId, selectionVersion, onSelectItem, isDarkMode, mappedOnly, onMappedOnlyChange, onBoundsChange }: NewsMapProps) {
    const mapRef = useRef<LeafletMap | null>(null);
    const tileLayerRef = useRef<TileLayer | null>(null);
    const labelLayerRef = useRef<TileLayer | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const initializedRef = useRef(false);
    
    const LRef = useRef<typeof import('leaflet') | null>(null);
    const markerManagerRef = useRef<MarkerManager | null>(null);
    const cleanupZoomRef = useRef<(() => void) | null>(null);

    const [mapReady, setMapReady] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(false);
    // Power-user override: disables automatic server clustering at low zoom,
    // forcing the map to render all individual pins.
    const [forceIndividualPins, setForceIndividualPins] = useState(false);
    const [currentStyle, setCurrentStyle] = useState<string>(isDarkMode ? 'dark' : 'standard');
    
    const settingsPanelRef = useRef<HTMLDivElement>(null);
    const selectedIdRef = useRef(selectedItemId);

    const onSelectItemRef = useRef(onSelectItem);
    const isDarkModeRef = useRef(isDarkMode);
    const onBoundsChangeRef = useRef(onBoundsChange);
    const forceIndividualPinsRef = useRef(forceIndividualPins);

    // Debounce timer for moveend
    const boundsDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    /**
     * When true, the next moveend event (caused by a programmatic flyTo)
     * will NOT trigger a BBox refetch. The MarkerManager sets this flag via
     * the onBeforeFly callback before every camera animation.
     * Cleared immediately after the suppressed moveend fires.
     */
    const suppressBoundsRef = useRef(false);

    // Stable callback passed to MarkerManager — called before every flyTo so we
    // can suppress the resulting moveend BBox emission.
    const onBeforeFly = useCallback(() => {
        suppressBoundsRef.current = true;
    }, []);

    const emitBounds = useCallback((map: LeafletMap) => {
        if (boundsDebounceRef.current) clearTimeout(boundsDebounceRef.current);
        boundsDebounceRef.current = setTimeout(() => {
            // If a programmatic flyTo just fired this moveend, skip the fetch.
            if (suppressBoundsRef.current) {
                suppressBoundsRef.current = false;
                return;
            }

            const b = map.getBounds();
            const bbox: BBox = {
                minLat: b.getSouth(),
                maxLat: b.getNorth(),
                minLng: b.getWest(),
                maxLng: b.getEast(),
                // Always forward zoom — the API decides whether to cluster based on it.
                zoom: map.getZoom(),
                // If the user has force-enabled individual pins (power-user toggle),
                // tell the API to skip server-side clustering even at low zoom.
                forceRaw: forceIndividualPinsRef.current,
            };
            onBoundsChangeRef.current?.(bbox);
        }, 400);
    }, []);

    useEffect(() => {
        isDarkModeRef.current = isDarkMode;
    }, [isDarkMode]);

    useEffect(() => {
        onSelectItemRef.current = onSelectItem;
    }, [onSelectItem]);

    useEffect(() => {
        onBoundsChangeRef.current = onBoundsChange;
    }, [onBoundsChange]);

    useEffect(() => {
        forceIndividualPinsRef.current = forceIndividualPins;
    }, [forceIndividualPins]);

    useEffect(() => {
        selectedIdRef.current = selectedItemId;
    }, [selectedItemId]);

    // Trigger a BBox fetch immediately when the user toggles individual pins
    useEffect(() => {
        if (mapReady && mapRef.current) {
            emitBounds(mapRef.current);
        }
    }, [forceIndividualPins, mapReady, emitBounds]);

    const geoItems = useMemo(() => items.filter(i => i.latitude != null && i.longitude != null), [items]);

    
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

    // Initialize map with smooth zoom and marker management
    useEffect(() => {
        if (!containerRef.current) return;

        let aborted = false;

        const loadLeaflet = async () => {
            if (!LRef.current) {
                const leafletModule = await import('leaflet');
                LRef.current = (leafletModule as unknown as { default: typeof import('leaflet') }).default || leafletModule;
                await import('leaflet.markercluster');
            }
            
            const L = LRef.current;

            if (aborted) return;
            if (initializedRef.current && mapRef.current) return;

            const container = containerRef.current!;
            
            // Clear leaflet internal state if it exists to allow re-initialization
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

            cleanupZoomRef.current = setupSmoothZoom(map, L, container);

            map.on('click', (e: LeafletMouseEvent) => {
                if ((e.originalEvent as unknown as { _stopped?: boolean })._stopped) return;
                onSelectItemRef.current(null);
            });

            markerManagerRef.current = new MarkerManager(
                map, 
                L, 
                (id) => onSelectItemRef.current(id),
                () => selectedIdRef.current,
                onBeforeFly,  // <-- suppress flag setter
            );

            mapRef.current = map;
            initializedRef.current = true;
            
            // Delay helps Leaflet calculate container dimensions correctly after mount
            setTimeout(() => {
                if (!aborted && mapRef.current) {
                    mapRef.current.invalidateSize();
                }
            }, 100);
            
            setMapReady(true);
        };

        loadLeaflet();

        return () => {
            aborted = true;
            if (cleanupZoomRef.current) {
                cleanupZoomRef.current();
                cleanupZoomRef.current = null;
            }
            if (markerManagerRef.current) {
                markerManagerRef.current.cleanup();
                markerManagerRef.current = null;
            }
            if (mapRef.current) {
                mapRef.current.remove();
                mapRef.current = null;
                tileLayerRef.current = null;
                labelLayerRef.current = null;
                initializedRef.current = false;
                setMapReady(false);
            }
        };
    }, [onBeforeFly]);

    // Update style when isDarkMode prop changes
    useEffect(() => {
        setCurrentStyle(isDarkMode ? 'dark' : 'standard');
    }, [isDarkMode]);

    // Update tile layer when style changes
    useEffect(() => {
        if (!mapRef.current || !mapReady || !LRef.current) return;
        const L = LRef.current;
        const style = MAP_STYLES[currentStyle];
        
        if (tileLayerRef.current) {
            mapRef.current.removeLayer(tileLayerRef.current);
            tileLayerRef.current = null;
        }
        if (labelLayerRef.current) {
            mapRef.current.removeLayer(labelLayerRef.current);
            labelLayerRef.current = null;
        }

        tileLayerRef.current = L.tileLayer(style.url, {
            maxZoom: 19,
            attribution: style.attribution,
            noWrap: false,
        }).addTo(mapRef.current);

        if (style.labelsUrl) {
            labelLayerRef.current = L.tileLayer(style.labelsUrl, {
                maxZoom: 19,
                noWrap: false,
            }).addTo(mapRef.current);
        }
    }, [currentStyle, mapReady]);

    // Handle container resizing
    useEffect(() => {
        if (!mapReady || !mapRef.current || !containerRef.current) return;
        const resizeObserver = new ResizeObserver(() => {
            mapRef.current?.invalidateSize();
        });
        resizeObserver.observe(containerRef.current);
        return () => resizeObserver.disconnect();
    }, [mapReady]);

    // Register the moveend → BBox emission listener.
    useEffect(() => {
        if (!mapReady || !mapRef.current) return;
        const map = mapRef.current;
        const handler = () => emitBounds(map);
        map.on('moveend', handler);
        return () => { map.off('moveend', handler); };
    }, [mapReady, emitBounds]);

    useEffect(() => {
        if (!mapReady || !markerManagerRef.current) return;
        // Client-side clustering is permanently disabled. We rely entirely on 
        // server-side clustering, unless forceIndividualPins is active.
        markerManagerRef.current.syncMarkers(geoItems, false, selectedIdRef.current);

        // Patch any already-open popups whose descriptions have since been loaded
        geoItems.forEach(item => {
            if (item.description !== undefined) {
                markerManagerRef.current?.updatePopupDescription(item.id, item.description);
            }
        });
    }, [mapReady, geoItems]);


    useEffect(() => {
        if (!mapReady || !markerManagerRef.current) return;
        markerManagerRef.current.highlightMarker(selectedItemId, geoItems);
    }, [mapReady, selectedItemId, selectionVersion, geoItems]);

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
