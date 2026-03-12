'use client';

import { useEffect, useRef, useState, useMemo } from 'react';
import { NewsItem } from '@/lib/types';
import type { Map as LeafletMap, TileLayer, Marker, MarkerClusterGroup, MarkerCluster, LayerGroup } from 'leaflet';
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
    const [mapReady, setMapReady] = useState(false);
    const [mapStyle, setMapStyle] = useState(isDarkMode ? 'dark' : 'standard');
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [clusteringEnabled, setClusteringEnabled] = useState(false);
    const settingsPanelRef = useRef<HTMLDivElement>(null);
    const selectedIdRef = useRef(selectedItemId);

    useEffect(() => {
        selectedIdRef.current = selectedItemId;
    }, [selectedItemId]);

    const geoItems = useMemo(() => items.filter(i => i.latitude !== undefined && i.longitude !== undefined), [items]);

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

            // Initial style
            tileLayerRef.current = L.tileLayer(style.url, {
                maxZoom: 19,
                attribution: style.attribution,
                noWrap: false,
            }).addTo(map);

            L.control.zoom({ position: 'topright' }).addTo(map);

            map.on('click', (e: L.LeafletMouseEvent) => {
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
    }, [onSelectItem]); // Remove isDarkMode dependency here!

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
        if (!mapReady || !mapRef.current) return;
        let cancelled = false;

        const loadLeaflet = async () => {
            const L = (await import('leaflet')).default;
            await import('leaflet.markercluster');
            if (cancelled || !mapRef.current) return;
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

            const currentMarkerIds = new Set(markersRef.current.keys());
            const nextItemMap = new Map(geoItems.map(i => [i.id, i]));
            const nextItemIds = new Set(nextItemMap.keys());
            
            // Determine if markers actually changed
            const added = Array.from(nextItemIds).filter(id => !currentMarkerIds.has(id));
            const removed = Array.from(currentMarkerIds).filter(id => !nextItemIds.has(id));

            removed.forEach(id => {
                const marker = markersRef.current.get(id);
                if (marker) {
                    targetLayer.removeLayer(marker);
                    markersRef.current.delete(id);
                }
            });

            const toAdd: L.Marker[] = [];
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

                marker.on('click', (e: L.LeafletMouseEvent) => {
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

            // Fix fitBounds: trigger only if the set of locations changed
            if (geoItems.length > 0 && (added.length > 0 || removed.length > 0)) {
                let itemsToFrame = geoItems.filter(i => i.latitude! > -60 && i.latitude! < 75);
                if (itemsToFrame.length === 0) itemsToFrame = geoItems;

                const bounds = L.latLngBounds(
                    itemsToFrame.map(i => [i.latitude!, i.longitude!] as [number, number])
                );
                map.fitBounds(bounds, { padding: [40, 40], maxZoom: 6 });
            }
        };

        loadLeaflet();
        return () => { cancelled = true; };
    }, [mapReady, clusteringEnabled, onSelectItem, geoItems]); // Remove selectedItemId dependency!

    // highlight active marker
    useEffect(() => {
        if (!mapReady || !mapRef.current) return;

        const updateActiveMarker = async () => {
            const L = (await import('leaflet')).default;

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
                    const item = geoItems.find(i => i.id === selectedItemId);
                    marker.setIcon(createCategoryIcon(L, item?.category, true));
                    marker.openPopup();
                };

                if (clusteringEnabled && clusterGroupRef.current) {
                    const visibleParent = clusterGroupRef.current.getVisibleParent(marker);

                    if (visibleParent === marker) {
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
                        clusterGroupRef.current.zoomToShowLayer(marker, () => {
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
    }, [selectedItemId, selectionVersion, clusteringEnabled, geoItems, mapReady]);

    useEffect(() => {
        setMapStyle(isDarkMode ? 'dark' : 'standard');
    }, [isDarkMode]);

    useEffect(() => {
        if (!mapRef.current) return;

        const applyStyle = async () => {
            const L = (await import('leaflet')).default;
            const style = MAP_STYLES[mapStyle];
            
            if (tileLayerRef.current) {
                mapRef.current!.removeLayer(tileLayerRef.current);
            }

            tileLayerRef.current = L.tileLayer(style.url, {
                maxZoom: 19,
                attribution: style.attribution,
                noWrap: false,
            }).addTo(mapRef.current!);
        };

        applyStyle();
    }, [mapStyle]);

    return (
        <div className="map-wrapper">
            <MapSettings
                mapStyle={mapStyle}
                onStyleChange={setMapStyle}
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
