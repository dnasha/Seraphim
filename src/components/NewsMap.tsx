'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import { NewsItem } from '@/lib/types';
import 'leaflet/dist/leaflet.css';

interface NewsMapProps {
    items: NewsItem[];
    selectedItemId: string | null;
    onSelectItem: (id: string) => void;
    isDarkMode: boolean;
}

const MAP_STYLES: Record<string, { url: string; attribution: string }> = {
    standard: {
        url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    },
    dark: {
        url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
        attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
    },
    light: {
        url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
        attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
    },
};

// vivid, high-contrast colors per category
const CATEGORY_COLORS: Record<string, string> = {
    general: '#6b7280',
    world: '#dc2626',
    crisis: '#8b1010ff',
    nation: '#2563eb',
    business: '#eded0bff',
    technology: '#0891b2',
    science: '#059669',
    health: '#7c3aed',
};

const DEFAULT_PIN_COLOR = '#6b7280';

function getCategoryColor(category?: string): string {
    if (!category) return DEFAULT_PIN_COLOR;
    return CATEGORY_COLORS[category] || DEFAULT_PIN_COLOR;
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

export default function NewsMap({ items, selectedItemId, onSelectItem, isDarkMode }: NewsMapProps) {
    const mapRef = useRef<L.Map | null>(null);
    const tileLayerRef = useRef<L.TileLayer | null>(null);
    const markersRef = useRef<Map<string, L.CircleMarker>>(new Map());
    const containerRef = useRef<HTMLDivElement>(null);
    const initializedRef = useRef(false);
    const [mapReady, setMapReady] = useState(false);
    const [mapStyle, setMapStyle] = useState(isDarkMode ? 'dark' : 'standard');

    const geoItems = items.filter(i => i.latitude !== undefined && i.longitude !== undefined);

    // initialize map once
    useEffect(() => {
        if (!containerRef.current) return;

        let aborted = false;

        const loadLeaflet = async () => {
            const L = (await import('leaflet')).default;

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
                initializedRef.current = false;
                setMapReady(false);
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // sync markers with news items
    useEffect(() => {
        if (!mapReady || !mapRef.current) return;

        const loadLeaflet = async () => {
            const L = (await import('leaflet')).default;
            const map = mapRef.current!;

            // clear old markers
            markersRef.current.forEach(marker => map.removeLayer(marker));
            markersRef.current.clear();

            geoItems.forEach(item => {
                const pinColor = getCategoryColor(item.category);

                const marker = L.circleMarker([item.latitude!, item.longitude!], {
                    radius: 10,
                    fillColor: pinColor,
                    color: '#fff',
                    weight: 2,
                    fillOpacity: 0.9,
                    bubblingMouseEvents: false,
                }).addTo(map);

                const categoryLabel = item.category
                    ? `<span class="news-popup-category" style="background:${pinColor}">${item.category}</span>`
                    : '';

                const popupHtml = `
          <div class="news-popup">
            ${item.imageUrl ? `<img class="news-popup-img" src="${item.imageUrl}" alt="" onerror="this.style.display='none'" />` : ''}
            <div class="news-popup-body">
              <h3 class="news-popup-title">${item.title}</h3>
              <p class="news-popup-summary">${(item.description || '').slice(0, 180)}${(item.description || '').length > 180 ? '…' : ''}</p>
              <div class="news-popup-meta">
                <span class="news-popup-source">${item.source}</span>
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
    }, [items, mapReady]);

    // pan to selected item
    useEffect(() => {
        if (!selectedItemId || !mapRef.current) return;

        const marker = markersRef.current.get(selectedItemId);
        if (marker) {
            const latlng = marker.getLatLng();
            mapRef.current.setView(latlng, Math.max(mapRef.current.getZoom(), 5), { animate: true });
            marker.openPopup();
        }
    }, [selectedItemId]);

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

    const handleStyleChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
        setMapStyle(e.target.value);
    }, []);

    return (
        <div className="map-wrapper">
            <div className="map-style-selector">
                <select id="map-style-select" onChange={handleStyleChange} value={mapStyle}>
                    <option value="standard">Standard</option>
                    <option value="dark">Dark</option>
                    <option value="light">Light</option>
                </select>
            </div>
            <div ref={containerRef} id="news-map" className="news-map-container" />
        </div>
    );
}
