/*
Main Map component for the Seraphim OSINT aggregator.
Renders an interactive map using MapLibre GL JS, handles news item clustering,
popups, overlays, and camera animations.
*/

"use client";

import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { NewsItem } from "@/lib/types";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { BBox } from "@/lib/geo";

import {
  getMapLibreStyle,
  generateCategoryIcon,
  formatTimeAgo,
  getSourceBadgeColor,
  getCategoryColor,
  getCredibilityStyle,
} from "./MapConstants";
import { canonicalEventCount, latestReportTimestamp } from "@/lib/ranking";
import MapSettings from "./MapSettings";
import MapActionTools from "./MapActionTools";
import MapError from "./MapError";
import MapLoading from "./MapLoading";
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
}

const CATEGORIES = [
  "general",
  "world",
  "crisis",
  "nation",
  "business",
  "technology",
  "science",
  "health",
];

/**
 * Deterministic client-side jitter to prevent unclustered pins from stacking.
 * Groups items by coordinate, sorts them by ID, and applies a golden-angle spiral.
 */
function applyClientJitter(items: NewsItem[]): NewsItem[] {
  const coordGroups = new Map<string, NewsItem[]>();

  // Group items by coordinate (rounded to avoid floating point precision issues)
  for (const item of items) {
    if (item.latitude == null || item.longitude == null) continue;
    // Don't jitter MapLibre-generated clusters (handled by engine)
    if (item.storyCount && item.storyCount > 1000) continue; // Safety guard

    const key = `${item.latitude.toFixed(5)},${item.longitude.toFixed(5)}`;
    if (!coordGroups.has(key)) coordGroups.set(key, []);
    coordGroups.get(key)!.push(item);
  }

  const jitteredMap = new Map<string, { lat: number; lng: number }>();

  for (const group of coordGroups.values()) {
    if (group.length <= 1) continue;

    // Sort by canonical story id for deterministic jitter across refresh/zoom transitions
    group.sort((a, b) =>
      (a.originalId || a.id).localeCompare(b.originalId || b.id),
    );

    const baseLat = group[0].latitude!;
    const baseLng = group[0].longitude!;
    const latRad = (baseLat * Math.PI) / 180;
    const lngScale = Math.max(Math.cos(latRad), 0.2); // avoid huge jumps near poles
    const goldenAngle = (137.5 * Math.PI) / 180;
    const kmToLatDeg = (km: number) => km / 111.32;
    const baseRadius = kmToLatDeg(3.0); // ~3km base jitter
    const growth = kmToLatDeg(1.2); // ~1.2km additional ring growth

    for (let i = 0; i < group.length; i++) {
      const item = group[i];
      const angle = i * goldenAngle;
      const radius = baseRadius + i * growth;
      const latOffset = radius * Math.cos(angle);
      const lngOffset = (radius * Math.sin(angle)) / lngScale;

      const jitteredLat = Math.max(-85, Math.min(85, baseLat + latOffset));
      const jitteredLngRaw = baseLng + lngOffset;
      const jitteredLng = ((((jitteredLngRaw + 180) % 360) + 360) % 360) - 180;

      jitteredMap.set(item.id, {
        lat: jitteredLat,
        lng: jitteredLng,
      });
    }
  }

  return items.map((item) => {
    const jittered = jitteredMap.get(item.id);
    if (jittered) {
      return { ...item, latitude: jittered.lat, longitude: jittered.lng };
    }
    return item;
  });
}

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
}: NewsMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const pulseAnimationFrameRef = useRef<number | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const eventsWiredRef = useRef(false);
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [forceIndividualPins, setForceIndividualPins] = useState(false);
  const [currentStyle, setCurrentStyle] = useState<string>(
    isDarkMode ? "dark" : "standard",
  );
  const [overlays, setOverlays] = useState<Record<string, boolean>>({
    usgs: false,
    noaa: false,
    eonet: false,
  });

  const settingsPanelRef = useRef<HTMLDivElement>(null);

  const onBoundsChangeRef = useRef(onBoundsChange);
  const onSelectItemRef = useRef(onSelectItem);
  const forceIndividualPinsRef = useRef(forceIndividualPins);
  const animatedEffectsRef = useRef(animatedEffects);
  const overlaysRef = useRef(overlays);

  const boundsDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  // Track the last selection to prevent redundant camera animations during re-renders.
  const lastFlownSelectionRef = useRef<string | null>(null);
  const lastFlownVersionRef = useRef(0);

  // Cache for GeoJSON data to restore it after map style reloads.
  const pendingGeoJsonRef = useRef<GeoJSON.FeatureCollection | null>(null);

  // Guard to prevent deselecting items when the popup is programmatically removed during flyTo.
  const isFlyingRef = useRef(false);

  // Track active resizing to suppress data updates/emissions
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

  // Animation loop for pulsing global top-3 hot stories
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

      // Tighter growth: starts at 20 and expands to 55 (at full scale)
      const radius = 20 + t * 35;
      // Stronger opacity with a linear-ish decay for better visibility
      const opacity = Math.max(0, 0.6 * (1 - t));
      // Perfectly sharp edges
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

  // Sync style with dark mode changes
  const [prevIsDarkMode, setPrevIsDarkMode] = useState(isDarkMode);
  if (prevIsDarkMode !== isDarkMode) {
    setPrevIsDarkMode(isDarkMode);
    setCurrentStyle(isDarkMode ? "dark" : "standard");
  }

  const geoItems = useMemo(() => {
    const valid = items.filter(
      (i) => i.latitude != null && i.longitude != null,
    );
    const jittered = applyClientJitter(valid);

    // Identify top 3 items based on the current sort mode (viewport-aware)
    const sorted = [...jittered].sort((a, b) => {
      if (sortMode === "hot") {
        const scoreA = a.impactScore || 0;
        const scoreB = b.impactScore || 0;
        if (scoreB !== scoreA) return scoreB - scoreA;
        
        const countA = canonicalEventCount(a);
        const countB = canonicalEventCount(b);
        if (countB !== countA) return countB - countA;
      }

      // Fallback for Hot mode tiebreak OR primary for New mode
      return latestReportTimestamp(b) - latestReportTimestamp(a);
    });

    const topIds = new Set(sorted.slice(0, 3).map((i) => i.id));

    return jittered.map((item) => ({
      ...item,
      // Pulses ONLY follow the current viewport's top 3 to ensure UI consistency
      isTopHot: topIds.has(item.id),
    }));
  }, [items, sortMode]);

  // Emits the current map bounds with a debounce to avoid excessive API calls.
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

  // Registers icons, sources, and layers. Called on map initialization and style changes.
  const addSourcesAndLayers = useCallback(async (map: maplibregl.Map) => {
    // Register category icons (idempotent and async-safe)
    const iconsToLoad = CATEGORIES.flatMap((cat) => [
      { name: `${cat}_inactive`, active: false, cat },
      { name: `${cat}_active`, active: true, cat },
    ]).filter((item) => !map.hasImage(item.name));

    if (iconsToLoad.length > 0) {
      const loaded = await Promise.all(
        iconsToLoad.map(async (item) => ({
          name: item.name,
          img: await generateCategoryIcon(item.cat, item.active),
        })),
      );

      for (const { name, img } of loaded) {
        if (!map.hasImage(name)) {
          try {
            map.addImage(name, img);
          } catch {
            /* ignore race-condition errors if style reloaded during load */
          }
        }
      }
    }

    // Configure GeoJSON source with client-side clustering.
    // Explicitly remove source and layers if they exist to force a clean reload with new clustering settings
    if (map.getSource("news-events")) {
      // Layers must be removed before the source
      const layers = [
        "clusters-count",
        "clusters-circle",
        "hot-story-pulse",
        "unclustered-point-active",
        "unclustered-point",
      ];
      for (const l of layers) {
        if (map.getLayer(l)) map.removeLayer(l);
      }
      map.removeSource("news-events");
    }

    map.addSource("news-events", {
      type: "geojson",
      data: pendingGeoJsonRef.current || {
        type: "FeatureCollection",
        features: [],
      },
      cluster: !forceIndividualPinsRef.current,
      clusterMaxZoom: 4,
      clusterRadius: 35,
      clusterProperties: {
        summedStoryCount: ["+", ["coalesce", ["get", "storyCount"], 1]],
        hasTopHot: ["max", ["case", ["==", ["get", "isTopHot"], true], 1, 0]],
      },
    });

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
              ["<", ["zoom"], 5],
            ],
          ];

    // Circle layer for clustered news items
    if (!map.getLayer("clusters-circle")) {
      map.addLayer({
        id: "clusters-circle",
        type: "circle",
        source: "news-events",
        filter: clusterCheck,
        layout: {
          "circle-sort-key": [
            "coalesce",
            ["get", "summedStoryCount"],
            ["get", "storyCount"],
            0,
          ],
        },
        paint: {
          "circle-color": [
            "step",
            ["coalesce", ["get", "summedStoryCount"], ["get", "storyCount"], 0],
            "#fca5a5",
            10,
            "#f87171",
            25,
            "#ef4444",
            50,
            "#dc2626",
            100,
            "#b91c1c",
            250,
            "#991b1b",
            500,
            "#7f1d1d",
          ],
          "circle-radius": [
            "interpolate",
            ["linear"],
            ["coalesce", ["get", "summedStoryCount"], ["get", "storyCount"], 0],
            2,
            14,
            10,
            18,
            50,
            22,
            100,
            26,
            250,
            28,
            500,
            32,
            1000,
            36,
          ],
          "circle-opacity": [
            "interpolate",
            ["linear"],
            ["coalesce", ["get", "summedStoryCount"], ["get", "storyCount"], 0],
            2,
            0.8,
            20,
            0.85,
            100,
            0.9,
            500,
            0.93,
            1000,
            0.95,
          ],
          "circle-stroke-width": 0,
          "circle-stroke-color": "#ffffff",
        },
      });
    }

    // Pulse animation layer for global top-3 hot stories.
    // We add this AFTER clusters-circle to ensure it pulses OVER the red cluster background
    // but BEFORE the count labels so it doesn't obscure text.
    if (map.getLayer("hot-story-pulse")) map.removeLayer("hot-story-pulse");

    map.addLayer({
      id: "hot-story-pulse",
      type: "circle",
      source: "news-events",
      filter: [
        "any",
        ["==", ["get", "hasTopHot"], 1],
        ["==", ["get", "isTopHot"], true],
      ],
      paint: {
        "circle-radius": 0,
        "circle-color": [
          "case",
          ["has", "point_count"],
          "#ef4444",
          [
            "match",
            ["get", "category"],
            "world",
            "#dc2626",
            "crisis",
            "#b91c1c",
            "nation",
            "#2563eb",
            "business",
            "#d97706",
            "technology",
            "#0891b2",
            "science",
            "#059669",
            "health",
            "#7c3aed",
            "#3b82f6",
          ],
        ],
        "circle-opacity": 0,
        "circle-blur": 0,
        "circle-stroke-width": 0,
      },
    });

    map.setPaintProperty("hot-story-pulse", "circle-radius-transition", {
      duration: 0,
    });
    map.setPaintProperty("hot-story-pulse", "circle-opacity-transition", {
      duration: 0,
    });
    map.setPaintProperty("hot-story-pulse", "circle-blur-transition", {
      duration: 0,
    });

    // Numeric labels for news clusters.
    if (!map.getLayer("clusters-count")) {
      map.addLayer({
        id: "clusters-count",
        type: "symbol",
        source: "news-events",
        filter: clusterCheck,
        layout: {
          "symbol-sort-key": [
            "*",
            -1,
            ["coalesce", ["get", "summedStoryCount"], ["get", "storyCount"], 0],
          ],
          "text-field": [
            "to-string",
            ["coalesce", ["get", "summedStoryCount"], ["get", "storyCount"]],
          ],
          "text-size": 12,
          "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
          "text-allow-overlap": false,
          "text-ignore-placement": false,
          "text-padding": 6,
        },
        paint: {
          "text-color": "#ffffff",
        },
      });
    }

    // Layer for inactive individual news pins.
    if (!map.getLayer("unclustered-point")) {
      map.addLayer({
        id: "unclustered-point",
        type: "symbol",
        source: "news-events",
        filter: ["all", ["!", clusterCheck], ["!=", ["get", "id"], ""]],
        layout: {
          "icon-image": [
            "concat",
            ["coalesce", ["get", "category"], "general"],
            "_inactive",
          ],
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
        },
        paint: {
          "icon-opacity": ["interpolate", ["linear"], ["zoom"], 4, 0.4, 8, 1.0],
        },
      });
    }

    // Layer for the currently selected news pin.
    if (!map.getLayer("unclustered-point-active")) {
      map.addLayer({
        id: "unclustered-point-active",
        type: "symbol",
        source: "news-events",
        filter: ["all", ["!", clusterCheck], ["==", ["get", "id"], ""]],
        layout: {
          "icon-image": [
            "concat",
            ["coalesce", ["get", "category"], "general"],
            "_active",
          ],
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
        },
        paint: {
          "icon-opacity": ["interpolate", ["linear"], ["zoom"], 4, 0.6, 8, 1.0],
        },
      });
    }

    // USGS Earthquake live overlay.
    if (!map.getSource("overlay-usgs")) {
      map.addSource("overlay-usgs", {
        type: "geojson",
        data: "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson",
      });
    }
    if (!map.getLayer("overlay-usgs-point")) {
      map.addLayer(
        {
          id: "overlay-usgs-point",
          type: "circle",
          source: "overlay-usgs",
          layout: {
            visibility: overlaysRef.current["usgs"] ? "visible" : "none",
          },
          paint: {
            "circle-radius": [
              "interpolate",
              ["linear"],
              ["get", "mag"],
              1,
              4,
              5,
              12,
              8,
              24,
            ],
            "circle-color": "#f59e0b",
            "circle-opacity": 0.6,
            "circle-stroke-width": 1,
            "circle-stroke-color": "#ffffff",
          },
        },
        "clusters-circle",
      );
    }

    // NOAA Weather Radar live overlay.
    if (!map.getSource("overlay-noaa")) {
      map.addSource("overlay-noaa", {
        type: "raster",
        tiles: [
          "https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/nexrad-n0q-900913/{z}/{x}/{y}.png",
          "https://mesonet1.agron.iastate.edu/cache/tile.py/1.0.0/nexrad-n0q-900913/{z}/{x}/{y}.png",
          "https://mesonet2.agron.iastate.edu/cache/tile.py/1.0.0/nexrad-n0q-900913/{z}/{x}/{y}.png",
          "https://mesonet3.agron.iastate.edu/cache/tile.py/1.0.0/nexrad-n0q-900913/{z}/{x}/{y}.png",
        ],
        tileSize: 256,
      });
    }
    if (!map.getLayer("overlay-noaa-raster")) {
      map.addLayer(
        {
          id: "overlay-noaa-raster",
          type: "raster",
          source: "overlay-noaa",
          layout: {
            visibility: overlaysRef.current["noaa"] ? "visible" : "none",
          },
          paint: { "raster-opacity": 0.6 },
        },
        "clusters-circle",
      );
    }

    // NASA EONET (Disasters) live overlay.
    if (!map.getSource("overlay-eonet")) {
      map.addSource("overlay-eonet", {
        type: "geojson",
        data: "https://eonet.gsfc.nasa.gov/api/v3/events/geojson?status=open&days=30&category=wildfires,volcanoes,severeStorms,floods",
      });
    }
    if (!map.getLayer("overlay-eonet-point")) {
      map.addLayer(
        {
          id: "overlay-eonet-point",
          type: "circle",
          source: "overlay-eonet",
          layout: {
            visibility: overlaysRef.current["eonet"] ? "visible" : "none",
          },
          paint: {
            "circle-color": "#ef4444",
            "circle-radius": 5,
            "circle-stroke-width": 1,
            "circle-stroke-color": "#ffffff",
          },
        },
        "clusters-circle",
      );
    }
  }, []);

  // Effect to initialize the map and wire up event listeners.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    let map: maplibregl.Map;

    try {
      const view = getInitialViewState();
      const isNum = (v: number | undefined | null): v is number =>
        typeof v === "number" && Number.isFinite(v);

      // Airtight fallback chain for center and zoom
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

      map = new maplibregl.Map({
        container: containerRef.current as HTMLElement,
        style: getMapLibreStyle(currentStyle),
        center: finalCenter,
        zoom: finalZoom,
        minZoom: 0.5,
        maxZoom: 18,
        attributionControl: false,
        trackResize: false,
        // @ts-expect-error - Supported by MapLibre but may be missing from types
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
      // Only set error if it's a critical map-loading error, not just a missing icon/tile
      // Ignore 503/404 errors from optional third-party overlays (NASA, USGS, NOAA)
      const errorMsg =
        e.error?.message || (typeof e.error === "string" ? e.error : "");
      const isOverlayError =
        errorMsg.includes("eonet.gsfc.nasa.gov") ||
        errorMsg.includes("earthquake.usgs.gov") ||
        errorMsg.includes("mesonet.agron.iastate.edu");

      if (e.error && !mapReady && !isOverlayError) {
        console.error("MapLibre error event:", e.error);
        setMapError(
          "Failed to load map resources. Please check your connection.",
        );
      } else if (isOverlayError) {
        console.warn("Non-critical overlay error suppressed:", errorMsg);
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
      maxWidth: "400px",
      anchor: "bottom",
    });

    popupRef.current.on("close", () => {
      // Avoid deselection if the popup was removed programmatically during an animation.
      if (!isFlyingRef.current) {
        onSelectItemRef.current(null);
      }
    });

    // Handles layer re-initialization after the map style is loaded.
    map.on("style.load", () => {
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
              map.easeTo({
                center:
                  features[0].geometry.type === "Point"
                    ? (features[0].geometry.coordinates as [number, number])
                    : undefined,
                zoom,
              });
            } else {
              // Zoom in if it's a server-side cluster.
              map.easeTo({
                center:
                  features[0].geometry.type === "Point"
                    ? (features[0].geometry.coordinates as [number, number])
                    : undefined,
                zoom: map.getZoom() + 2,
              });
            }
          });

          // Cursor feedback for interactive layers.
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

          map.on("moveend", () => {
            // Don't emit bounds if we're in the middle of a container resize
            if (!isResizingRef.current) {
              emitBounds(map);
            }
          });
        }
        setMapReady(true);
      });
    });

    mapRef.current = map;

    // Use ResizeObserver for synchronous layout synchronization
    const resizeObserver = new ResizeObserver(() => {
      isResizingRef.current = true;
      if (resizeEndTimeoutRef.current)
        clearTimeout(resizeEndTimeoutRef.current);
      resizeEndTimeoutRef.current = setTimeout(() => {
        isResizingRef.current = false;
      }, 150);

      // Calling resize synchronously prevents the 1-frame lag between DOM and Canvas
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
    // Incrementing retryCount triggers the main initialization effect to re-run.
    // The previous map instance will be cleaned up by the effect's return function.
    setRetryCount((prev) => prev + 1);
  }, []);

  // Force initial view injection after map readiness to overcome MapLibre early clamping/snapping.
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

  // Sync bounds when individual pins are toggled.
  useEffect(() => {
    if (mapReady && mapRef.current) emitBounds(mapRef.current);
  }, [forceIndividualPins, mapReady, emitBounds]);

  // Handles map style and clustering toggle updates.
  useEffect(() => {
    if (!mapRef.current) return;
    setMapReady(false);
    mapRef.current.setStyle(getMapLibreStyle(currentStyle), { diff: false });
  }, [currentStyle, forceIndividualPins]);

  // Updates the GeoJSON source when news items change.
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

  const latestGeoItemsRef = useRef(geoItems);
  useEffect(() => {
    latestGeoItemsRef.current = geoItems;
  }, [geoItems]);

  const generatePopupHtml = useCallback((item: NewsItem) => {
    const pinColor = getCategoryColor(item.category);
    const credStyle = getCredibilityStyle(item.credibilityTier);
    const sourceCount = canonicalEventCount(item);

    const latestSource = item.sources?.length
      ? [...item.sources].sort(
          (a, b) =>
            new Date(b.discoveredAt).getTime() -
            new Date(a.discoveredAt).getTime(),
        )[0]
      : null;
    const displayDate = latestSource
      ? latestSource.discoveredAt
      : (item.latestActivityAt || item.publishedAt);

    const categoryLabel = item.category
      ? `<span class="news-popup-category" style="background:${pinColor}">${item.category}</span>`
      : "";

    const credBadgeHtml = `<span class="news-popup-credibility" style="background:${credStyle.bg};color:${credStyle.color}" title="${credStyle.label} source"><svg viewBox="0 0 24 24" width="10" height="10" fill="currentColor"><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-6.45 9-6.45 9-12V5l-9-4zm-2 16l-4-4 1.41-1.41L10 14.17l6.59-6.59L18 9l-8 8z"/></svg></span>`;

    const sourceCountHtml =
      sourceCount > 1
        ? `<span class="news-popup-source-count" title="${sourceCount} sources reporting on this"><svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><path d="M12.43,4.1a1,1,0,0,0-1,.12L6.65,8H3A1,1,0,0,0,2,9v6a1,1,0,0,0,1,1H6.65l4.73,3.78A1,1,0,0,0,12,20a.91.91,0,0,0,.43-.1A1,1,0,0,0,13,19V5A1,1,0,0,0,12.43,4.1ZM11,16.92l-3.38-2.7A1,1,0,0,0,7,14H4V10H7a1,1,0,0,0,.62-.22L11,7.08ZM19.66,6.34a1,1,0,0,0-1.42,1.42,6,6,0,0,1-.38,8.84,1,1,0,0,0,.64,1.76,1,1,0,0,0,.64-.23,8,8,0,0,0,.52-11.79ZM16.83,9.17a1,1,0,1,0-1.42,1.42A2,2,0,0,1,16,12a2,2,0,0,1-.71,1.53,1,1,0,0,0-.13,1.41,1,1,0,0,0,1.41.12A4,4,0,0,0,18,12,4.06,4.06,0,0,0,16.83,9.17Z"/></svg>${sourceCount}</span>`
        : "";

    const descriptionHtml =
      item.description != null
        ? item.description
          ? `<p class="news-popup-summary" data-event-id="${item.originalId || item.id}">${item.description}</p>`
          : ""
        : `<div class="news-popup-summary news-popup-summary--loading" data-event-id="${item.originalId || item.id}">
                <div class="popup-skeleton-line"></div>
                <div class="popup-skeleton-line" style="width:90%"></div>
                <div class="popup-skeleton-line" style="width:75%"></div>
              </div>`;

    /* Build source list HTML for multi-source stories */
    let sourcesListHtml = "";
    if (sourceCount > 1 && item.sources) {
      const sorted = [...item.sources].sort(
        (a, b) =>
          new Date(b.discoveredAt).getTime() -
          new Date(a.discoveredAt).getTime(),
      );
      const sourceEntries = sorted
        .map((src) => {
          const srcColor = getSourceBadgeColor(src.name);
          const srcTime = formatTimeAgo(src.discoveredAt);
          return `<div class="news-popup-source-entry">
            <span class="news-popup-source-name" style="background:${srcColor};color:#fff">${src.name}</span>
            <a class="news-popup-source-link" href="${src.url}" target="_blank" rel="noopener noreferrer">${new URL(src.url).hostname}</a>
            ${srcTime ? `<span class="news-popup-source-time">${srcTime}</span>` : ""}
          </div>`;
        })
        .join("");
      sourcesListHtml = `<div class="news-popup-sources-section">
        <div class="news-popup-sources-header">Sources & Timeline</div>
        <div class="news-popup-sources-list">${sourceEntries}</div>
      </div>`;
    }

    const singleLinkHtml =
      sourceCount <= 1
        ? `<a class="news-popup-link" href="${item.url}" target="_blank" rel="noopener noreferrer">View source \u2192</a>`
        : "";

    return `
            <div class="news-popup">
                <div class="news-popup-header">
                    <h3 class="news-popup-title">${item.title}</h3>
                    <div class="news-popup-meta">
                        <span class="news-popup-source" style="background:${getSourceBadgeColor(item.source)};color:#fff">${item.source}</span>
                        ${credBadgeHtml}
                        ${categoryLabel}
                        ${sourceCountHtml}
                        <span class="news-popup-time">${formatTimeAgo(displayDate)}</span>
                        ${
                          item.locationName
                            ? `
                            <span class="news-popup-meta-sep">\u2022</span>
                            <span class="news-popup-location">
                                <svg class="location-icon-svg" viewBox="0 0 24 24" width="12" height="12" fill="currentColor">
                                    <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
                                </svg>
                                ${item.locationName}
                            </span>
                        `
                            : ""
                        }
                    </div>
                </div>
                <div class="news-popup-content">
                    ${
                      item.imageUrl
                        ? `
                        <div class="news-popup-img-container">
                            <img class="news-popup-img" src="${item.imageUrl}" alt="" referrerpolicy="no-referrer" onerror="this.style.display='none'" />
                        </div>
                    `
                        : ""
                    }
                    ${descriptionHtml}
                    ${singleLinkHtml}
                </div>
                ${sourcesListHtml}
            </div>
        `;
  }, []);

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
                ["<", ["zoom"], 5],
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
          popupRef.current.remove();

          map.once("moveend", () => {
            if (popupRef.current) {
              const latestItem =
                latestGeoItemsRef.current.find(
                  (i) =>
                    i.id === selectedItemId || i.originalId === selectedItemId,
                ) || item;
              popupRef.current
                .setLngLat([latestItem.longitude!, latestItem.latitude!])
                .setHTML(generatePopupHtml(latestItem))
                .addTo(map);
            }
            isFlyingRef.current = false;
          });

          map.flyTo({
            center: [item.longitude!, item.latitude!],
            zoom: targetZoom,
            duration: 800,
            padding: { top: 250, bottom: 0, left: 0, right: 0 },
          });
        }
      }
    } else {
      if (!isFlyingRef.current) {
        popupRef.current?.remove();
      }
      lastFlownSelectionRef.current = null;
      lastFlownVersionRef.current = 0;
    }
  }, [selectedItemId, selectionVersion, geoItems, mapReady, generatePopupHtml]);

  // Live-updates popup descriptions when they finish loading.
  useEffect(() => {
    if (!mapReady || !popupRef.current || !popupRef.current.isOpen()) return;
    const el = popupRef.current.getElement();
    if (!el) return;

    geoItems.forEach((item) => {
      const popupContainer = el.querySelector<HTMLElement>(".news-popup");
      if (!popupContainer) return;

      const skeleton =
        popupContainer.querySelector<HTMLElement>(
          `div[data-event-id="${item.id}"].news-popup-summary--loading`,
        ) ||
        (item.originalId
          ? popupContainer.querySelector<HTMLElement>(
              `div[data-event-id="${item.originalId}"].news-popup-summary--loading`,
            )
          : null);

      if (skeleton && item.description !== undefined) {
        // Update description
        skeleton.outerHTML = item.description
          ? `<p class="news-popup-summary" data-event-id="${item.originalId || item.id}">${item.description}</p>`
          : "";

        // Also check if we need to update the sources list now that we have data
        const sourceCount = canonicalEventCount(item);
        if (
          sourceCount > 1 &&
          item.sources &&
          !popupContainer.querySelector(".news-popup-sources-section")
        ) {
          const sorted = [...item.sources].sort(
            (a, b) =>
              new Date(b.discoveredAt).getTime() -
              new Date(a.discoveredAt).getTime(),
          );
          const sourceEntries = sorted
            .map((src) => {
              const srcColor = getSourceBadgeColor(src.name);
              const srcTime = formatTimeAgo(src.discoveredAt);
              return `<div class="news-popup-source-entry">
                <span class="news-popup-source-name" style="background:${srcColor};color:#fff">${src.name}</span>
                <a class="news-popup-source-link" href="${src.url}" target="_blank" rel="noopener noreferrer">${new URL(src.url).hostname}</a>
                ${srcTime ? `<span class="news-popup-source-time">${srcTime}</span>` : ""}
              </div>`;
            })
            .join("");

          const sourcesSection = document.createElement("div");
          sourcesSection.className = "news-popup-sources-section";
          sourcesSection.innerHTML = `
            <div class="news-popup-sources-header">Sources & Timeline</div>
            <div class="news-popup-sources-list">${sourceEntries}</div>
          `;
          popupContainer.appendChild(sourcesSection);
        }
      }
    });
  }, [geoItems, mapReady]);

  // Handles closing the settings panel when clicking outside.
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

  // Toggles visibility of active live overlays.
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

  return (
    <div className={styles.mapWrapper}>
      {!mapReady && !mapError && <MapLoading />}
      {mapError && <MapError onRetry={handleRetry} error={mapError} />}

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
          />
          <MapActionTools
            overlays={overlays}
            onOverlayToggle={(overlay, active) =>
              setOverlays((prev) => ({ ...prev, [overlay]: active }))
            }
          />
        </>
      )}
      <div
        ref={containerRef}
        id="news-map"
        className={styles.newsMapContainer}
        style={{ backfaceVisibility: "hidden", transform: "translateZ(0)" }}
      />
    </div>
  );
}
