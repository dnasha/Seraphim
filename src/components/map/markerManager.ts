import type { Marker, MarkerClusterGroup, LayerGroup, MarkerCluster, Map as LeafletMap, LatLng } from 'leaflet';
import { NewsItem } from '@/lib/types';
import { createCategoryIcon, getCategoryColor, formatTimeAgo, getSourceBadgeColor } from './MapConstants';

/**
 * Manages Leaflet markers, clustering, and selection state.
 */
export class MarkerManager {
    private map: LeafletMap;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private L: any;
    private markers: Map<string, Marker> = new Map();
    private clusterGroup: MarkerClusterGroup | null = null;
    private directGroup: LayerGroup | null = null;
    private clusteringEnabled: boolean = false;
    private onSelectItem: (id: string | null) => void;
    private lastHighlightedId: string | null = null;
    private getSelectedItemId: () => string | null;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(map: LeafletMap, L: any, onSelectItem: (id: string | null) => void, getSelectedItemId: () => string | null) {
        this.map = map;
        this.L = L;
        this.onSelectItem = onSelectItem;
        this.getSelectedItemId = getSelectedItemId;
    }

    /**
     * Removes all layers and clears marker cache.
     */
    public cleanup() {
        if (this.clusterGroup) this.map.removeLayer(this.clusterGroup);
        if (this.directGroup) this.map.removeLayer(this.directGroup);
        this.markers.clear();
    }

    /**
     * Updates map markers to match provided geo-items, handling clustering transitions.
     */
    public syncMarkers(geoItems: NewsItem[], clusteringEnabled: boolean, initialSelectedId: string | null, animate: boolean = true) {
        const L = this.L;
        const map = this.map;

        const currentIsClustered = !!this.clusterGroup;
        if (currentIsClustered !== clusteringEnabled) {
            if (this.clusterGroup) map.removeLayer(this.clusterGroup);
            if (this.directGroup) map.removeLayer(this.directGroup);
            this.clusterGroup = null;
            this.directGroup = null;
            this.markers.clear();
        }
        this.clusteringEnabled = clusteringEnabled;

        let targetLayer: LayerGroup | MarkerClusterGroup;
        if (clusteringEnabled) {
            if (!this.clusterGroup) {
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
                this.clusterGroup = group;
                map.addLayer(group);
            }
            targetLayer = this.clusterGroup!;
        } else {
            if (!this.directGroup) {
                const group = L.layerGroup();
                this.directGroup = group;
                map.addLayer(group);
            }
            targetLayer = this.directGroup!;
        }

        // diff marker sets to avoid unnecessary re-renders
        const currentMarkerIds = new Set(this.markers.keys());
        const nextItemMap = new Map(geoItems.map(i => [i.id, i]));
        const nextItemIds = new Set(nextItemMap.keys());
        
        const added = Array.from(nextItemIds).filter(id => !currentMarkerIds.has(id));
        const removed = Array.from(currentMarkerIds).filter(id => !nextItemIds.has(id));

        removed.forEach(id => {
            const marker = this.markers.get(id);
            if (marker) {
                targetLayer.removeLayer(marker);
                this.markers.delete(id);
            }
        });

        const toAdd: Marker[] = [];
        added.forEach(id => {
            const item = nextItemMap.get(id)!;
            const icon = createCategoryIcon(L, item.category, item.id === initialSelectedId);
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

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            marker.on('click', (e: any) => {
                L.DomEvent.stopPropagation(e);
                const isSelected = this.getSelectedItemId() === item.id;
                this.onSelectItem(isSelected ? null : item.id);
            });

            this.markers.set(item.id, marker);
            toAdd.push(marker);
        });

        if (toAdd.length > 0) {
            if (clusteringEnabled) {
                (targetLayer as MarkerClusterGroup).addLayers(toAdd);
            } else {
                toAdd.forEach(m => (targetLayer as LayerGroup).addLayer(m));
            }
        }

        // auto-frame initial set of markers
        if (geoItems.length > 0 && (added.length > 0 || removed.length > 0)) {
            let itemsToFrame = geoItems.filter(i => i.latitude! > -60 && i.latitude! < 75);
            if (itemsToFrame.length === 0) itemsToFrame = geoItems;
            const bounds = L.latLngBounds(itemsToFrame.map(i => [i.latitude!, i.longitude!] as [number, number]));
            map.fitBounds(bounds, { padding: [40, 40], maxZoom: 6, animate });
        }
    }

    /**
     * Highlights the selected marker and handles camera movements/popups.
     */
    public highlightMarker(selectedItemId: string | null, geoItems: NewsItem[]) {
        const L = this.L;
        const map = this.map;
        const prevId = this.lastHighlightedId;
        const nextId = selectedItemId;

        if (prevId === nextId && !nextId) return;

        if (prevId && prevId !== nextId) {
            const prevMarker = this.markers.get(prevId);
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
            const nextMarker = this.markers.get(nextId);
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
                        // wait for flyTo transition to finish before showing popup
                        map.once('moveend', () => setTimeout(showPopup, 50));
                        map.flyTo(target, zoom, { animate: true, duration: 0.8 });
                    }
                };

                if (this.clusteringEnabled && this.clusterGroup) {
                    const visibleParent = this.clusterGroup.getVisibleParent(nextMarker);
                    if (visibleParent === nextMarker) {
                        flyToMarker(latlng, targetZoom);
                    } else {
                        this.clusterGroup.zoomToShowLayer(nextMarker, () => {
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

        this.lastHighlightedId = nextId;
    }
}
