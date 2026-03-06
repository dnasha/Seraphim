'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import { NewsItem } from '@/lib/types';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';

interface NewsMapProps {
    items: NewsItem[];
    selectedItemId: string | null;
    selectionVersion: number;
    onSelectItem: (id: string) => void;
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
    const size = isActive ? 36 : 28;
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
        ${shadowStyle}
        transition: all 0.2s ease;
    ">
        <svg viewBox="0 0 24 24" width="${size * 0.55}" height="${size * 0.55}" fill="#fff">
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
    const mapRef = useRef<L.Map | null>(null);
    const tileLayerRef = useRef<L.TileLayer | null>(null);
    const markersRef = useRef<Map<string, L.Marker>>(new Map());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const clusterGroupRef = useRef<any>(null);
    // Direct layer group for non-clustered mode
    const directGroupRef = useRef<L.LayerGroup | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const initializedRef = useRef(false);
    const [mapReady, setMapReady] = useState(false);
    const [mapStyle, setMapStyle] = useState(isDarkMode ? 'dark' : 'standard');
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [clusteringEnabled, setClusteringEnabled] = useState(false);
    const settingsPanelRef = useRef<HTMLDivElement>(null);

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
                zoomControl: true,
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

    // sync markers with news items + clustering toggle
    useEffect(() => {
        if (!mapReady || !mapRef.current) return;

        const loadLeaflet = async () => {
            const L = (await import('leaflet')).default;
            await import('leaflet.markercluster');
            const map = mapRef.current!;

            // remove old layers
            if (clusterGroupRef.current) {
                map.removeLayer(clusterGroupRef.current);
                clusterGroupRef.current = null;
            }
            if (directGroupRef.current) {
                map.removeLayer(directGroupRef.current);
                directGroupRef.current = null;
            }
            markersRef.current.clear();

            // choose target layer based on clustering toggle
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            let targetLayer: any;

            if (clusteringEnabled) {
                // create cluster group with custom styling
                const clusterGroup = L.markerClusterGroup({
                    maxClusterRadius: 45,
                    spiderfyOnMaxZoom: true,
                    showCoverageOnHover: false,
                    zoomToBoundsOnClick: true,
                    disableClusteringAtZoom: 10,
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    iconCreateFunction: (cluster: any) => {
                        const count = cluster.getChildCount();
                        let size = 36;
                        let className = 'cluster-small';
                        if (count >= 50) { size = 50; className = 'cluster-large'; }
                        else if (count >= 10) { size = 42; className = 'cluster-medium'; }

                        return L.divIcon({
                            html: `<div class="cluster-icon ${className}"><span>${count}</span></div>`,
                            className: 'custom-cluster-icon',
                            iconSize: [size, size],
                        });
                    },
                });
                targetLayer = clusterGroup;
                clusterGroupRef.current = clusterGroup;
            } else {
                // simple layer group — no clustering
                const group = L.layerGroup();
                targetLayer = group;
                directGroupRef.current = group;
            }

            geoItems.forEach(item => {
                const icon = createCategoryIcon(L, item.category, item.id === selectedItemId);

                const marker = L.marker([item.latitude!, item.longitude!], { icon }).addTo(targetLayer);

                const pinColor = getCategoryColor(item.category);
                const categoryLabel = item.category
                    ? `<span class="news-popup-category" style="background:${pinColor}">${item.category}</span>`
                    : '';

                const popupHtml = `
          <div class="news-popup">
            ${item.imageUrl ? `<img class="news-popup-img" src="${item.imageUrl}" alt="" referrerpolicy="no-referrer" onerror="this.style.display='none'" />` : ''}
            <div class="news-popup-body">
              <h3 class="news-popup-title">${item.title}</h3>
              <p class="news-popup-summary">${(item.description || '').slice(0, 180)}${(item.description || '').length > 180 ? '…' : ''}</p>
              <div class="news-popup-meta">
                <span class="news-popup-source" style="background:${getSourceBadgeColor(item.source)};color:#fff">${item.source}</span>
                ${categoryLabel}
                <span class="news-popup-time">${formatTimeAgo(item.publishedAt)}</span>
              </div>
              ${item.locationName ? `<div class="news-popup-location">${item.locationName}</div>` : ''}
              <a class="news-popup-link" href="${item.url}" target="_blank" rel="noopener noreferrer">Read full article →</a>
            </div>
          </div>
        `;

                marker.bindPopup(popupHtml, {
                    maxWidth: 320,
                    minWidth: 240,
                    className: 'news-popup-container',
                });

                marker.on('click', () => {
                    marker.openPopup();
                    onSelectItem(item.id);
                });

                markersRef.current.set(item.id, marker);
            });

            map.addLayer(targetLayer);

            // auto-center around plotted markers
            if (geoItems.length > 0) {
                const bounds = L.latLngBounds(
                    geoItems.map(i => [i.latitude!, i.longitude!] as [number, number])
                );
                map.fitBounds(bounds, { padding: [40, 40], maxZoom: 6 });
            }
        };

        loadLeaflet();
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

            if (!selectedItemId) return;

            const marker = markersRef.current.get(selectedItemId);
            if (marker) {
                const map = mapRef.current!;
                const latlng = marker.getLatLng();
                const targetZoom = Math.max(map.getZoom(), 5);

                map.once('moveend', () => {
                    marker.openPopup();
                });
                map.flyTo(latlng, targetZoom, { animate: true, duration: 0.8 });
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
