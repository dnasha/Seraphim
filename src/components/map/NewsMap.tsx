'use client';

/*
 * NewsMap component using Leaflet and markerclustering.
 */

import { useEffect, useRef, useState, useMemo } from 'react';
import { NewsItem } from '@/lib/types';
import type { Map as LeafletMap, TileLayer, LeafletMouseEvent } from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';

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
}

export default function NewsMap({ items, selectedItemId, selectionVersion, onSelectItem, isDarkMode }: NewsMapProps) {
    const mapRef = useRef<LeafletMap | null>(null);
    const tileLayerRef = useRef<TileLayer | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const initializedRef = useRef(false);
    
    const LRef = useRef<typeof import('leaflet') | null>(null);
    const markerManagerRef = useRef<MarkerManager | null>(null);
    const cleanupZoomRef = useRef<(() => void) | null>(null);

    const [mapReady, setMapReady] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [clusteringEnabled, setClusteringEnabled] = useState(false);
    
    const settingsPanelRef = useRef<HTMLDivElement>(null);
    const selectedIdRef = useRef(selectedItemId);

    const onSelectItemRef = useRef(onSelectItem);
    const isDarkModeRef = useRef(isDarkMode);

    useEffect(() => {
        isDarkModeRef.current = isDarkMode;
    }, [isDarkMode]);

    useEffect(() => {
        onSelectItemRef.current = onSelectItem;
    }, [onSelectItem]);

    useEffect(() => {
        selectedIdRef.current = selectedItemId;
    }, [selectedItemId]);

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

    // initialize map with smooth zoom and marker management
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

            // check if map is still relevant before initializing
            if (aborted) return;
            if (initializedRef.current && mapRef.current) return;

            const styleName = isDarkModeRef.current ? 'dark' : 'standard';
            const style = MAP_STYLES[styleName];

            const container = containerRef.current!;
            
            // clear leaflet internal state if it exists to allow re-initialization
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

            tileLayerRef.current = L.tileLayer(style.url, {
                maxZoom: 19,
                attribution: style.attribution,
                noWrap: false,
            }).addTo(map);

            map.on('click', (e: LeafletMouseEvent) => {
                if ((e.originalEvent as unknown as { _stopped?: boolean })._stopped) return;
                onSelectItemRef.current(null);
            });


            markerManagerRef.current = new MarkerManager(
                map, 
                L, 
                (id) => onSelectItemRef.current(id),
                () => selectedIdRef.current
            );

            mapRef.current = map;
            initializedRef.current = true;
            
            // delay helps Leaflet calculate container dimensions correctly after mount
            setTimeout(() => {
                if (!aborted && mapRef.current) mapRef.current.invalidateSize();
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
                initializedRef.current = false;
                setMapReady(false);
            }
        };
    }, []);
    // update tile layer when dark mode changes
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


    useEffect(() => {
        if (!mapReady || !markerManagerRef.current) return;
        markerManagerRef.current.syncMarkers(geoItems, clusteringEnabled, selectedIdRef.current);
    }, [mapReady, clusteringEnabled, geoItems]);


    useEffect(() => {
        if (!mapReady || !markerManagerRef.current) return;
        markerManagerRef.current.highlightMarker(selectedItemId, geoItems);
    }, [mapReady, selectedItemId, selectionVersion, clusteringEnabled, geoItems]);

    return (
        <div className={styles.mapWrapper}>
            <MapSettings
                mapStyle={isDarkMode ? 'dark' : 'standard'}
                onStyleChange={() => {}} // Internal style changes handled by isDarkMode prop
                clusteringEnabled={clusteringEnabled}
                onClusteringToggle={() => setClusteringEnabled(v => !v)}
                isOpen={settingsOpen}
                onToggleOpen={() => setSettingsOpen(o => !o)}
                panelRef={settingsPanelRef}
            />
            <div ref={containerRef} id="news-map" className={styles.newsMapContainer} />
        </div>
    );
}
