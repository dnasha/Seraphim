/**
 * Map Layers Hook
 * Manages the registration of map sources, layers, and category icons.
 * Handles the logic for client-side clustering and the layering order of 
 * news items, pulses, and external data overlays.
 */

import { useCallback } from "react";
import maplibregl from "maplibre-gl";
import { generateCategoryIcon } from "./MapConstants";
import { CATEGORIES, CLUSTER_MAX_ZOOM } from "./utils";

interface UseMapLayersProps {
  forceIndividualPinsRef: React.MutableRefObject<boolean>;
  overlaysRef: React.MutableRefObject<Record<string, boolean>>;
  pendingGeoJsonRef: React.MutableRefObject<GeoJSON.FeatureCollection | null>;
}

export function useMapLayers({
  forceIndividualPinsRef,
  overlaysRef,
  pendingGeoJsonRef,
}: UseMapLayersProps) {
  const addSourcesAndLayers = useCallback(
    async (map: maplibregl.Map) => {
      // Idempotent registration of category-specific SVG icons.
      // Generates both 'active' and 'inactive' variants for each news category.
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
              // Silently handle race conditions if the map style reloads during icon registration.
            }
          }
        }
      }

      // Re-configure the primary GeoJSON source.
      // We explicitly remove existing layers and sources to ensure that clustering settings 
      // are correctly applied during runtime toggles.
      if (map.getSource("news-events")) {
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
        attribution: '<a href="/help">© Seraphim 2026</a>',
        cluster: !forceIndividualPinsRef.current,
        clusterMaxZoom: CLUSTER_MAX_ZOOM,
        clusterRadius: 35,
        clusterProperties: {
          // Accumulate metadata during clustering for use in data-driven styling.
          summedStoryCount: ["+", ["coalesce", ["get", "storyCount"], 1]],
          hasTopHot: ["max", ["case", ["==", ["get", "isTopHot"], true], 1, 0]],
        },
      });

      // Define logic for when a point should be treated as a cluster vs an individual pin.
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

      // Layering Order:
      // 1. External Overlays (USGS, NOAA, NASA)
      // 2. Clusters (Circles)
      // 3. Hot Story Pulses (Animated rings)
      // 4. Cluster Labels (Numeric counts)
      // 5. Unclustered Pins (Individual icons)

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

      // Disable transitions for the pulse layer to allow the JS animation loop to drive radius/opacity frame-by-frame.
      map.setPaintProperty("hot-story-pulse", "circle-radius-transition", {
        duration: 0,
      });
      map.setPaintProperty("hot-story-pulse", "circle-opacity-transition", {
        duration: 0,
      });
      map.setPaintProperty("hot-story-pulse", "circle-blur-transition", {
        duration: 0,
      });

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
            "text-font": ["Noto Sans Bold"],
            "text-allow-overlap": false,
            "text-ignore-placement": false,
            "text-padding": 6,
          },
          paint: {
            "text-color": "#ffffff",
          },
        });
      }

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

      // External Live Overlays: Added beneath news clusters to prevent obstruction.
      
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
    },
    [forceIndividualPinsRef, overlaysRef, pendingGeoJsonRef]
  );

  return { addSourcesAndLayers };
}
