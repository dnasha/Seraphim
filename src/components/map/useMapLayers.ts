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

      // Load flight plane icon
      if (!map.hasImage("flight-plane-icon")) {
        const svgStr = `
          <svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L14 19v-5.5l8 2.5z" fill="#0284c7" stroke="#ffffff" stroke-width="1.5" />
          </svg>
        `;
        const img = new Image(24, 24);
        img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgStr)}`;
        await new Promise((resolve) => {
          img.onload = () => {
            try {
              if (!map.hasImage("flight-plane-icon")) {
                map.addImage("flight-plane-icon", img);
              }
            } catch {}
            resolve(true);
          };
          img.onerror = () => resolve(false);
        });
      }

      // Load ship icon
      if (!map.hasImage("ship-icon")) {
        const svgStr = `
          <svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path d="M2 17h20l-2 4H4l-2-4zm18-4v3H4v-3l4-3h8l4 3zm-6-6h2v3h-2V7zm-4 1h2v2H8V8z" fill="#06b6d4" stroke="#ffffff" stroke-width="1.5" />
          </svg>
        `;
        const img = new Image(24, 24);
        img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgStr)}`;
        await new Promise((resolve) => {
          img.onload = () => {
            try {
              if (!map.hasImage("ship-icon")) {
                map.addImage("ship-icon", img);
              }
            } catch {}
            resolve(true);
          };
          img.onerror = () => resolve(false);
        });
      }

      // Load ISS icon
      if (!map.hasImage("iss-icon")) {
        const svgStr = `
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="2" y="5" width="3" height="14" rx="0.5" fill="#f43f5e" stroke="#ffffff" stroke-width="1"/>
            <line x1="3.5" y1="6" x2="3.5" y2="18" stroke="#ffffff" stroke-dasharray="1 1"/>
            <rect x="19" y="5" width="3" height="14" rx="0.5" fill="#f43f5e" stroke="#ffffff" stroke-width="1"/>
            <line x1="20.5" y1="6" x2="20.5" y2="18" stroke="#ffffff" stroke-dasharray="1 1"/>
            <line x1="5" y1="12" x2="19" y2="12" stroke="#ffffff" stroke-width="2"/>
            <rect x="10" y="9" width="4" height="6" rx="1" fill="#e2e8f0" stroke="#f43f5e" stroke-width="1"/>
          </svg>
        `;
        const img = new Image(32, 32);
        img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgStr)}`;
        await new Promise((resolve) => {
          img.onload = () => {
            try {
              if (!map.hasImage("iss-icon")) {
                map.addImage("iss-icon", img);
              }
            } catch {}
            resolve(true);
          };
          img.onerror = () => resolve(false);
        });
      }

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
            paint: {
              "circle-color": [
                "match",
                ["get", "category"],
                "wildfires", "#f97316",    // Orange for wildfires
                "volcanoes", "#dc2626",    // Red for volcanoes
                "severeStorms", "#8b5cf6", // Purple for severe storms
                "floods", "#3b82f6",       // Blue for floods
                "#ef4444"                  // Red fallback
              ],
              "circle-radius": [
                "interpolate",
                ["linear"],
                ["zoom"],
                1, 3,
                5, 6,
                9, 10
              ],
              "circle-opacity": 0.85,
              "circle-stroke-width": 1,
              "circle-stroke-color": "#ffffff",
            },
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
            paint: {
              "circle-color": [
                "interpolate",
                ["linear"],
                ["get", "frp"],
                10, "#fde047",   // Yellow for low intensity
                50, "#f97316",   // Orange for nominal intensity
                150, "#ef4444",  // Red for high intensity
                500, "#7f1d1d"   // Dark Crimson for extreme intensity
              ],
              "circle-radius": [
                "interpolate",
                ["linear"],
                ["zoom"],
                1, [
                  "interpolate",
                  ["linear"],
                  ["get", "frp"],
                  10, 2,
                  500, 4
                ],
                5, [
                  "interpolate",
                  ["linear"],
                  ["get", "frp"],
                  10, 4,
                  500, 8
                ],
                9, [
                  "interpolate",
                  ["linear"],
                  ["get", "frp"],
                  10, 8,
                  500, 16
                ]
              ],
              "circle-opacity": 0.85,
              "circle-stroke-width": 0.5,
              "circle-stroke-color": "#ffffff"
            },
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
            layout: {
              visibility: "visible",
              "icon-image": "flight-plane-icon",
              "icon-allow-overlap": true,
              "icon-ignore-placement": true,
              "icon-rotate": ["get", "track"],
              "icon-rotation-alignment": "map",
              "text-field": ["get", "flight"],
              "text-font": ["Noto Sans Regular"],
              "text-size": 9,
              "text-offset": [0, 1.2],
              "text-anchor": "top",
              "text-allow-overlap": false,
              "text-ignore-placement": false,
            },
            paint: {
              "text-color": "#ffffff",
              "text-halo-color": "#0f172a",
              "text-halo-width": 1.5,
            }
          },
          "clusters-circle",
        );
      }

      // 5. Maritime Tracking (Military CSGs & Tankers)
      if (overlaysRef.current["ships"] && !map.getSource("overlay-ships")) {
        map.addSource("overlay-ships", {
          type: "geojson",
          data: "/api/proxy/ships"
        });
      }
      if (overlaysRef.current["ships"] && !map.getLayer("overlay-ships-point")) {
        map.addLayer(
          {
            id: "overlay-ships-point",
            type: "symbol",
            source: "overlay-ships",
            layout: {
              visibility: "visible",
              "icon-image": "ship-icon",
              "icon-allow-overlap": true,
              "icon-ignore-placement": true,
              "text-field": ["get", "name"],
              "text-font": ["Noto Sans Bold"],
              "text-size": 11,
              "text-offset": [0, 1.4],
              "text-anchor": "top",
              "text-allow-overlap": false,
              "text-ignore-placement": false,
            },
            paint: {
              "text-color": "#ffffff",
              "text-halo-color": "#090d16",
              "text-halo-width": 2.0,
            }
          },
          "clusters-circle",
        );
      }

      // 6. Space Station Tracking (ISS)
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
            layout: {
              visibility: "visible",
              "icon-image": "iss-icon",
              "icon-allow-overlap": true,
              "icon-ignore-placement": true,
              "text-field": [
                "case",
                ["has", "altitude"],
                ["concat", ["get", "name"], "\nAlt: ", ["get", "altitude"], " • Vel: ", ["get", "velocity"]],
                ["get", "name"]
              ],
              "text-font": ["Noto Sans Bold"],
              "text-size": 11,
              "text-offset": [0, 1.6],
              "text-anchor": "top",
              "text-allow-overlap": false,
              "text-ignore-placement": false,
            },
            paint: {
              "text-color": "#ffffff",
              "text-halo-color": "#090d16",
              "text-halo-width": 2.0,
            }
          },
          "clusters-circle",
        );
      }
    },
    [forceIndividualPinsRef, overlaysRef, pendingGeoJsonRef]
  );

  return { addSourcesAndLayers };
}
