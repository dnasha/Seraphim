/**
 * NewsMap Component
 * The central interactive map for the Seraphim OSINT dashboard.
 * Manages MapLibre GL JS lifecycle, client-side clustering, live data overlays,
 * and seamless synchronization between map state and application UI.
 */

"use client";

import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { createPortal } from "react-dom";
import { NewsItem, BBox } from "@/lib/core/types";
import maplibregl from "maplibre-gl";

import "maplibre-gl/dist/maplibre-gl.css";
import MapPopup from "./MapPopup";

import { getMapLibreStyle } from "./MapConstants";
import { canonicalEventCount, latestReportTimestamp } from "@/lib/utils/ranking";
import { applyClientJitter } from "./utils";
import { useMapLayers } from "./useMapLayers";
import { useMapCamera } from "./useMapCamera";
import MapSettings from "./MapSettings";
import MapActionTools from "./MapActionTools";
import MapError from "./MapError";
import MapLoading from "./MapLoading";
import UpgradeButton from "./UpgradeButton";
import MapDrawTools from "./MapDrawTools";
import styles from "./NewsMap.module.css";

interface NewsMapProps {
  items: NewsItem[];
  selectedItemId: string | null;
  selectionVersion: number;
  onSelectItem: (id: string | null) => void;
  isDarkMode: boolean;
  unmappedOnly: boolean;
  onUnmappedOnlyChange: (val: boolean) => void;
  animatedEffects: boolean;
  onAnimatedEffectsChange: (val: boolean) => void;
  onBoundsChange?: (bbox: BBox) => void;
  initialCenter?: [number, number];
  initialZoom?: number;
  sortMode: "new" | "hot";
  disabled?: boolean;
  isSidebarOpen?: boolean;
  userTier?: string;
  /** True while the tier is still being resolved from DB */
  tierLoading?: boolean;
}

/**
 * Extended Map type to support MapLibre 5.0+ features like Globe projection and Fog.
 */
type ExtendedMap = maplibregl.Map & {
  setProjection?: (projection: { type: string }) => void;
  setFog?: (fog: unknown) => void;
};

export default function NewsMap({
  items,
  selectedItemId,
  selectionVersion,
  onSelectItem,
  isDarkMode,
  unmappedOnly,
  onUnmappedOnlyChange,
  animatedEffects,
  onAnimatedEffectsChange,
  onBoundsChange,
  initialCenter,
  initialZoom,
  sortMode,
  disabled = false,
  isSidebarOpen = true,
  userTier = 'guest',
  tierLoading = false,
}: NewsMapProps) {
  const [mapBearing, setMapBearing] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const pulseAnimationFrameRef = useRef<number | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const eventsWiredRef = useRef(false);
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [drawToolsOpen, setDrawToolsOpen] = useState(false);
  const [forceIndividualPins, setForceIndividualPins] = useState(false);
  const [currentStyle, setCurrentStyle] = useState<string>(
    isDarkMode ? "dark" : "standard",
  );
  const [overlays, setOverlays] = useState<Record<string, boolean>>({
    usgs: false,
    noaa: false,
    eonet: false,
  });

  // Initialize popup container element once to prevent hydration mismatches and redundant DOM operations.
  const popupContainer = useMemo(() => {
    if (typeof document !== 'undefined') {
      return document.createElement('div');
    }
    return null;
  }, []);

  const [isGlobe, setIsGlobe] = useState(false);
  const isGlobeRef = useRef(isGlobe);
  const currentStyleRef = useRef(currentStyle);

  useEffect(() => {
    isGlobeRef.current = isGlobe;
  }, [isGlobe]);

  useEffect(() => {
    currentStyleRef.current = currentStyle;
  }, [currentStyle]);


  const settingsPanelRef = useRef<HTMLDivElement>(null);

  const onBoundsChangeRef = useRef(onBoundsChange);
  const onSelectItemRef = useRef(onSelectItem);
  const forceIndividualPinsRef = useRef(forceIndividualPins);
  const animatedEffectsRef = useRef(animatedEffects);
  const overlaysRef = useRef(overlays);

  const boundsDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cache for GeoJSON data to ensure persistence across style reloads or container resizes.
  const pendingGeoJsonRef = useRef<GeoJSON.FeatureCollection | null>(null);

  // Track resizing state to suppress API calls and jittering during intensive DOM changes.
  const isResizingRef = useRef(false);
  const resizeEndTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  useEffect(() => {
    onBoundsChangeRef.current = onBoundsChange;
  }, [onBoundsChange]);
  useEffect(() => {
    onSelectItemRef.current = onSelectItem;
  }, [onSelectItem]);
  useEffect(() => {
    forceIndividualPinsRef.current = forceIndividualPins;
  }, [forceIndividualPins]);
  useEffect(() => {
    animatedEffectsRef.current = animatedEffects;
  }, [animatedEffects]);
  useEffect(() => {
    overlaysRef.current = overlays;
  }, [overlays]);

  // Main animation loop for hot story pulses.
  // Performs low-level paint property updates for high-performance visual feedback.
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const map = mapRef.current;

    const animate = (timestamp: number) => {
      if (!animatedEffectsRef.current) {
        if (map.getLayer("hot-story-pulse")) {
          map.setPaintProperty("hot-story-pulse", "circle-radius", 0);
        }
        pulseAnimationFrameRef.current = requestAnimationFrame(animate);
        return;
      }

      const duration = 2000;
      const t = (timestamp % duration) / duration;

      const radius = 20 + t * 35;
      const opacity = Math.max(0, 0.6 * (1 - t));
      const blur = 0;

      if (map.getLayer("hot-story-pulse")) {
        map.setPaintProperty("hot-story-pulse", "circle-radius", radius);
        map.setPaintProperty("hot-story-pulse", "circle-opacity", opacity);
        map.setPaintProperty("hot-story-pulse", "circle-blur", blur);
      }

      pulseAnimationFrameRef.current = requestAnimationFrame(animate);
    };

    pulseAnimationFrameRef.current = requestAnimationFrame(animate);
    return () => {
      if (pulseAnimationFrameRef.current)
        cancelAnimationFrame(pulseAnimationFrameRef.current);
    };
  }, [mapReady]);

  // Handle style switching based on global theme state.
  const [prevIsDarkMode, setPrevIsDarkMode] = useState(isDarkMode);
  if (prevIsDarkMode !== isDarkMode) {
    setPrevIsDarkMode(isDarkMode);
    setCurrentStyle(isDarkMode ? "dark" : "standard");
  }

  // Pre-process items for the map: filter valid coords, apply jitter, and identify top stories.
  const geoItems = useMemo(() => {
    const valid = items.filter(
      (i) => i.latitude != null && i.longitude != null,
    );
    const jittered = applyClientJitter(valid, selectedItemId);

    const sorted = [...jittered].sort((a, b) => {
      if (sortMode === "hot") {
        const scoreA = a.impactScore || 0;
        const scoreB = b.impactScore || 0;
        if (scoreB !== scoreA) return scoreB - scoreA;

        const countA = canonicalEventCount(a);
        const countB = canonicalEventCount(b);
        if (countB !== countA) return countB - countA;
      }

      return latestReportTimestamp(b) - latestReportTimestamp(a);
    });

    const topIds = new Set(sorted.slice(0, 3).map((i) => i.id));

    return jittered.map((item) => ({
      ...item,
      isTopHot: topIds.has(item.id),
    }));
  }, [items, sortMode, selectedItemId]);

  const selectedItem = useMemo(() => {
    if (!selectedItemId) return null;
    return geoItems.find(
      (i) => i.id === selectedItemId || i.originalId === selectedItemId,
    ) || null;
  }, [geoItems, selectedItemId]);

  // Emit current viewport bounds to the parent with a debounce to minimize network traffic.
  const emitBounds = useCallback((map: maplibregl.Map) => {
    if (boundsDebounceRef.current) clearTimeout(boundsDebounceRef.current);
    boundsDebounceRef.current = setTimeout(() => {
      const bounds = map.getBounds();
      const center = map.getCenter();
      const bbox: BBox = {
        minLat: bounds.getSouth(),
        maxLat: bounds.getNorth(),
        minLng: bounds.getWest(),
        maxLng: bounds.getEast(),
        centerLat: center.lat,
        centerLng: center.lng,
        zoom: map.getZoom(),
        forceRaw: forceIndividualPinsRef.current,
      };
      onBoundsChangeRef.current?.(bbox);
    }, 150);
  }, []);

  const latestGeoItemsRef = useRef(geoItems);
  useEffect(() => {
    latestGeoItemsRef.current = geoItems;
  }, [geoItems]);

  const { addSourcesAndLayers } = useMapLayers({
    forceIndividualPinsRef,
    overlaysRef,
    pendingGeoJsonRef,
  });

  const { getInitialViewState, handleResetOrientation, isFlyingRef } = useMapCamera({
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
  });

  // Core map initialization and event wiring.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    let map: maplibregl.Map;

    try {
      const view = getInitialViewState();
      const isNum = (v: number | undefined | null): v is number =>
        typeof v === "number" && Number.isFinite(v);

      // Implementation of an airtight fallback chain for initial position.
      // Prioritizes: Initial props > Resolution-aware interpolation > Hardcoded center.
      const fallbackCenter: [number, number] = [9.8454, 7.8751];
      const finalCenter: [number, number] =
        initialCenter && isNum(initialCenter[0]) && isNum(initialCenter[1])
          ? initialCenter
          : view.center && isNum(view.center[0]) && isNum(view.center[1])
            ? view.center
            : fallbackCenter;

      const finalZoom = isNum(initialZoom)
        ? initialZoom
        : isNum(view.zoom)
          ? view.zoom
          : 1.2;

      const isMobileLocal = typeof window !== "undefined" && window.innerWidth <= 860;

      map = new maplibregl.Map({
        container: containerRef.current as HTMLElement,
        style: getMapLibreStyle(currentStyle),
        center: finalCenter,
        zoom: finalZoom,
        minZoom: isMobileLocal ? 0.8 : 1.2,
        maxZoom: 18,
        attributionControl: false,
        trackResize: false,
        // @ts-expect-error - Internal property used for high-fidelity screenshots/rendering
        preserveDrawingBuffer: true,
      });
    } catch (err) {
      console.error("Failed to initialize MapLibre:", err);
      setTimeout(() => {
        setMapError(
          "Could not initialize map engine. Your browser may not support WebGL.",
        );
      }, 0);
      return;
    }

    map.on("error", (e) => {
      const errorMsg =
        e.error?.message || (typeof e.error === "string" ? e.error : "");

      // Filter non-critical errors from optional third-party overlays to prevent UI disruption.
      const isOverlayError =
        errorMsg.includes("eonet.gsfc.nasa.gov") ||
        errorMsg.includes("earthquake.usgs.gov") ||
        errorMsg.includes("mesonet.agron.iastate.edu");

      const isGlyphError =
        errorMsg.includes("glyphs") ||
        errorMsg.includes("fonts") ||
        errorMsg.includes("Open Sans") ||
        errorMsg.includes("Arial Unicode");

      if (e.error && !mapReady && !isOverlayError && !isGlyphError) {
        console.error("MapLibre error event:", e.error);
        setMapError(
          "Failed to load map resources. Please check your connection.",
        );
      } else if (isOverlayError || isGlyphError) {
        console.debug("Non-critical resource error suppressed:", errorMsg);
      }
    });

    map.addControl(
      new maplibregl.NavigationControl({ showCompass: false }),
      "top-right",
    );
    map.addControl(
      new maplibregl.ScaleControl({
        maxWidth: 80,
        unit: "metric",
      }),
      "bottom-left",
    );
    map.addControl(
      new maplibregl.AttributionControl({ compact: false }),
      "bottom-right",
    );

    popupRef.current = new maplibregl.Popup({
      closeButton: true,
      closeOnClick: false,
      className: "news-popup-container",
      maxWidth: "500px",
      anchor: "bottom",
    });

    popupRef.current.on("close", () => {
      if (!isFlyingRef.current) {
        onSelectItemRef.current(null);
      }
    });

    map.on("style.load", () => {
      // Configuration of Globe and Fog properties using local type extensions for MapLibre 5 compatibility.
      const extMap = map as ExtendedMap;
      if (extMap.setProjection) {
        extMap.setProjection({ type: isGlobeRef.current ? "globe" : "mercator" });
      }

      if (extMap.setFog) {
        if (isGlobeRef.current) {
          extMap.setFog({
            range: [-1, 2],
            color: currentStyleRef.current === "dark" ? "#000b1e" : "#ffffff",
            "horizon-blend": 0.1,
          });
        } else {
          extMap.setFog(null);
        }
      }

      addSourcesAndLayers(map).then(() => {
        if (!eventsWiredRef.current) {
          eventsWiredRef.current = true;

          map.on("click", "unclustered-point", (e) => {
            if (e.features?.[0])
              onSelectItemRef.current(e.features[0].properties.id);
          });
          map.on("click", "unclustered-point-active", (e) => {
            if (e.features?.[0])
              onSelectItemRef.current(e.features[0].properties.id);
          });

          map.on("click", "clusters-circle", async (e) => {
            const features = map.queryRenderedFeatures(e.point, {
              layers: ["clusters-circle"],
            });
            if (!features.length) return;
            const clusterId = features[0].properties.cluster_id;

            if (clusterId) {
              const source = map.getSource(
                "news-events",
              ) as maplibregl.GeoJSONSource;
              const zoom = await source.getClusterExpansionZoom(clusterId);
              map.flyTo({
                center:
                  features[0].geometry.type === "Point"
                    ? (features[0].geometry.coordinates as [number, number])
                    : undefined,
                zoom,
                speed: 1.5,
                curve: 1,
                essential: true,
              });
            } else {
              map.flyTo({
                center:
                  features[0].geometry.type === "Point"
                    ? (features[0].geometry.coordinates as [number, number])
                    : undefined,
                zoom: map.getZoom() + 2,
                speed: 1.2,
                essential: true,
              });
            }
          });

          for (const layer of [
            "clusters-circle",
            "unclustered-point",
            "unclustered-point-active",
          ]) {
            map.on("mouseenter", layer, () => {
              map.getCanvas().style.cursor = "pointer";
            });
            map.on("mouseleave", layer, () => {
              map.getCanvas().style.cursor = "";
            });
          }

          map.on("move", () => {
            setMapBearing(map.getBearing());
          });

          map.on("moveend", () => {
            if (!isResizingRef.current) {
              emitBounds(map);
            }
          });
        }
        setMapReady(true);
      });
    });

    mapRef.current = map;

    // Use ResizeObserver for synchronous layout synchronization.
    // This prevents the common visual lag between the DOM container and the WebGL canvas during sidebar transitions.
    const resizeObserver = new ResizeObserver(() => {
      isResizingRef.current = true;
      if (resizeEndTimeoutRef.current)
        clearTimeout(resizeEndTimeoutRef.current);
      resizeEndTimeoutRef.current = setTimeout(() => {
        isResizingRef.current = false;
      }, 150);

      map.resize();
    });

    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }

    return () => {
      if (resizeEndTimeoutRef.current)
        clearTimeout(resizeEndTimeoutRef.current);
      resizeObserver.disconnect();
      if (map) {
        try {
          map.remove();
        } catch (err) {
          console.warn("Suppressing map removal error:", err);
        }
      }
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retryCount]);

  const handleRetry = useCallback(() => {
    setMapError(null);
    setMapReady(false);
    setRetryCount((prev) => prev + 1);
  }, []);

  // Force a view adjustment after the map is ready to overcome early clamping by the map engine.
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const timer = setTimeout(() => {
      if (!mapRef.current) return;
      const initialView = getInitialViewState();
      const targetCenter = initialCenter ?? initialView.center;
      const targetZoom = initialZoom ?? initialView.zoom;
      mapRef.current.jumpTo({
        center: targetCenter,
        zoom: targetZoom,
      });
    }, 100);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady]);

  useEffect(() => {
    if (mapReady && mapRef.current) emitBounds(mapRef.current);
  }, [forceIndividualPins, mapReady, emitBounds]);

  useEffect(() => {
    if (!mapRef.current) return;
    setMapReady(false);
    mapRef.current.setStyle(getMapLibreStyle(currentStyle), { diff: false });
  }, [currentStyle, forceIndividualPins]);

  // Transform news items into a FeatureCollection for high-performance batch rendering.
  useEffect(() => {
    if (!mapReady || !mapRef.current || isResizingRef.current) return;

    const geojson: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: geoItems.map((item) => ({
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [item.longitude!, item.latitude!],
        },
        properties: {
          id: item.id,
          category: item.category,
          title: item.title,
          source: item.source,
          publishedAt: item.publishedAt,
          locationName: item.locationName,
          imageUrl: item.imageUrl,
          description: item.description,
          eventCount: item.sourcesCount,
          storyCount: item.storyCount ?? 1,
          sourcesCount: item.sourcesCount ?? 1,
          isTopHot: item.isTopHot ?? false,
          credibilityTier: item.credibilityTier ?? 3,
          sourceCount: canonicalEventCount(item),
        },
      })),
    };

    pendingGeoJsonRef.current = geojson;

    const source = mapRef.current.getSource(
      "news-events",
    ) as maplibregl.GeoJSONSource;
    if (source) source.setData(geojson);
  }, [geoItems, mapReady]);

  useEffect(() => {
    if (!settingsOpen) return;
    const handleClick = (e: MouseEvent) => {
      const panel = settingsPanelRef.current;
      if (panel && !panel.contains(e.target as Node)) setSettingsOpen(false);
    };
    const timer = setTimeout(
      () => document.addEventListener("click", handleClick),
      0,
    );
    return () => {
      clearTimeout(timer);
      document.removeEventListener("click", handleClick);
    };
  }, [settingsOpen]);

  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const map = mapRef.current;

    const setVis = (layer: string, show: boolean) => {
      if (map.getLayer(layer)) {
        map.setLayoutProperty(layer, "visibility", show ? "visible" : "none");
      }
    };

    setVis("overlay-usgs-point", overlays["usgs"]);
    setVis("overlay-noaa-raster", overlays["noaa"]);
    setVis("overlay-eonet-point", overlays["eonet"]);
  }, [overlays, mapReady, currentStyle]);

  // Handle runtime toggling of 3D Globe and atmospheric fog.
  useEffect(() => {
    if (!mapReady || !mapRef.current || !mapRef.current.isStyleLoaded()) return;
    const map = mapRef.current as ExtendedMap;

    if (map.setProjection) {
      map.setProjection({ type: isGlobe ? "globe" : "mercator" });
    }

    if (map.setFog) {
      if (isGlobe) {
        map.setFog({
          range: [-1, 2],
          color: currentStyle === "dark" ? "#000b1e" : "#ffffff",
          "horizon-blend": 0.1,
        });
      } else {
        map.setFog(null);
      }
    }

    if (!isGlobe) {
      map.jumpTo({ pitch: 0, bearing: 0 });
    }

    map.resize();
  }, [isGlobe, mapReady, currentStyle]);

  return (
    <div className={styles.mapWrapper}>
      {!mapReady && !mapError && <MapLoading />}
      {mapError && <MapError onRetry={handleRetry} error={mapError} />}

      {/* Upgrade CTA for non-paying users */}
      {!tierLoading && (userTier === 'free' || userTier === 'guest') && (
        <UpgradeButton isSidebarOpen={isSidebarOpen} />
      )}

      {!mapError && (
        <>
          <MapSettings
            mapStyle={currentStyle}
            onStyleChange={setCurrentStyle}
            forceIndividualPins={forceIndividualPins}
            onForceIndividualPinsToggle={() =>
              setForceIndividualPins((v) => !v)
            }
            isOpen={settingsOpen}
            onToggleOpen={() => setSettingsOpen((o) => !o)}
            panelRef={settingsPanelRef as React.RefObject<HTMLDivElement>}
            unmappedOnly={unmappedOnly}
            onUnmappedOnlyChange={onUnmappedOnlyChange}
            animatedEffects={animatedEffects}
            onAnimatedEffectsChange={onAnimatedEffectsChange}
            disabled={disabled}
          />
          <MapActionTools
            overlays={overlays}
            onOverlayToggle={(overlay, active) =>
              setOverlays((prev) => ({ ...prev, [overlay]: active }))
            }
            isGlobe={isGlobe}
            onToggleGlobe={() => setIsGlobe((v) => !v)}
            onResetOrientation={handleResetOrientation}
            drawToolsOpen={drawToolsOpen}
            onToggleDrawTools={() => setDrawToolsOpen((o) => !o)}
            bearing={mapBearing}
            disabled={disabled}
          />
          <MapDrawTools
            mapRef={mapRef}
            mapReady={mapReady}
            isOpen={drawToolsOpen}
            userTier={userTier}
          />
        </>
      )}
      <div
        ref={containerRef}
        id="news-map"
        className={styles.newsMapContainer}
        style={{ backfaceVisibility: "hidden", transform: "translateZ(0)" }}
      />

      {selectedItem && popupContainer && createPortal(
        <MapPopup item={selectedItem} />,
        popupContainer
      )}
    </div>
  );
}
