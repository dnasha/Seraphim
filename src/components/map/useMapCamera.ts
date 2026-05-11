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

  // Calculate initial view state based on resolution via interpolation between known ideal points.
  const getInitialViewState = useCallback(() => {
    if (typeof window === "undefined")
      return { center: [11.2907, 36.2494] as [number, number], zoom: 1.1 };
    
    const width = window.innerWidth;
    const height = window.innerHeight;
    const isMobile = width <= 860;
    
    // Sidebar is 400px wide on desktop, 0px (overlay) on mobile
    const mapWidth = isMobile ? width : width - 400;

    // Ideal points for resolution-aware scaling:
    // P1 (1080p): 1920x1080 display -> 1520 map width -> zoom 1.1
    // P2 (2K): 2560x1440 display -> 2160 map width -> zoom 2.1
    
    const baseWidth = 1520;
    const targetWidth = 2160;
    const baseZoom = 1.1;
    const targetZoom = 2.1;
    
    // Calculate interpolation factor 't' based on current map width relative to P1 and P2.
    const tW = (mapWidth - baseWidth) / (targetWidth - baseWidth);
    const tH = (height - 1080) / (1440 - 1080);
    
    // We take the max growth to ensure we don't zoom out too much on narrow or tall displays.
    // Clamping t at -0.2 prevents extreme zoom-outs on smaller 1K/16:10 screens.
    const t = Math.max(-0.2, Math.max(isNaN(tW) ? 0 : tW, isNaN(tH) ? 0 : tH));
    
    // Center point persists across all resolutions as requested.
    const center: [number, number] = [11.2907, 36.2494];
    
    // Extrapolate zoom
    const zoom = baseZoom + t * (targetZoom - baseZoom);

    // Apply healthy clamping: 
    // - On desktop, we use a floor of 1.2 to get closer to the requested 'global' look,
    //   while still providing enough height to minimize the 'snap-to-equator' effect.
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

  // Manages selection state, camera flyTo animations, and popup visibility.
  useEffect(() => {
    if (!mapReady || !mapRef.current || !popupRef.current) return;
    const map = mapRef.current;

    // Sync layer filters with current selection.
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
          
          // Open the popup immediately at the target coordinates for an instant, responsive feel.
          // MapLibre will handle keeping the popup attached to these coordinates during the flyTo.
          if (popupContainer) {
            popupRef.current
              .setLngLat([item.longitude!, item.latitude!])
              .setDOMContent(popupContainer)
              .addTo(map);
          }

          map.once("moveend", () => {
            isFlyingRef.current = false;
            // Final synchronization at the end of the flight when all jitters and bounding box updates have settled.
            const finalItem =
              latestGeoItemsRef.current.find(
                (i) => i.id === selectedItemId || i.originalId === selectedItemId,
              ) || item;

            if (popupRef.current && finalItem.latitude != null) {
              popupRef.current.setLngLat([finalItem.longitude!, finalItem.latitude!]);
              // Also perform a final camera adjustment to ensure the pin is perfectly focused.
              map.easeTo({
                center: [finalItem.longitude!, finalItem.latitude!],
                duration: 300,
                essential: true,
              });
            }
          });

          const containerHeight = containerRef.current?.clientHeight || 800;
          // Dynamically adjust padding to avoid pushing the pin off-screen on small/mobile displays.
          const responsivePadding = Math.min(250, Math.floor(containerHeight * 0.25));

          map.flyTo({
            center: [item.longitude!, item.latitude!],
            zoom: targetZoom,
            pitch: animatedEffects && isGlobe ? 45 : 0,
            bearing: animatedEffects && isGlobe ? (Math.random() - 0.5) * 10 : 0,
            speed: animatedEffects ? 1.8 : 1.2,
            curve: animatedEffects ? 1.2 : 1,
            essential: true,
            // Apply padding only at higher zoom levels to keep the globe centered during wide transitions.
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
        // Reset padding when deselected to prevent cumulative viewport offsets.
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

    // Sync popup position if the item's jittered coordinates have updated.
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
        // Only re-sync position if the jitter significantly changed and we aren't in the middle of a flight.
        // This prevents the "vibrating" camera sensation during data refreshes while flying.
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
