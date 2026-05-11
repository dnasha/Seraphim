/**
 * Map Camera Hook
 * Manages the map's viewport state, including resolution-aware initial positioning,
 * smooth transitions (flyTo), and synchronization of popups with camera movement.
 */

import { useEffect, useCallback, useRef } from "react";
import maplibregl from "maplibre-gl";
import { NewsItem } from "@/lib/core/types";
import { CLUSTER_MAX_ZOOM } from "./utils";

interface UseMapCameraProps {
  mapRef: React.MutableRefObject<maplibregl.Map | null>;
  mapReady: boolean;
  popupRef: React.MutableRefObject<maplibregl.Popup | null>;
  popupContainer: HTMLDivElement | null;
  selectedItemId: string | null;
  selectionVersion: number;
  geoItems: (NewsItem & { isTopHot?: boolean })[];
  latestGeoItemsRef: React.MutableRefObject<(NewsItem & { isTopHot?: boolean })[]>;
  animatedEffects: boolean;
  isGlobe: boolean;
  forceIndividualPinsRef: React.MutableRefObject<boolean>;
  containerRef: React.RefObject<HTMLDivElement | null>;
}

export function useMapCamera({
  mapRef,
  mapReady,
  popupRef,
  popupContainer,
  selectedItemId,
  selectionVersion,
  geoItems,
  latestGeoItemsRef,
  animatedEffects,
  isGlobe,
  forceIndividualPinsRef,
  containerRef,
}: UseMapCameraProps) {
  const lastFlownSelectionRef = useRef<string | null>(null);
  const lastFlownVersionRef = useRef(0);
  const isFlyingRef = useRef(false);

  // Resolution-aware initial view calculation.
  // Performs linear interpolation between two known-good display profiles:
  // P1: 1080p (1520px map) -> Zoom 1.1
  // P2: 2K (2160px map) -> Zoom 2.1
  const getInitialViewState = useCallback(() => {
    if (typeof window === "undefined")
      return { center: [11.2907, 36.2494] as [number, number], zoom: 1.1 };
    
    const width = window.innerWidth;
    const height = window.innerHeight;
    const isMobile = width <= 860;
    
    // Account for the fixed 400px sidebar on desktop.
    const mapWidth = isMobile ? width : width - 400;
    
    const baseWidth = 1520;
    const targetWidth = 2160;
    const baseZoom = 1.1;
    const targetZoom = 2.1;
    
    const tW = (mapWidth - baseWidth) / (targetWidth - baseWidth);
    const tH = (height - 1080) / (1440 - 1080);
    
    // Use the maximum growth factor to ensure consistency across varying aspect ratios.
    const t = Math.max(-0.2, Math.max(isNaN(tW) ? 0 : tW, isNaN(tH) ? 0 : tH));
    
    const center: [number, number] = [11.2907, 36.2494];
    const zoom = baseZoom + t * (targetZoom - baseZoom);

    // Apply strict clamping: Floor 1.2 on desktop to avoid seeing the world-wrap boundary.
    const finalZoom = Math.max(isMobile ? 0.9 : 1.2, Math.min(zoom, 4.0));

    return {
      center,
      zoom: finalZoom,
    };
  }, []);

  const handleResetOrientation = useCallback(() => {
    if (!mapRef.current) return;
    mapRef.current.easeTo({
      pitch: 0,
      bearing: 0,
      padding: { top: 0, bottom: 0, left: 0, right: 0 },
      duration: 1000,
      easing: (t) => t * (2 - t),
    });
  }, [mapRef]);

  // Synchronize map selection with camera movement and popups.
  useEffect(() => {
    if (!mapReady || !mapRef.current || !popupRef.current) return;
    const map = mapRef.current;

    // Apply filtering to isolate the active selection from the standard pin layers.
    if (
      map.getLayer("unclustered-point") &&
      map.getLayer("unclustered-point-active")
    ) {
      const activeId = selectedItemId || "";
      const clusterCheck: maplibregl.FilterSpecification =
        forceIndividualPinsRef.current
          ? [
              "all",
              ["has", "point_count"],
              ["==", ["get", "id"], "___FORCE_HIDE_CLUSTERS___"],
            ]
          : [
              "any",
              ["has", "point_count"],
              [
                "all",
                [">", ["coalesce", ["get", "storyCount"], 0], 1],
                ["<", ["zoom"], CLUSTER_MAX_ZOOM],
              ],
            ];

      map.setFilter("unclustered-point", [
        "all",
        ["!", clusterCheck],
        ["!=", ["get", "id"], activeId],
      ]);
      map.setFilter("unclustered-point-active", [
        "all",
        ["!", clusterCheck],
        ["==", ["get", "id"], activeId],
      ]);

      if (map.getLayer("clusters-circle")) {
        map.setFilter("clusters-circle", clusterCheck);
      }
      if (map.getLayer("clusters-count")) {
        map.setFilter("clusters-count", clusterCheck);
      }
    }

    if (selectedItemId) {
      const item = geoItems.find(
        (i) => i.id === selectedItemId || i.originalId === selectedItemId,
      );
      if (item) {
        const isNewSelection =
          lastFlownSelectionRef.current !== selectedItemId ||
          lastFlownVersionRef.current !== selectionVersion;

        if (isNewSelection) {
          lastFlownSelectionRef.current = selectedItemId;
          lastFlownVersionRef.current = selectionVersion;

          const currentZoom = map.getZoom();
          const targetZoom = Math.max(currentZoom, 8.5);

          isFlyingRef.current = true;
          
          // Open the popup immediately. 
          // While MapLibre moves the camera, it also moves the popup. This ensures zero-latency feedback for the user.
          if (popupContainer) {
            popupRef.current
              .setLngLat([item.longitude!, item.latitude!])
              .setDOMContent(popupContainer)
              .addTo(map);
          }

          map.once("moveend", () => {
            isFlyingRef.current = false;
            const finalItem =
              latestGeoItemsRef.current.find(
                (i) => i.id === selectedItemId || i.originalId === selectedItemId,
              ) || item;

            if (popupRef.current && finalItem.latitude != null) {
              // Re-snap to final jittered position to account for any data updates during the flight.
              popupRef.current.setLngLat([finalItem.longitude!, finalItem.latitude!]);
              map.easeTo({
                center: [finalItem.longitude!, finalItem.latitude!],
                duration: 300,
                essential: true,
              });
            }
          });

          const containerHeight = containerRef.current?.clientHeight || 800;
          const responsivePadding = Math.min(250, Math.floor(containerHeight * 0.25));

          map.flyTo({
            center: [item.longitude!, item.latitude!],
            zoom: targetZoom,
            pitch: animatedEffects && isGlobe ? 45 : 0,
            bearing: animatedEffects && isGlobe ? (Math.random() - 0.5) * 10 : 0,
            speed: animatedEffects ? 1.8 : 1.2,
            curve: animatedEffects ? 1.2 : 1,
            essential: true,
            padding: {
              top: targetZoom > 4 ? responsivePadding : 0,
              bottom: 0,
              left: 0,
              right: 0,
            },
          });
        }
      }
    } else {
      if (!isFlyingRef.current) {
        popupRef.current?.remove();
        if (map.getPadding().top !== 0) {
          map.easeTo({
            padding: { top: 0, bottom: 0, left: 0, right: 0 },
            duration: 500,
          });
        }
      }
      lastFlownSelectionRef.current = null;
      lastFlownVersionRef.current = 0;
    }
  }, [
    selectedItemId,
    selectionVersion,
    geoItems,
    mapReady,
    animatedEffects,
    isGlobe,
    popupContainer,
    mapRef,
    popupRef,
    forceIndividualPinsRef,
    latestGeoItemsRef,
    containerRef,
  ]);

  useEffect(() => {
    if (!mapReady || !popupRef.current || !popupRef.current.isOpen()) return;

    // Sync popup position if coordinates shift (e.g., due to jitter re-calculation during background data refresh).
    if (selectedItemId) {
      const selectedItem = geoItems.find(
        (i) => i.id === selectedItemId || i.originalId === selectedItemId,
      );
      if (
        selectedItem &&
        selectedItem.latitude != null &&
        selectedItem.longitude != null
      ) {
        const currentPos = popupRef.current.getLngLat();
        const dist = Math.sqrt(
          Math.pow(currentPos.lng - selectedItem.longitude, 2) +
            Math.pow(currentPos.lat - selectedItem.latitude, 2),
        );
        
        // Suppress jitter re-sync during flights to prevent "vibrating" camera movement.
        if (dist > 0.0001 && !isFlyingRef.current) {
          popupRef.current.setLngLat([
            selectedItem.longitude,
            selectedItem.latitude,
          ]);
        }
      }
    }
  }, [geoItems, mapReady, selectedItemId, popupRef]);

  return {
    getInitialViewState,
    handleResetOrientation,
    isFlyingRef,
  };
}
