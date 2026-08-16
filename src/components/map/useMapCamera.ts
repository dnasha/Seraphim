/**
 * Map Camera Hook
 * Manages the map's viewport state, including resolution-aware initial positioning,
 * smooth transitions (flyTo), and synchronization of popups with camera movement.
 */

import { useEffect, useCallback, useRef } from "react";
import maplibregl from "maplibre-gl";
import { NewsItem } from "@/lib/core/types";
import { matchesNewsId } from "@/lib/utils/ranking";
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
  initialCenter?: [number, number];
  initialZoom?: number;
}

type SelectionCameraPadding = {
  top: number;
  bottom: number;
  left: number;
  right: number;
};

type CameraOrientation = {
  pitch: number;
  bearing: number;
};

const POPUP_VIEWPORT_GUTTER = 16;
const MOBILE_MINIMUM_VISIBLE_MAP_HEIGHT = 160;

export function calculateSelectionCameraPadding(
  mapHeight: number,
  popupHeight: number,
  isMobile: boolean,
): SelectionCameraPadding {
  const availableHeight = Math.max(1, mapHeight);
  const fittedPopupHeight = Math.max(
    0,
    Math.min(popupHeight, availableHeight - POPUP_VIEWPORT_GUTTER),
  );

  if (isMobile) {
    return {
      top: 0,
      bottom: Math.max(
        0,
        Math.min(
          availableHeight - MOBILE_MINIMUM_VISIBLE_MAP_HEIGHT,
          Math.ceil(fittedPopupHeight + POPUP_VIEWPORT_GUTTER),
        ),
      ),
      left: 0,
      right: 0,
    };
  }

  const requiredMarkerY = Math.min(
    availableHeight - POPUP_VIEWPORT_GUTTER,
    fittedPopupHeight + POPUP_VIEWPORT_GUTTER,
  );

  return {
    top: Math.max(
      0,
      Math.min(
        availableHeight - POPUP_VIEWPORT_GUTTER * 2,
        Math.ceil(requiredMarkerY * 2 - availableHeight),
      ),
    ),
    bottom: 0,
    left: 0,
    right: 0,
  };
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
  initialCenter,
  initialZoom,
}: UseMapCameraProps) {
  const lastFlownSelectionRef = useRef<string | null>(null);
  const lastFlownVersionRef = useRef(0);
  const lastFlownCoordsRef = useRef<[number, number] | null>(null);
  const isFlyingRef = useRef(false);
  const selectionCameraActiveRef = useRef(false);
  // Globe story flights temporarily own pitch and bearing. Keep the user's
  // prior orientation for the whole selection session so closing a story (or
  // switching through several stories, then closing) can return it intact.
  const preSelectionOrientationRef = useRef<CameraOrientation | null>(null);
  // Invalidates moveend handlers from a flight superseded by a retarget.
  const activeFlightIdRef = useRef(0);
  // Prevent the one-time post-style correction from being re-armed when a
  // selection is later closed during the same map-ready cycle.
  const initialCorrectionHandledRef = useRef(false);
  // A manual map gesture opts out of further camera corrections until the
  // user explicitly selects another card.
  const cameraFollowSuppressedRef = useRef(false);

  const getSelectionCameraPadding = useCallback(() => {
    const containerHeight =
      containerRef.current?.clientHeight ||
      (typeof window !== "undefined" ? window.innerHeight : 0) ||
      800;
    const popupElement = popupRef.current?.getElement?.();
    const measuredPopupHeight = popupElement?.getBoundingClientRect().height || 0;
    const fallbackPopupHeight = Math.min(720, containerHeight * 0.65);
    const isMobile =
      typeof window !== "undefined" && window.innerWidth <= 860;

    return calculateSelectionCameraPadding(
      containerHeight,
      measuredPopupHeight || fallbackPopupHeight,
      isMobile,
    );
  }, [containerRef, popupRef]);

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

  // MapLibre can clamp its constructor view while the style initializes, so
  // correct it once after readiness. A shared selection owns the camera,
  // though: never let this delayed correction interrupt that event's flyTo.
  useEffect(() => {
    if (!mapReady) {
      initialCorrectionHandledRef.current = false;
      return;
    }
    if (!mapRef.current || initialCorrectionHandledRef.current) return;
    initialCorrectionHandledRef.current = true;
    if (selectedItemId) return;

    const map = mapRef.current;
    const timer = setTimeout(() => {
      if (mapRef.current !== map) return;
      const initialView = getInitialViewState();
      map.jumpTo({
        center: initialCenter ?? initialView.center,
        zoom: initialZoom ?? initialView.zoom,
      });
    }, 100);

    return () => clearTimeout(timer);
  }, [
    getInitialViewState,
    initialCenter,
    initialZoom,
    mapReady,
    mapRef,
    selectedItemId,
  ]);

  const handleResetOrientation = useCallback(() => {
    if (!mapRef.current) return;
    // An explicit reset becomes the new user-owned orientation; closing the
    // current story must not restore an older angle afterward.
    preSelectionOrientationRef.current = null;
    mapRef.current.easeTo({
      pitch: 0,
      bearing: 0,
      padding: { top: 0, bottom: 0, left: 0, right: 0 },
      duration: 1000,
      easing: (t) => t * (2 - t),
    });
  }, [mapRef]);

  const cancelCameraFlight = useCallback(() => {
    cameraFollowSuppressedRef.current = true;
    activeFlightIdRef.current += 1;
    const hadSelectionCameraMotion = selectionCameraActiveRef.current;
    selectionCameraActiveRef.current = false;
    isFlyingRef.current = false;
    if (hadSelectionCameraMotion) mapRef.current?.stop();
  }, [mapRef]);

  // A pointer or wheel gesture belongs to the user. Cancel any pending
  // programmatic arrival correction before it can pull the map back.
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const canvas = mapRef.current.getCanvas();
    const handleUserCameraIntent = () => {
      cameraFollowSuppressedRef.current = true;
      if (selectionCameraActiveRef.current) cancelCameraFlight();
    };

    canvas.addEventListener("pointerdown", handleUserCameraIntent, { passive: true });
    canvas.addEventListener("wheel", handleUserCameraIntent, { passive: true });
    return () => {
      canvas.removeEventListener("pointerdown", handleUserCameraIntent);
      canvas.removeEventListener("wheel", handleUserCameraIntent);
    };
  }, [cancelCameraFlight, mapReady, mapRef]);

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
        ["!=", ["coalesce", ["get", "canonicalId"], ["get", "id"]], activeId],
      ]);
      map.setFilter("unclustered-point-active", [
        "all",
        ["!", clusterCheck],
        ["==", ["get", "id"], "___USE_SELECTED_NEWS_EVENT_SOURCE___"],
      ]);

      if (map.getLayer("clusters-circle")) {
        map.setFilter("clusters-circle", clusterCheck);
      }
      if (map.getLayer("clusters-count")) {
        map.setFilter("clusters-count", clusterCheck);
      }
    }

    if (selectedItemId) {
      const item = geoItems.find((i) => matchesNewsId(i, selectedItemId));
      if (!item) {
        // A feed refresh can briefly remove the selected entity before its exact
        // detail request restores it. Treat its return as a fresh arrival so the
        // popup and camera are deterministically restored.
        if (lastFlownSelectionRef.current === selectedItemId) {
          cancelCameraFlight();
          lastFlownSelectionRef.current = null;
          lastFlownVersionRef.current = 0;
          lastFlownCoordsRef.current = null;
        }
        return;
      }
      const isNewSelection =
        lastFlownSelectionRef.current !== selectedItemId ||
        lastFlownVersionRef.current !== selectionVersion;
      const shouldOpenPopup = !popupRef.current.isOpen();

      if (isNewSelection) {
        cameraFollowSuppressedRef.current = false;
        isFlyingRef.current = true;
        selectionCameraActiveRef.current = true;
      }

      if (popupContainer && (isNewSelection || shouldOpenPopup)) {
        popupRef.current.setLngLat([item.longitude!, item.latitude!]);

        // Reuse an open popup in place when switching events. Calling addTo()
        // again removes the existing popup first, which emits "close" and can
        // clear the newly selected event before its camera flight begins.
        if (shouldOpenPopup) {
          popupRef.current
            .setDOMContent(popupContainer)
            .addTo(map);
        }
      }

      if (isNewSelection) {
        lastFlownSelectionRef.current = selectedItemId;
        lastFlownVersionRef.current = selectionVersion;
        lastFlownCoordsRef.current = [item.longitude!, item.latitude!];
        const flightId = ++activeFlightIdRef.current;

        const currentZoom = map.getZoom();
        const targetZoom = Math.max(currentZoom, 8.5);
        const selectionPadding = getSelectionCameraPadding();
        const appliesGlobeOrientation = animatedEffects && isGlobe;

        if (appliesGlobeOrientation && !preSelectionOrientationRef.current) {
          preSelectionOrientationRef.current = {
            pitch: map.getPitch(),
            bearing: map.getBearing(),
          };
        }

        map.flyTo({
          center: [item.longitude!, item.latitude!],
          zoom: targetZoom,
          pitch: appliesGlobeOrientation ? 45 : 0,
          bearing: appliesGlobeOrientation ? (Math.random() - 0.5) * 10 : 0,
          speed: animatedEffects ? 1.8 : 1.2,
          curve: animatedEffects ? 1.2 : 1,
          essential: true,
          padding:
            targetZoom > 4
              ? selectionPadding
              : { top: 0, bottom: 0, left: 0, right: 0 },
        });

        map.once("moveend", () => {
          if (flightId !== activeFlightIdRef.current) return;
          const finalItem =
            latestGeoItemsRef.current.find((i) =>
              matchesNewsId(i, selectedItemId),
            ) || item;

          if (popupRef.current && finalItem.latitude != null) {
            lastFlownCoordsRef.current = [finalItem.longitude!, finalItem.latitude!];
            // Fallback for location data that arrives after the flight lands.
            popupRef.current.setLngLat([finalItem.longitude!, finalItem.latitude!]);
            map.easeTo({
              center: [finalItem.longitude!, finalItem.latitude!],
              duration: 300,
              essential: true,
              padding:
                targetZoom > 4
                  ? getSelectionCameraPadding()
                  : { top: 0, bottom: 0, left: 0, right: 0 },
            });
            map.once("moveend", () => {
              if (flightId !== activeFlightIdRef.current) return;
              selectionCameraActiveRef.current = false;
              isFlyingRef.current = false;
            });
          } else {
            selectionCameraActiveRef.current = false;
            isFlyingRef.current = false;
          }
        });
      }
    } else {
      const hadSelectionCameraState =
        lastFlownSelectionRef.current !== null ||
        preSelectionOrientationRef.current !== null;
      if (hadSelectionCameraState) {
        cancelCameraFlight();
        const currentPadding = map.getPadding();
        const hasSelectionPadding =
          currentPadding.top !== 0 ||
          currentPadding.bottom !== 0 ||
          currentPadding.left !== 0 ||
          currentPadding.right !== 0;
        const previousOrientation = preSelectionOrientationRef.current;

        if (hasSelectionPadding || (previousOrientation && isGlobe)) {
          map.easeTo({
            padding: { top: 0, bottom: 0, left: 0, right: 0 },
            ...(previousOrientation && isGlobe
              ? {
                  pitch: previousOrientation.pitch,
                  bearing: previousOrientation.bearing,
                }
              : {}),
            duration: 300,
          });
        }
        preSelectionOrientationRef.current = null;
        lastFlownSelectionRef.current = null;
        lastFlownVersionRef.current = 0;
      }
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
    cancelCameraFlight,
    getSelectionCameraPadding,
  ]);

  useEffect(() => {
    if (
      !selectedItemId ||
      !mapReady ||
      !mapRef.current ||
      !popupRef.current ||
      typeof ResizeObserver === "undefined"
    ) {
      return;
    }

    const map = mapRef.current;
    const popupElement = popupRef.current.getElement?.();
    const observedElement =
      popupElement?.querySelector<HTMLElement>(".news-popup") || popupElement;
    if (!observedElement) return;

    let animationFrame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(animationFrame);
      animationFrame = requestAnimationFrame(() => {
        if (
          cameraFollowSuppressedRef.current ||
          isFlyingRef.current ||
          !popupRef.current?.isOpen()
        ) {
          return;
        }

        const selectedItem = latestGeoItemsRef.current.find((item) =>
          matchesNewsId(item, selectedItemId),
        );
        if (
          !selectedItem ||
          selectedItem.latitude == null ||
          selectedItem.longitude == null
        ) {
          return;
        }

        const nextPadding = getSelectionCameraPadding();
        const currentPadding = map.getPadding();
        if (
          Math.abs((currentPadding.top ?? 0) - nextPadding.top) < 1 &&
          Math.abs((currentPadding.bottom ?? 0) - nextPadding.bottom) < 1 &&
          Math.abs((currentPadding.left ?? 0) - nextPadding.left) < 1 &&
          Math.abs((currentPadding.right ?? 0) - nextPadding.right) < 1
        ) {
          return;
        }

        const correctionId = ++activeFlightIdRef.current;
        selectionCameraActiveRef.current = true;
        isFlyingRef.current = true;
        map.easeTo({
          center: [selectedItem.longitude, selectedItem.latitude],
          padding: nextPadding,
          duration: 250,
          essential: true,
        });
        map.once("moveend", () => {
          if (correctionId !== activeFlightIdRef.current) return;
          selectionCameraActiveRef.current = false;
          isFlyingRef.current = false;
        });
      });
    });

    observer.observe(observedElement);
    return () => {
      cancelAnimationFrame(animationFrame);
      observer.disconnect();
    };
  }, [
    getSelectionCameraPadding,
    latestGeoItemsRef,
    mapReady,
    mapRef,
    popupRef,
    selectedItemId,
  ]);

  useEffect(() => {
    if (!mapReady || !mapRef.current || !popupRef.current || !popupRef.current.isOpen()) return;

    // Sync popup position if coordinates shift (e.g., due to jitter re-calculation during background data refresh).
    if (selectedItemId) {
      const selectedItem = geoItems.find((i) =>
        matchesNewsId(i, selectedItemId),
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
        
        if (
          dist > 0.05 &&
          isFlyingRef.current &&
          !cameraFollowSuppressedRef.current
        ) {
          // A server-side cluster has resolved to the selected event's exact
          // coordinate. Redirect the active flight instead of snapping after it.
          const flightId = ++activeFlightIdRef.current;
          selectionCameraActiveRef.current = true;
          const targetZoom = Math.max(mapRef.current.getZoom(), 8.5);
          const selectionPadding = getSelectionCameraPadding();

          popupRef.current.setLngLat([
            selectedItem.longitude,
            selectedItem.latitude,
          ]);
          lastFlownCoordsRef.current = [selectedItem.longitude, selectedItem.latitude];

          mapRef.current.flyTo({
            center: [selectedItem.longitude, selectedItem.latitude],
            zoom: targetZoom,
            speed: animatedEffects && isGlobe ? 1.8 : 1.2,
            curve: animatedEffects ? 1.2 : 1,
            essential: true,
            padding:
              targetZoom > 4
                ? selectionPadding
                : { top: 0, bottom: 0, left: 0, right: 0 },
          });

          mapRef.current.once("moveend", () => {
            if (flightId !== activeFlightIdRef.current) return;
            selectionCameraActiveRef.current = false;
            isFlyingRef.current = false;

            const finalItem = latestGeoItemsRef.current.find((i) =>
              matchesNewsId(i, selectedItemId),
            );
            if (popupRef.current && finalItem?.latitude != null) {
              lastFlownCoordsRef.current = [finalItem.longitude!, finalItem.latitude!];
              popupRef.current.setLngLat([finalItem.longitude!, finalItem.latitude!]);
            }
          });
          return;
        }

        // Suppress small jitter re-sync during flights to prevent vibration.
        if (dist > 0.0001 && !isFlyingRef.current) {
          popupRef.current.setLngLat([
            selectedItem.longitude,
            selectedItem.latitude,
          ]);

          if (cameraFollowSuppressedRef.current) {
            lastFlownCoordsRef.current = [selectedItem.longitude, selectedItem.latitude];
            return;
          }

          // Seamlessly align the camera with the new jittered/precise position.
          const correctionId = ++activeFlightIdRef.current;
          selectionCameraActiveRef.current = true;
          isFlyingRef.current = true;
          if (dist > 0.05) {
            // Significant shift (e.g., cluster to precise coord) - use flyTo for a smooth arc.
            mapRef.current.flyTo({
              center: [selectedItem.longitude, selectedItem.latitude],
              zoom: Math.max(mapRef.current.getZoom(), 8.5),
              speed: 1.2,
              essential: true
            });
          } else {
            // Minor shift (e.g., local jitter) - use easeTo for a subtle nudge.
            mapRef.current.easeTo({
              center: [selectedItem.longitude, selectedItem.latitude],
              duration: 300,
              essential: true
            });
          }
          mapRef.current.once("moveend", () => {
            if (correctionId !== activeFlightIdRef.current) return;
            selectionCameraActiveRef.current = false;
            isFlyingRef.current = false;
          });
          lastFlownCoordsRef.current = [selectedItem.longitude, selectedItem.latitude];
        }
      }
    }
  }, [
    geoItems,
    mapReady,
    selectedItemId,
    popupRef,
    mapRef,
    latestGeoItemsRef,
    containerRef,
    animatedEffects,
    isGlobe,
    getSelectionCameraPadding,
  ]);

  return {
    getInitialViewState,
    handleResetOrientation,
    cancelCameraFlight,
    isFlyingRef,
  };
}
