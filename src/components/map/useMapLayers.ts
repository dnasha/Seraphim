/**
 * Map Layers Hook
 * Manages the registration of map sources, layers, and category icons.
 * Handles the logic for client-side clustering and the layering order of 
 * news items, pulses, and external data overlays.
 */

import { useCallback } from "react";
import maplibregl from "maplibre-gl";
import { CLUSTER_MAX_ZOOM } from "./utils";
import { loadMapIcons } from "./layers/mapIcons";
import {
  CLUSTERS_CIRCLE_PAINT,
  HOT_STORY_PULSE_PAINT,
  CLUSTERS_COUNT_LAYOUT,
  CLUSTERS_COUNT_PAINT,
  UNCLUSTERED_POINT_LAYOUT,
  UNCLUSTERED_POINT_PAINT,
  UNCLUSTERED_POINT_ACTIVE_LAYOUT,
  UNCLUSTERED_POINT_ACTIVE_PAINT,
  SELECTED_POINT_ACTIVE_LAYOUT,
  SELECTED_POINT_ACTIVE_PAINT,
  USGS_PAINT,
  EONET_PAINT,
  FIRES_PAINT,
  FLIGHTS_LAYOUT,
  FLIGHTS_PAINT,
  ISS_LAYOUT,
  ISS_PAINT,
} from "./layers/mapLayerStyles";

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
      // Load all news categories and other custom SVGs/images
      await loadMapIcons(map);

      const existingNewsSource = map.getSource("news-events") as maplibregl.GeoJSONSource | undefined;
      if (existingNewsSource) {
        existingNewsSource.setData(pendingGeoJsonRef.current || {
          type: "FeatureCollection",
          features: [],
        });
      } else {
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
      }

      if (!map.getSource("selected-news-event")) {
        map.addSource("selected-news-event", {
          type: "geojson",
          data: {
            type: "FeatureCollection",
            features: [],
          },
        });
      }

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
      // 1. External Overlays (USGS, NOAA, NASA, Safecast, WAQI, Flights)
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
          paint: CLUSTERS_CIRCLE_PAINT,
        });
      }

      if (!map.getLayer("hot-story-pulse")) {
        map.addLayer({
          id: "hot-story-pulse",
          type: "circle",
          source: "news-events",
          filter: [
            "any",
            ["==", ["get", "hasTopHot"], 1],
            ["==", ["get", "isTopHot"], true],
          ],
          paint: HOT_STORY_PULSE_PAINT,
        });
      }

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
        const sortKey: maplibregl.ExpressionSpecification = [
          "*",
          -1,
          ["coalesce", ["get", "summedStoryCount"], ["get", "storyCount"], 0],
        ];
        map.addLayer({
          id: "clusters-count",
          type: "symbol",
          source: "news-events",
          filter: clusterCheck,
          layout: CLUSTERS_COUNT_LAYOUT(sortKey),
          paint: CLUSTERS_COUNT_PAINT,
        });
      }

      if (!map.getLayer("unclustered-point")) {
        map.addLayer({
          id: "unclustered-point",
          type: "symbol",
          source: "news-events",
          filter: ["all", ["!", clusterCheck], ["!=", ["get", "id"], ""]],
          layout: UNCLUSTERED_POINT_LAYOUT,
          paint: UNCLUSTERED_POINT_PAINT,
        });
      }

      if (!map.getLayer("unclustered-point-active")) {
        map.addLayer({
          id: "unclustered-point-active",
          type: "symbol",
          source: "news-events",
          filter: ["all", ["!", clusterCheck], ["==", ["get", "id"], ""]],
          layout: UNCLUSTERED_POINT_ACTIVE_LAYOUT,
          paint: UNCLUSTERED_POINT_ACTIVE_PAINT,
        });
      }

      if (!map.getLayer("selected-point-active")) {
        map.addLayer({
          id: "selected-point-active",
          type: "symbol",
          source: "selected-news-event",
          layout: SELECTED_POINT_ACTIVE_LAYOUT,
          paint: SELECTED_POINT_ACTIVE_PAINT,
        });
      }

      // External Live Overlays: Added beneath news clusters to prevent obstruction.
      
      if (overlaysRef.current["usgs"]) {
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
                visibility: "visible",
              },
              paint: USGS_PAINT,
            },
            "clusters-circle",
          );
        }
      }

      if (overlaysRef.current["noaa"] && !map.getSource("overlay-noaa")) {
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
      if (overlaysRef.current["noaa"] && !map.getLayer("overlay-noaa-raster")) {
        map.addLayer(
          {
            id: "overlay-noaa-raster",
            type: "raster",
            source: "overlay-noaa",
            layout: {
              visibility: "visible",
            },
            paint: { "raster-opacity": 0.6 },
          },
          "clusters-circle",
        );
      }

      if (overlaysRef.current["eonet"] && !map.getSource("overlay-eonet")) {
        map.addSource("overlay-eonet", {
          type: "geojson",
          data: "/api/proxy/eonet",
        });
      }
      if (overlaysRef.current["eonet"] && !map.getLayer("overlay-eonet-point")) {
        map.addLayer(
          {
            id: "overlay-eonet-point",
            type: "circle",
            source: "overlay-eonet",
            layout: {
              visibility: "visible",
            },
            paint: EONET_PAINT,
          },
          "clusters-circle",
        );
      }

      // 1. NASA FIRMS Active Wildfires GeoJSON (proxied and filtered)
      if (overlaysRef.current["fires"] && !map.getSource("overlay-fires")) {
        map.addSource("overlay-fires", {
          type: "geojson",
          data: "/api/proxy/wildfires"
        });
      }
      if (overlaysRef.current["fires"] && !map.getLayer("overlay-fires-point")) {
        map.addLayer(
          {
            id: "overlay-fires-point",
            type: "circle",
            source: "overlay-fires",
            layout: {
              visibility: "visible",
            },
            paint: FIRES_PAINT,
          },
          "clusters-circle",
        );
      }

      // 2. Safecast Radiation Map (proxied to bypass CORS)
      if (overlaysRef.current["radiation"] && !map.getSource("overlay-radiation")) {
        map.addSource("overlay-radiation", {
          type: "raster",
          tiles: [
            "/api/proxy/safecast/{z}/{x}/{y}.png"
          ],
          tileSize: 512
        });
      }
      if (overlaysRef.current["radiation"] && !map.getLayer("overlay-radiation-raster")) {
        map.addLayer(
          {
            id: "overlay-radiation-raster",
            type: "raster",
            source: "overlay-radiation",
            layout: {
              visibility: "visible",
            },
            paint: { "raster-opacity": 0.6 },
          },
          "clusters-circle",
        );
      }

      // 3. WAQI Air Quality Index Map
      if (overlaysRef.current["aqi"] && !map.getSource("overlay-aqi")) {
        const token = process.env.NEXT_PUBLIC_WAQI_TOKEN || "demo";
        map.addSource("overlay-aqi", {
          type: "raster",
          tiles: [
            `https://tiles.waqi.info/tiles/usepa-aqi/{z}/{x}/{y}.png?token=${token}`
          ],
          tileSize: 256
        });
      }
      if (overlaysRef.current["aqi"] && !map.getLayer("overlay-aqi-raster")) {
        map.addLayer(
          {
            id: "overlay-aqi-raster",
            type: "raster",
            source: "overlay-aqi",
            layout: {
              visibility: "visible",
            },
            paint: { "raster-opacity": 0.65 },
          },
          "clusters-circle",
        );
      }

      // 4. Live Flight Tracking Map (adsb.lol)
      if (overlaysRef.current["flights"] && !map.getSource("overlay-flights")) {
        map.addSource("overlay-flights", {
          type: "geojson",
          data: {
            type: "FeatureCollection",
            features: []
          }
        });
      }
      if (overlaysRef.current["flights"] && !map.getLayer("overlay-flights-point")) {
        map.addLayer(
          {
            id: "overlay-flights-point",
            type: "symbol",
            source: "overlay-flights",
            layout: FLIGHTS_LAYOUT,
            paint: FLIGHTS_PAINT
          },
          "clusters-circle",
        );
      }

      // 5. Space Station Tracking (ISS)
      if (overlaysRef.current["iss"] && !map.getSource("overlay-iss")) {
        map.addSource("overlay-iss", {
          type: "geojson",
          data: {
            type: "FeatureCollection",
            features: []
          }
        });
      }
      if (overlaysRef.current["iss"] && !map.getLayer("overlay-iss-point")) {
        map.addLayer(
          {
            id: "overlay-iss-point",
            type: "symbol",
            source: "overlay-iss",
            layout: ISS_LAYOUT,
            paint: ISS_PAINT
          },
          "clusters-circle",
        );
      }
    },
    [forceIndividualPinsRef, overlaysRef, pendingGeoJsonRef]
  );

  return { addSourcesAndLayers };
}
