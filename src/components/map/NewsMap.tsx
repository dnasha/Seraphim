/**
 * NewsMap Component
 * The central interactive map for the Seraphim OSINT dashboard.
 * Manages MapLibre GL JS lifecycle, client-side clustering, live data overlays,
 * and seamless synchronization between map state and application UI.
 */

"use client";

import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { createPortal } from "react-dom";
import dynamic from "next/dynamic";
import { NewsItem, BBox } from "@/lib/core/types";
import maplibregl from "maplibre-gl";

import "maplibre-gl/dist/maplibre-gl.css";
import MapPopup from "./MapPopup";

import { getMapLibreStyle, MAP_STYLES } from "./MapConstants";
import {
  canonicalEventCount,
  canonicalNewsId,
  latestReportTimestamp,
  matchesNewsId,
} from "@/lib/utils/ranking";
import { applyClientJitter, selectedJitterAnchor } from "./utils";
import { useMapLayers } from "./useMapLayers";
import { useMapCamera } from "./useMapCamera";
import { startVisiblePolling } from "./overlayPolling";
import { buildNewsFeatureCollection } from "./newsGeoJson";
import { createHotStoryPulseController } from "./pulseController";
import {
  CLUSTERS_CIRCLE_PAINT,
  MUTED_CLUSTERS_CIRCLE_PAINT,
} from "./layers/mapLayerStyles";
import MapSettings from "./MapSettings";
import MapActionTools from "./MapActionTools";
import UpgradeButton from "./UpgradeButton";
import StateNotice from "@/components/ui/StateNotice";
import styles from "./NewsMap.module.css";
import { canUseMapStyle, canUseOverlay, hasFeature, type UserTier } from '@/lib/entitlements';
import type { SyncedPreferences } from '@/hooks/useSyncedPreferences';

const MapDrawTools = dynamic(() => import("./MapDrawTools"), { ssr: false });

interface NewsMapProps {
  items: NewsItem[];
  selectedItemId: string | null;
  selectionVersion: number;
  onSelectItem: (id: string | null) => void;
  isDarkMode: boolean;
  animatedEffects: boolean;
  onAnimatedEffectsChange: (val: boolean) => void;
  onBoundsChange?: (bbox: BBox) => void;
  initialCenter?: [number, number];
  initialZoom?: number;
  sortMode: "new" | "hot";
  disabled?: boolean;
  isSidebarOpen?: boolean;
  userTier?: UserTier;
  /** True while the tier is still being resolved from DB */
  tierLoading?: boolean;
  preferenceOwnerId?: string;
  syncedPreferences?: SyncedPreferences | null;
  onSyncedPreferencesChange?: (patch: Partial<SyncedPreferences>) => void;
}

/**
 * Extended Map type to support MapLibre 5.0+ features like Globe projection and Fog.
 */
type ExtendedMap = maplibregl.Map & {
  setProjection?: (projection: { type: string }) => void;
  setFog?: (fog: unknown) => void;
};

const devDebug = (message: unknown, ...optionalParams: unknown[]) => {
  if (process.env.NODE_ENV !== "production") {
    console.debug(message, ...optionalParams);
  }
};

const devWarn = (message: unknown, ...optionalParams: unknown[]) => {
  if (process.env.NODE_ENV !== "production") {
    console.warn(message, ...optionalParams);
  }
};

const MAP_RECOVERY_LIMIT = 2;
const MAP_RECOVERY_WINDOW_MS = 60_000;

function isRecoverableMapResourceError(errorMsg: string) {
  const msg = errorMsg.toLowerCase();
  return (
    msg.includes("eonet.gsfc.nasa.gov") ||
    msg.includes("earthquake.usgs.gov") ||
    msg.includes("mesonet.agron.iastate.edu") ||
    msg.includes("tiles.waqi.info") ||
    msg.includes("/api/proxy/") ||
    msg.includes("glyph") ||
    msg.includes("font") ||
    msg.includes("sprite") ||
    msg.includes("tile") ||
    msg.includes("source") ||
    msg.includes("image")
  );
}

export default function NewsMap({
  items,
  selectedItemId,
  selectionVersion,
  onSelectItem,
  isDarkMode,
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
  preferenceOwnerId,
  syncedPreferences,
  onSyncedPreferencesChange,
}: NewsMapProps) {
  const [mapBearing, setMapBearing] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const mapTilerLogoRef = useRef<HTMLAnchorElement | null>(null);
  const suppressPopupCloseRef = useRef(false);
  const eventsWiredRef = useRef(false);
  const [mapReady, setMapReady] = useState(false);
  const [isChangingStyle, setIsChangingStyle] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [drawToolsOpen, setDrawToolsOpen] = useState(false);
  const [forceIndividualPins, setForceIndividualPins] = useState(false);
  const [mutedClusters, setMutedClusters] = useState(false);
  const [currentStyle, setCurrentStyle] = useState<string>(
    isDarkMode ? "dark" : "standard",
  );
  const [overlays, setOverlays] = useState<Record<string, boolean>>({
    usgs: false,
    noaa: false,
    eonet: false,
    fires: false,
    radiation: false,
    aqi: false,
    flights: false,
    iss: false,
  });
  const [overlayStatuses, setOverlayStatuses] = useState<Record<string, 'idle' | 'loading' | 'live' | 'degraded'>>({});

  // Initialize popup container element once to prevent hydration mismatches and redundant DOM operations.
  const popupContainer = useMemo(() => {
    if (typeof document !== 'undefined') {
      return document.createElement('div');
    }
    return null;
  }, []);

  const [isGlobe, setIsGlobe] = useState(false);
  const appliedPreferencesForRef = useRef<string | null>(null);
  const isGlobeRef = useRef(isGlobe);
  const currentStyleRef = useRef(currentStyle);
  const mapReadyRef = useRef(mapReady);

  useEffect(() => {
    isGlobeRef.current = isGlobe;
  }, [isGlobe]);

  useEffect(() => {
    currentStyleRef.current = currentStyle;
    if (mapTilerLogoRef.current) {
      mapTilerLogoRef.current.hidden = !MAP_STYLES[currentStyle]?.showsMapTilerLogo;
    }
  }, [currentStyle]);

  useEffect(() => {
    if (!preferenceOwnerId) {
      appliedPreferencesForRef.current = null;
      return;
    }
    if (!preferenceOwnerId || !syncedPreferences || appliedPreferencesForRef.current === preferenceOwnerId) return;
    appliedPreferencesForRef.current = preferenceOwnerId;
    const allowedStyle = canUseMapStyle(userTier, syncedPreferences.mapStyle)
      ? syncedPreferences.mapStyle
      : (isDarkMode ? 'dark' : 'standard');
    const allowedOverlays = Object.fromEntries(
      Object.entries(syncedPreferences.overlays).map(([key, active]) => [key, active && canUseOverlay(userTier, key)]),
    );
    setCurrentStyle(allowedStyle);
    setOverlays((current) => ({ ...current, ...allowedOverlays }));
    setForceIndividualPins(hasFeature(userTier, 'individualPins') && syncedPreferences.forceIndividualPins);
    setMutedClusters(syncedPreferences.mutedClusters);
    setIsGlobe(hasFeature(userTier, 'globe') && syncedPreferences.globe);
  }, [isDarkMode, preferenceOwnerId, syncedPreferences, userTier]);

  useEffect(() => {
    mapReadyRef.current = mapReady;
  }, [mapReady]);


  const settingsPanelRef = useRef<HTMLDivElement>(null);

  const onBoundsChangeRef = useRef(onBoundsChange);
  const onSelectItemRef = useRef(onSelectItem);
  const forceIndividualPinsRef = useRef(forceIndividualPins);
  const overlaysRef = useRef(overlays);

  const boundsDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const contextRecoveryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const recoveryAttemptsRef = useRef<number[]>([]);

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
    overlaysRef.current = overlays;
  }, [overlays]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map?.getLayer("clusters-circle")) return;

    const paint = mutedClusters
      ? MUTED_CLUSTERS_CIRCLE_PAINT
      : CLUSTERS_CIRCLE_PAINT;
    if (!paint) return;
    for (const [property, value] of Object.entries(paint)) {
      map.setPaintProperty("clusters-circle", property, value);
    }
  }, [mapReady, mutedClusters]);

  // Decorative paint transitions are paused during camera interaction so they
  // never compete with MapLibre's pan/zoom render loop.
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const map = mapRef.current;
    const pulse = createHotStoryPulseController(map);

    if (!animatedEffects) {
      pulse.stop();
      return;
    }

    const start = () => {
      if (!document.hidden) pulse.start();
    };
    const stop = () => pulse.stop();
    const onVisibilityChange = () => document.hidden ? stop() : start();

    document.addEventListener("visibilitychange", onVisibilityChange);
    map.on("movestart", stop);
    map.on("moveend", start);
    start();
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      map.off("movestart", stop);
      map.off("moveend", start);
      pulse.dispose();
    };
  }, [mapReady, animatedEffects]);

  // Keep the two theme-following base styles aligned without replacing a
  // deliberately selected satellite/topographic/premium style.
  const prevIsDarkModeRef = useRef(isDarkMode);
  useEffect(() => {
    let frame: number | null = null;
    if (prevIsDarkModeRef.current !== isDarkMode) {
      prevIsDarkModeRef.current = isDarkMode;
      const storedStyle = syncedPreferences?.mapStyle;
      const followsTheme = storedStyle
        ? storedStyle === 'standard' || storedStyle === 'dark'
        : currentStyle === 'standard' || currentStyle === 'dark';
      if (!followsTheme) return;
      const nextStyle = isDarkMode ? 'dark' : 'standard';
      frame = requestAnimationFrame(() => {
        setCurrentStyle(nextStyle);
        onSyncedPreferencesChange?.({ mapStyle: nextStyle });
      });
    }
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [currentStyle, isDarkMode, onSyncedPreferencesChange, syncedPreferences?.mapStyle]);

  const selectedJitterId = useMemo(
    () => selectedJitterAnchor(items, selectedItemId),
    [items, selectedItemId],
  );

  // Pre-process items for the map: filter valid coords, apply jitter, and identify top stories.
  const geoItems = useMemo(() => {
    const valid = items.filter(
      (i) => i.latitude != null && i.longitude != null,
    );
    const jittered = applyClientJitter(valid, selectedJitterId);

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

    const topIds = new Set(sorted.slice(0, 3).map((i) => canonicalNewsId(i)));

    return jittered.map((item) => ({
      ...item,
      isTopHot: topIds.has(canonicalNewsId(item)),
    }));
  }, [items, sortMode, selectedJitterId]);

  const selectedItem = useMemo(() => {
    if (!selectedItemId) return null;
    return geoItems.find((i) => matchesNewsId(i, selectedItemId)) || null;
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

  const { getInitialViewState, handleResetOrientation, cancelCameraFlight } = useMapCamera({
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
  });

  const scheduleMapRecovery = useCallback((reason: string) => {
    const now = Date.now();
    recoveryAttemptsRef.current = recoveryAttemptsRef.current.filter(
      (timestamp) => now - timestamp < MAP_RECOVERY_WINDOW_MS,
    );

    if (recoveryAttemptsRef.current.length >= MAP_RECOVERY_LIMIT) {
      setMapError(
        "The map engine is having trouble recovering. You can keep using the news feed while the map is unavailable.",
      );
      devWarn(`Map recovery limit reached after ${reason}.`);
      return;
    }

    recoveryAttemptsRef.current.push(now);
    setIsChangingStyle(false);
    setMapError(null);
    setMapReady(false);
    setRetryCount((prev) => prev + 1);
  }, []);

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
        transformRequest: (url, resourceType) => {
          if (resourceType === 'Glyphs' && (url.includes('basemaps-assets/fonts/') || url.includes('tiles.openstreetmap.us/fonts/'))) {
            const match = url.match(/\/fonts\/([^/]+)\/([^/]+)$/);
            if (match) {
              const encodedFontstack = match[1];
              const range = match[2];
              const decodedFontstack = decodeURIComponent(encodedFontstack);
              
              let mappedFont = "Noto Sans Regular";
              if (decodedFontstack.toLowerCase().includes("italic")) {
                mappedFont = "Noto Sans Italic";
              } else if (decodedFontstack.toLowerCase().includes("bold")) {
                mappedFont = "Noto Sans Bold";
              } else if (decodedFontstack.toLowerCase().includes("medium")) {
                mappedFont = "Noto Sans Medium";
              }
              
              const newUrl = url.replace(
                `/fonts/${encodedFontstack}/${range}`,
                `/fonts/${encodeURIComponent(mappedFont)}/${range}`
              );
              return { url: newUrl };
            }
          }
          return { url };
        }
      });
    } catch (err) {
      console.error("Failed to initialize MapLibre:", err);
      setTimeout(() => scheduleMapRecovery("initialization failure"), 0);
      return;
    }

    map.on("webglcontextlost", (e) => {
      e.originalEvent.preventDefault();
      devWarn("WebGL context lost; waiting for browser restoration.");
      setMapReady(false);

      if (contextRecoveryTimeoutRef.current) {
        clearTimeout(contextRecoveryTimeoutRef.current);
      }
      contextRecoveryTimeoutRef.current = setTimeout(() => {
        scheduleMapRecovery("WebGL context loss");
      }, 3000);
    });

    map.on("webglcontextrestored", () => {
      devWarn("WebGL context restored.");
      if (contextRecoveryTimeoutRef.current) {
        clearTimeout(contextRecoveryTimeoutRef.current);
        contextRecoveryTimeoutRef.current = null;
      }

      setMapError(null);
      map.resize();

      if (map.isStyleLoaded()) {
        addSourcesAndLayers(map)
          .then(() => {
            setIsChangingStyle(false);
            setMapReady(true);
          })
          .catch(() => scheduleMapRecovery("post-restore layer rebuild"));
      }
    });

    const container = containerRef.current;
    const handleAttributionClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const anchor = target.closest("a");
      if (anchor && anchor.href && (anchor.closest(".maplibregl-ctrl-attrib") || anchor.closest(".maplibregl-ctrl-scale"))) {
        e.preventDefault();
        window.open(anchor.href, "_blank", "noopener,noreferrer");
      }
    };
    container?.addEventListener("click", handleAttributionClick);

    map.on("error", (e) => {
      const errorMsg =
        e.error?.message || (typeof e.error === "string" ? e.error : "");
      const sourceId = (e as unknown as { sourceId?: string }).sourceId;
      if (sourceId?.startsWith('overlay-')) {
        const key = sourceId.slice('overlay-'.length);
        setOverlayStatuses((current) => ({ ...current, [key]: 'degraded' }));
      }

      if (isRecoverableMapResourceError(errorMsg)) {
        devDebug("Non-critical map resource error suppressed:", errorMsg);
        return;
      }

      if (e.error && !mapReadyRef.current) {
        console.error("MapLibre error event:", e.error);
        scheduleMapRecovery("MapLibre error event");
      } else {
        devDebug("MapLibre runtime error suppressed:", e.error);
      }
    });

    map.on('sourcedata', (event) => {
      if (!event.isSourceLoaded || !event.sourceId?.startsWith('overlay-')) return;
      const key = event.sourceId.slice('overlay-'.length);
      setOverlayStatuses((current) => ({ ...current, [key]: 'live' }));
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
    const mapTilerLogo = document.createElement("a");
    mapTilerLogo.className = `maplibregl-ctrl ${styles.mapTilerLogoControl}`;
    mapTilerLogo.href = "https://www.maptiler.com";
    mapTilerLogo.target = "_blank";
    mapTilerLogo.rel = "noopener noreferrer";
    mapTilerLogo.title = "MapTiler";
    mapTilerLogo.setAttribute("aria-label", "MapTiler");
    mapTilerLogo.hidden = !MAP_STYLES[currentStyleRef.current]?.showsMapTilerLogo;

    const mapTilerLogoImage = document.createElement("img");
    mapTilerLogoImage.src = "https://api.maptiler.com/resources/logo.svg";
    mapTilerLogoImage.alt = "MapTiler";
    mapTilerLogo.appendChild(mapTilerLogoImage);

    const mapTilerLogoControl = {
      onAdd: () => {
        mapTilerLogoRef.current = mapTilerLogo;
        return mapTilerLogo;
      },
      onRemove: () => {
        mapTilerLogo.remove();
        if (mapTilerLogoRef.current === mapTilerLogo) {
          mapTilerLogoRef.current = null;
        }
      },
    };
    map.addControl(mapTilerLogoControl, "bottom-right");

    popupRef.current = new maplibregl.Popup({
      closeButton: true,
      closeOnClick: false,
      className: "news-popup-container",
      maxWidth: "500px",
      anchor: "bottom",
    });

    popupRef.current.on("close", () => {
      if (suppressPopupCloseRef.current) {
        suppressPopupCloseRef.current = false;
        return;
      }

      cancelCameraFlight();
      onSelectItemRef.current(null);
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
              onSelectItemRef.current(
                e.features[0].properties.canonicalId || e.features[0].properties.id,
              );
          });
          map.on("click", "unclustered-point-active", (e) => {
            if (e.features?.[0])
              onSelectItemRef.current(
                e.features[0].properties.canonicalId || e.features[0].properties.id,
              );
          });
          map.on("click", "selected-point-active", (e) => {
            if (e.features?.[0])
              onSelectItemRef.current(
                e.features[0].properties.canonicalId || e.features[0].properties.id,
              );
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
            "selected-point-active",
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
        setIsChangingStyle(false);
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
      if (contextRecoveryTimeoutRef.current) {
        clearTimeout(contextRecoveryTimeoutRef.current);
        contextRecoveryTimeoutRef.current = null;
      }
      resizeObserver.disconnect();
      container?.removeEventListener("click", handleAttributionClick);
      if (map) {
        try {
          map.remove();
        } catch (err) {
          devWarn("Suppressing map removal error:", err);
        }
      }
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retryCount]);

  const handleRetry = useCallback(() => {
    setIsChangingStyle(false);
    setMapError(null);
    setMapReady(false);
    setRetryCount((prev) => prev + 1);
  }, []);

  const hasCoordinates = initialCenter !== undefined && initialZoom !== undefined;

  // Reset map view to default when coordinates are cleared from URL (e.g. logo click)
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;

    if (!hasCoordinates) {
      const defaultView = getInitialViewState();
      const map = mapRef.current;
      const currentCenter = map.getCenter();
      const currentZoom = map.getZoom();

      const dist = Math.sqrt(
        Math.pow(currentCenter.lng - defaultView.center[0], 2) +
        Math.pow(currentCenter.lat - defaultView.center[1], 2)
      );
      const zoomDiff = Math.abs(currentZoom - defaultView.zoom);

      if (dist > 0.05 || zoomDiff > 0.2) {
        map.easeTo({
          center: defaultView.center,
          zoom: defaultView.zoom,
          pitch: 0,
          bearing: 0,
          duration: 1000,
          essential: true,
        });
      }
    }
  }, [hasCoordinates, mapReady, getInitialViewState]);

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

    const geojson = buildNewsFeatureCollection(geoItems);

    pendingGeoJsonRef.current = geojson;

    const source = mapRef.current.getSource(
      "news-events",
    ) as maplibregl.GeoJSONSource;
    if (source) source.setData(geojson);
  }, [geoItems, mapReady]);

  useEffect(() => {
    if (!mapReady || !mapRef.current) return;

    const source = mapRef.current.getSource(
      "selected-news-event",
    ) as maplibregl.GeoJSONSource | undefined;
    if (!source) return;

    const selectedGeoJson: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features:
        selectedItem && selectedItem.latitude != null && selectedItem.longitude != null
          ? [
              {
                type: "Feature",
                geometry: {
                  type: "Point",
                  coordinates: [selectedItem.longitude, selectedItem.latitude],
                },
                properties: {
                  id: selectedItem.id,
                  canonicalId: canonicalNewsId(selectedItem),
                  category: selectedItem.category,
                  title: selectedItem.title,
                  source: selectedItem.source,
                  storyCount: selectedItem.storyCount ?? 1,
                  sourcesCount: selectedItem.sourcesCount ?? 1,
                  sourceCount: canonicalEventCount(selectedItem),
                },
              },
            ]
          : [],
    };

    source.setData(selectedGeoJson);
  }, [selectedItem, mapReady]);

  useEffect(() => {
    const popup = popupRef.current;
    if (!popup?.isOpen()) return;
    if (selectedItemId && selectedItem) return;

    suppressPopupCloseRef.current = true;
    popup.remove();
  }, [selectedItemId, selectedItem]);

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
    let cancelled = false;

    const setVis = (layer: string, show: boolean) => {
      if (map.getLayer(layer)) {
        map.setLayoutProperty(layer, "visibility", show ? "visible" : "none");
      }
    };

    const overlayLayers: Array<[string, string]> = [
      ["usgs", "overlay-usgs-point"],
      ["noaa", "overlay-noaa-raster"],
      ["eonet", "overlay-eonet-point"],
      ["fires", "overlay-fires-point"],
      ["radiation", "overlay-radiation-raster"],
      ["aqi", "overlay-aqi-raster"],
      ["flights", "overlay-flights-point"],
      ["iss", "overlay-iss-point"],
    ];

    const missingActiveOverlay = overlayLayers.some(
      ([key, layer]) => overlays[key] && !map.getLayer(layer),
    );

    const syncOverlayVisibility = async () => {
      if (missingActiveOverlay) {
        await addSourcesAndLayers(map);
      }
      if (cancelled) return;

      for (const [key, layer] of overlayLayers) {
        setVis(layer, overlays[key]);
      }
    };

    syncOverlayVisibility();

    return () => {
      cancelled = true;
    };
  }, [overlays, mapReady, currentStyle, addSourcesAndLayers]);

  // Flight tracking polling logic
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    
    if (!overlays.flights) {
      const source = mapRef.current.getSource("overlay-flights") as maplibregl.GeoJSONSource;
      if (source) {
        source.setData({
          type: "FeatureCollection",
          features: []
        });
      }
      return;
    }

    const map = mapRef.current;
    
    const fetchFlights = async (signal: AbortSignal) => {
      try {
        const center = map.getCenter();
        const lat = center.lat.toFixed(4);
        const lng = center.lng.toFixed(4);
        
        // Fetch flights within 150 NM of current map center (proxied to bypass CORS)
        const res = await fetch(`/api/proxy/flights?lat=${lat}&lng=${lng}`, { signal });
        if (!res.ok) throw new Error("ADSB API error");
        
        const data = await res.json();
        const aircraftList = data.ac || data.aircraft;
        if (!aircraftList || !Array.isArray(aircraftList)) return;

        interface ADSBAircraft {
          lat: number | null;
          lon: number | null;
          hex: string;
          flight?: string;
          r?: string;
          track?: number;
          alt_baro?: number;
          alt_geom?: number;
          gs?: number;
        }

        const geojson: GeoJSON.FeatureCollection = {
          type: "FeatureCollection",
          features: (aircraftList as ADSBAircraft[])
            .filter((ac: ADSBAircraft) => ac.lat != null && ac.lon != null)
            .map((ac: ADSBAircraft) => ({
              type: "Feature",
              geometry: {
                type: "Point",
                coordinates: [ac.lon!, ac.lat!]
              },
              properties: {
                id: ac.hex,
                flight: ac.flight ? ac.flight.trim() : ac.r || "Plane",
                track: ac.track || 0,
                alt: ac.alt_baro || ac.alt_geom || 0,
                speed: ac.gs || 0
              }
            }))
        };

        const source = map.getSource("overlay-flights") as maplibregl.GeoJSONSource;
        if (source) {
          source.setData(geojson);
        }
        setOverlayStatuses((current) => ({ ...current, flights: 'live' }));
      } catch (err) {
        if (signal.aborted) return;
        setOverlayStatuses((current) => ({ ...current, flights: 'degraded' }));
        devWarn("Failed to fetch live flight data:", err);
      }
    };

    return startVisiblePolling({ poll: fetchFlights, intervalMs: 10000 });
  }, [overlays.flights, mapReady]);

  // Poll and update the real-time ISS location
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;

    if (!overlays.iss) {
      const source = mapRef.current.getSource("overlay-iss") as maplibregl.GeoJSONSource | undefined;
      if (source) {
        source.setData({
          type: "FeatureCollection",
          features: []
        });
      }
      return;
    }

    const map = mapRef.current;

    const fetchISS = async (signal: AbortSignal) => {
      try {
        const res = await fetch("/api/proxy/iss", { signal });
        if (!res.ok) throw new Error("ISS API error");
        const geojson = await res.json();
        
        const source = map.getSource("overlay-iss") as maplibregl.GeoJSONSource | undefined;
        if (source) {
          source.setData(geojson);
        }
        setOverlayStatuses((current) => ({ ...current, iss: 'live' }));
      } catch (err) {
        if (signal.aborted) return;
        setOverlayStatuses((current) => ({ ...current, iss: 'degraded' }));
        devWarn("Failed to fetch live ISS position:", err);
      }
    };

    return startVisiblePolling({ poll: fetchISS, intervalMs: 8000 });
  }, [overlays.iss, mapReady]);

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
      {!mapReady && !mapError && (
        <StateNotice
          placement="overlay"
          variant="loading"
          title={isChangingStyle ? "Updating map" : "Loading map"}
          message={isChangingStyle
            ? "Applying the selected map style and restoring your layers."
            : "Preparing the map and latest layers."}
        />
      )}
      {mapError && (
        <StateNotice
          placement="overlay"
          variant="error"
          title="Map unavailable"
          message={mapError}
          actionLabel="Retry"
          actionTitle="Retry loading the map"
          onAction={handleRetry}
        />
      )}

      {/* Upgrade CTA for non-paying users */}
      {!tierLoading && userTier === 'free' && (
        <UpgradeButton isSidebarOpen={isSidebarOpen} />
      )}

      {!mapError && (
        <>
          <MapSettings
            mapStyle={currentStyle}
            onStyleChange={(style) => {
              setIsChangingStyle(true);
              setCurrentStyle(style);
              onSyncedPreferencesChange?.({ mapStyle: style });
            }}
            forceIndividualPins={forceIndividualPins}
            onForceIndividualPinsToggle={() => {
              const next = !forceIndividualPins;
              setForceIndividualPins(next);
              onSyncedPreferencesChange?.({ forceIndividualPins: next });
            }}
            isOpen={settingsOpen}
            onToggleOpen={() => setSettingsOpen((o) => !o)}
            panelRef={settingsPanelRef as React.RefObject<HTMLDivElement>}
            animatedEffects={animatedEffects}
            onAnimatedEffectsChange={onAnimatedEffectsChange}
            mutedClusters={mutedClusters}
            onMutedClustersChange={(value) => {
              setMutedClusters(value);
              onSyncedPreferencesChange?.({ mutedClusters: value });
            }}
            userTier={userTier}
          />
          <MapActionTools
            overlays={overlays}
            overlayStatuses={overlayStatuses}
            onOverlayToggle={(overlay, active) => {
              const next = { ...overlays, [overlay]: active };
              setOverlays(next);
              setOverlayStatuses((current) => ({ ...current, [overlay]: active ? 'loading' : 'idle' }));
              onSyncedPreferencesChange?.({ overlays: next });
            }}
            isGlobe={isGlobe}
            onToggleGlobe={() => {
              const next = !isGlobe;
              setIsGlobe(next);
              onSyncedPreferencesChange?.({ globe: next });
            }}
            onResetOrientation={handleResetOrientation}
            drawToolsOpen={drawToolsOpen}
            onToggleDrawTools={() => setDrawToolsOpen((o) => !o)}
            bearing={mapBearing}
            disabled={disabled}
            userTier={userTier}
          />
          <MapDrawTools
            mapRef={mapRef}
            mapReady={mapReady}
            isOpen={drawToolsOpen}
            userTier={userTier}
            onClose={() => setDrawToolsOpen(false)}
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
        <MapPopup item={selectedItem} userTier={userTier} />,
        popupContainer
      )}
    </div>
  );
}
