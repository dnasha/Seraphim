'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import { NewsItem } from '@/lib/types';
import type { Map as LeafletMap, TileLayer, Marker, MarkerClusterGroup, MarkerCluster, LayerGroup } from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';

interface NewsMapProps {
    items: NewsItem[];
    selectedItemId: string | null;
    selectionVersion: number;
    onSelectItem: (id: string | null) => void;
    isDarkMode: boolean;
}

const MAP_STYLES: Record<string, { url: string; attribution: string; label: string }> = {
    standard: {
        url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
        attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
        label: 'Standard',
    },
    dark: {
        url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
        attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
        label: 'Dark',
    },
    light: {
        url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
        attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
        label: 'Light',
    },
    satellite: {
        url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        attribution: '&copy; Esri &mdash; Esri, DeLorme, NAVTEQ',
        label: 'Satellite',
    },
    topographic: {
        url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
        attribution: '&copy; OpenStreetMap contributors, &copy; OpenTopoMap',
        label: 'Terrain',
    },
};

// ── Category colors & icons ─────────────────────────────────────────────────
const CATEGORY_COLORS: Record<string, string> = {
    general: '#6b7280',
    world: '#dc2626',
    crisis: '#b91c1c',
    nation: '#2563eb',
    business: '#d97706',
    technology: '#0891b2',
    science: '#059669',
    health: '#7c3aed',
};

// Minimalist SVG path data for category icons (rendered inside markers)
const CATEGORY_ICONS: Record<string, string> = {
    general: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z', // globe
    world: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z',
    crisis: 'M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z', // warning triangle
    nation: 'M14.4 6L14 4H5v17h2v-7h5.6l.4 2h7V6z', // flag
    business: 'M5 9.2h3V19H5V9.2zM10.6 5h2.8v14h-2.8V5zm5.6 8H19v6h-2.8v-6z', // bar chart
    technology: 'M15 9H9v6h6V9zm-2 4h-2v-2h2v2zm8-2V9h-2V7c0-1.1-.9-2-2-2h-2V3h-2v2h-2V3H9v2H7c-1.1 0-2 .9-2 2v2H3v2h2v2H3v2h2v2c0 1.1.9 2 2 2h2v2h2v-2h2v2h2v-2h2c1.1 0 2-.9 2-2v-2h2v-2h-2v-2h2zm-4 6H7V7h10v10z', // chip
    science: 'M13 11.33L18 18H6l5-6.67V6h2v5.33zM15.96 4H8.04C7.62 4 7.39 4.48 7.65 4.81L9 6.5v4.17L3.2 18.4C2.71 19.06 3.18 20 4 20h16c.82 0 1.29-.94.8-1.6L15 10.67V6.5l1.35-1.69c.26-.33.03-.81-.39-.81z', // flask
    health: 'M19 3H5c-1.1 0-1.99.9-1.99 2L3 19c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-1 11h-4v4h-4v-4H6v-4h4V6h4v4h4v4z', // cross/plus
};

const DEFAULT_PIN_COLOR = '#6b7280';

function getCategoryColor(category?: string): string {
    if (!category) return DEFAULT_PIN_COLOR;
    return CATEGORY_COLORS[category] || DEFAULT_PIN_COLOR;
}

// Build a DivIcon with a category-specific SVG icon inside a colored circle marker
function createCategoryIcon(L: typeof import('leaflet'), category?: string, isActive?: boolean): L.DivIcon {
    const color = getCategoryColor(category);
    const iconPath = CATEGORY_ICONS[category || 'general'] || CATEGORY_ICONS.general;
    const size = isActive ? 37 : 27;
    const activeClass = isActive ? ' marker-icon-active' : '';
    const shadowStyle = isActive
        ? `box-shadow: 0 0 0 4px ${color}44, 0 0 12px ${color}66;`
        : `box-shadow: 0 2px 6px rgba(0,0,0,0.3);`;

    const html = `<div class="marker-icon${activeClass}" style="
        width:${size}px;height:${size}px;
        background:${color};
        border-radius:50%;
        border:2px solid #fff;
        display:flex;align-items:center;justify-content:center;
        line-height:0;
        ${shadowStyle}
        transition: all 0.2s ease;
    ">
        <svg viewBox="0 0 24 24" width="${size * 0.55}" height="${size * 0.55}" fill="#fff" style="display:block;flex-shrink:0;">
            <path d="${iconPath}"/>
        </svg>
    </div>`;

    return L.divIcon({
        html,
        className: 'custom-marker-icon',
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2],
        popupAnchor: [0, -size / 2],
    });
}

function formatTimeAgo(dateStr: string): string {
    const now = Date.now();
    const then = new Date(dateStr).getTime();
    const diffMs = now - then;
    const mins = Math.floor(diffMs / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
}

// Source platform badge colors (same logic as EventSidebar)
function getSourceBadgeColor(sourceName: string): string {
    const s = sourceName.toLowerCase();
    if (s.includes('(x)') || s.includes('twitter')) return '#000000';
    if (s.includes('reddit')) return '#ff4500';
    if (s.includes('telegram')) return '#006effff';
    if (s.includes('bellingcat') || s.includes('isw') || s.includes('war on the rocks')) return '#6d3100ff';
    if (s.includes('ars technica') || s.includes('verge') || s.includes('bleeping') || s.includes('hacker news')) return '#008fb3ff';
    if (s.includes('nasa') || s.includes('nature')) return '#059669';
    if (s.includes('who ')) return '#7c3aed';
    return '#818181ff';
}

export default function NewsMap({ items, selectedItemId, selectionVersion, onSelectItem, isDarkMode }: NewsMapProps) {
    const mapRef = useRef<LeafletMap | null>(null);
    const tileLayerRef = useRef<TileLayer | null>(null);
    const markersRef = useRef<Map<string, Marker>>(new Map());
    const clusterGroupRef = useRef<MarkerClusterGroup | null>(null);
    // Direct layer group for non-clustered mode
    const directGroupRef = useRef<LayerGroup | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const initializedRef = useRef(false);
    const [mapReady, setMapReady] = useState(false);
    const [mapStyle, setMapStyle] = useState(isDarkMode ? 'dark' : 'standard');
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [clusteringEnabled, setClusteringEnabled] = useState(false);
    const settingsPanelRef = useRef<HTMLDivElement>(null);
    const selectedIdRef = useRef(selectedItemId);

    useEffect(() => {
        selectedIdRef.current = selectedItemId;
    }, [selectedItemId]);

    const geoItems = items.filter(i => i.latitude !== undefined && i.longitude !== undefined);

    // close panel on outside click
    useEffect(() => {
        if (!settingsOpen) return;
        const handleClick = (e: MouseEvent) => {
            const panel = settingsPanelRef.current;
            if (panel && !panel.contains(e.target as Node)) {
                setSettingsOpen(false);
            }
        };
        // delay so the opening click doesn't immediately close
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
            const L = (await import('leaflet')).default;
            await import('leaflet.markercluster');

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
                minZoom: 2.4,
                zoomSnap: 0.25,
                zoomDelta: 1,
                wheelPxPerZoomLevel: 80,
                worldCopyJump: true,
                maxBounds: L.latLngBounds(
                    L.latLng(-85, -Infinity),
                    L.latLng(85, Infinity)
                ),
                maxBoundsViscosity: 1.0,
            });

            const tileLayer = L.tileLayer(style.url, {
                maxZoom: 19,
                attribution: style.attribution,
                noWrap: false,
            }).addTo(map);

            L.control.zoom({ position: 'topright' }).addTo(map);

            // Deselect when clicking the map background
            map.on('click', (e: L.LeafletMouseEvent) => {
                if ((e.originalEvent as unknown as { _stopped?: boolean })._stopped) return;
                onSelectItem(null);
            });

            mapRef.current = map;
            tileLayerRef.current = tileLayer;
            initializedRef.current = true;

            setTimeout(() => map.invalidateSize(), 100);
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
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // handle container resizing when sidebar toggles
    useEffect(() => {
        if (!mapReady || !mapRef.current || !containerRef.current) return;
        const resizeObserver = new ResizeObserver(() => {
            mapRef.current?.invalidateSize();
        });
        resizeObserver.observe(containerRef.current);
        return () => resizeObserver.disconnect();
    }, [mapReady]);

    // sync markers with news items + clustering toggle
    useEffect(() => {
        if (!mapReady || !mapRef.current) return;
        let cancelled = false;

        const loadLeaflet = async () => {
            const L = (await import('leaflet')).default;
            await import('leaflet.markercluster');
            if (cancelled || !mapRef.current) return;
            const map = mapRef.current;

            // Handle clustering toggle — if it changed, we DO need a full teardown
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
                    clusterGroupRef.current = L.markerClusterGroup({
                        maxClusterRadius: 35,
                        spiderfyOnMaxZoom: true,
                        showCoverageOnHover: false,
                        zoomToBoundsOnClick: true,
                        disableClusteringAtZoom: 7,
                        removeOutsideVisibleBounds: false,
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
                    map.addLayer(clusterGroupRef.current);
                }
                targetLayer = clusterGroupRef.current;
            } else {
                if (!directGroupRef.current) {
                    directGroupRef.current = L.layerGroup();
                    map.addLayer(directGroupRef.current);
                }
                targetLayer = directGroupRef.current;
            }

            // --- Diffing markers ---
            const currentMarkerIds = new Set(markersRef.current.keys());
            const nextItemMap = new Map(geoItems.map(i => [i.id, i]));
            const nextItemIds = new Set(nextItemMap.keys());

            // 1. Remove markers no longer in items
            const toRemove: string[] = [];
            currentMarkerIds.forEach(id => {
                if (!nextItemIds.has(id)) {
                    const marker = markersRef.current.get(id);
                    if (marker) {
                        targetLayer.removeLayer(marker);
                        markersRef.current.delete(id);
                        toRemove.push(id);
                    }
                }
            });

            // 2. Identify markers to add
            const toAdd: L.Marker[] = [];
            geoItems.forEach(item => {
                if (!currentMarkerIds.has(item.id)) {
                    const icon = createCategoryIcon(L, item.category, item.id === selectedItemId);
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

                    marker.on('click', (e: L.LeafletMouseEvent) => {
                        L.DomEvent.stopPropagation(e);
                        const isSelected = selectedIdRef.current === item.id;
                        onSelectItem(isSelected ? null : item.id);
                    });

                    markersRef.current.set(item.id, marker);
                    toAdd.push(marker);
                }
            });

            // Bulk-add new markers
            if (toAdd.length > 0) {
                if (clusteringEnabled && 'addLayers' in targetLayer) {
                    targetLayer.addLayers(toAdd);
                } else {
                    toAdd.forEach(m => targetLayer.addLayer(m));
                }
            }

            // auto-center around plotted markers when results change (filtering)
            if (geoItems.length > 0 && nextItemIds.size !== currentMarkerIds.size) {
                // Filter out extreme latitudes for framing (deadzone) 
                // so Antarctica doesn't zoom the map out to the whole world.
                let itemsToFrame = geoItems.filter(i => i.latitude! > -60 && i.latitude! < 75);
                
                // Fallback to all items if everything is in a deadzone
                if (itemsToFrame.length === 0) itemsToFrame = geoItems;

                const bounds = L.latLngBounds(
                    itemsToFrame.map(i => [i.latitude!, i.longitude!] as [number, number])
                );
                map.fitBounds(bounds, { padding: [40, 40], maxZoom: 6 });
            }
        };

        loadLeaflet();
        return () => { cancelled = true; };
        // We intentionally omit selectedItemId and onSelectItem from dependencies to avoid 
        // full marker re-diffing on every selection change. Selection highlighting 
        // is handled by a separate, lighter useEffect below.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [items, mapReady, clusteringEnabled]);

    // highlight active marker
    useEffect(() => {
        if (!mapReady || !mapRef.current) return;

        const updateActiveMarker = async () => {
            const L = (await import('leaflet')).default;

            // Reset all markers, highlight the selected one
            markersRef.current.forEach((marker, id) => {
                const item = geoItems.find(i => i.id === id);
                const isActive = id === selectedItemId;
                marker.setIcon(createCategoryIcon(L, item?.category, isActive));
            });

            if (!selectedItemId) {
                mapRef.current!.closePopup();
                return;
            }

            const marker = markersRef.current.get(selectedItemId);
            if (marker) {
                const map = mapRef.current!;
                
                const showPopup = () => {
                    // Update icon again to be sure it's correct after potentially moving
                    const item = geoItems.find(i => i.id === selectedItemId);
                    marker.setIcon(createCategoryIcon(L, item?.category, true));
                    marker.openPopup();
                };

                if (clusteringEnabled && clusterGroupRef.current) {
                    // Check if the marker is already unclustered (visible on its own).
                    // If so, zoomToShowLayer's callback may never fire — skip it entirely.
                    const visibleParent = clusterGroupRef.current.getVisibleParent(marker);

                    if (visibleParent === marker) {
                        // Marker is already unclustered — fly directly (same as non-clustered path)
                        const latlng = marker.getLatLng();
                        const currentZoom = map.getZoom();
                        const targetZoom = Math.max(currentZoom, 7);
                        const p = map.project(latlng, targetZoom).subtract([0, 140]);
                        const target = map.unproject(p, targetZoom);

                        if (currentZoom === targetZoom && map.getCenter().distanceTo(target) < 10) {
                            showPopup();
                        } else {
                            map.once('moveend', showPopup);
                            map.flyTo(target, targetZoom, { animate: true, duration: 0.8 });
                        }
                    } else {
                        // Marker is inside a cluster — uncluster first, then fly to offset
                        clusterGroupRef.current.zoomToShowLayer(marker, () => {
                            // Small delay to let zoomToShowLayer's animation fully settle
                            // before starting our own setView, preventing double-animation
                            // moveend conflicts
                            setTimeout(() => {
                                if (!mapRef.current) return;
                                const latlng = marker.getLatLng();
                                const targetZoom = Math.max(mapRef.current.getZoom(), 7);
                                const p = mapRef.current.project(latlng, targetZoom).subtract([0, 140]);
                                const target = mapRef.current.unproject(p, targetZoom);

                                mapRef.current.once('moveend', showPopup);
                                mapRef.current.setView(target, targetZoom, { animate: true });
                            }, 150);
                        });
                    }
                } else {
                    const latlng = marker.getLatLng();
                    const currentZoom = map.getZoom();
                    const targetZoom = Math.max(currentZoom, 7);

                    // Calculate offset: move center ~140px above the pin so pin is in the lower half
                    const p = map.project(latlng, targetZoom).subtract([0, 140]);
                    const target = map.unproject(p, targetZoom);

                    if (currentZoom === targetZoom && map.getCenter().distanceTo(target) < 10) {
                        showPopup();
                    } else {
                        map.once('moveend', showPopup);
                        map.flyTo(target, targetZoom, { animate: true, duration: 0.8 });
                    }
                }
            } else {
                mapRef.current!.closePopup();
            }
        };

        updateActiveMarker();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedItemId, selectionVersion]);

    // sync dropdown when dark mode toggles
    useEffect(() => {
        setMapStyle(isDarkMode ? 'dark' : 'standard');
    }, [isDarkMode]);

    // apply tile layer whenever mapStyle changes (from toggle or dropdown)
    useEffect(() => {
        if (!mapRef.current || !tileLayerRef.current) return;

        const applyStyle = async () => {
            const L = (await import('leaflet')).default;
            const style = MAP_STYLES[mapStyle];
            mapRef.current!.removeLayer(tileLayerRef.current!);
            tileLayerRef.current = L.tileLayer(style.url, {
                maxZoom: 19,
                attribution: style.attribution,
                noWrap: false,
            }).addTo(mapRef.current!);
        };

        applyStyle();
    }, [mapStyle]);

    const handleStyleChange = useCallback((style: string) => {
        setMapStyle(style);
    }, []);

    return (
        <div className="map-wrapper">
            {/* Settings gear button */}
            <div className="map-settings-area" ref={settingsPanelRef}>
                <button
                    className="map-settings-btn"
                    onClick={() => setSettingsOpen(o => !o)}
                    title="Map settings"
                    aria-label="Map settings"
                >
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                        <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 00.12-.61l-1.92-3.32a.49.49 0 00-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 00-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.49.49 0 00-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.07.62-.07.94s.02.64.07.94l-2.03 1.58a.49.49 0 00-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6A3.6 3.6 0 1112 8.4a3.6 3.6 0 010 7.2z"/>
                    </svg>
                    <div className="btn-red-dot" />
                </button>

                {/* Settings panel */}
                {settingsOpen && (
                    <div className="map-settings-panel">
                        <div className="settings-section">
                            <div className="settings-label">Map Style</div>
                            <div className="settings-style-grid">
                                {Object.entries(MAP_STYLES).map(([key, style]) => (
                                    <button
                                        key={key}
                                        className={`settings-style-btn${mapStyle === key ? ' active' : ''}`}
                                        onClick={() => handleStyleChange(key)}
                                    >
                                        {style.label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="settings-divider" />

                        <div className="settings-section">
                            <div className="settings-label">Clustering</div>
                            <label className="settings-toggle">
                                <span className="settings-toggle-label">Group nearby markers</span>
                                <div className={`toggle-switch${clusteringEnabled ? ' on' : ''}`} onClick={() => setClusteringEnabled(v => !v)}>
                                    <div className="toggle-knob" />
                                </div>
                            </label>
                        </div>
                    </div>
                )}
            </div>

            <div ref={containerRef} id="news-map" className="news-map-container" />
        </div>
    );
}
