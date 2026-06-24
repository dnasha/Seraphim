import maplibregl from "maplibre-gl";

type CirclePaint = Extract<maplibregl.LayerSpecification, { type: "circle" }>["paint"];
type SymbolLayout = Extract<maplibregl.LayerSpecification, { type: "symbol" }>["layout"];
type SymbolPaint = Extract<maplibregl.LayerSpecification, { type: "symbol" }>["paint"];

export const CLUSTERS_CIRCLE_PAINT: CirclePaint = {
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
};

export const HOT_STORY_PULSE_PAINT: CirclePaint = {
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
      "navy",
      "#2563eb",
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
};

export const CLUSTERS_COUNT_LAYOUT = (sortKey: maplibregl.ExpressionSpecification): SymbolLayout => ({
  "symbol-sort-key": sortKey,
  "text-field": [
    "to-string",
    ["coalesce", ["get", "summedStoryCount"], ["get", "storyCount"]],
  ],
  "text-size": 12,
  "text-font": ["Noto Sans Bold"],
  "text-allow-overlap": false,
  "text-ignore-placement": false,
  "text-padding": 6,
});

export const CLUSTERS_COUNT_PAINT: SymbolPaint = {
  "text-color": "#ffffff",
};

export const UNCLUSTERED_POINT_LAYOUT: SymbolLayout = {
  "icon-image": [
    "concat",
    ["coalesce", ["get", "category"], "general"],
    "_inactive",
  ],
  "icon-allow-overlap": true,
  "icon-ignore-placement": true,
};

export const UNCLUSTERED_POINT_PAINT: SymbolPaint = {
  "icon-opacity": ["interpolate", ["linear"], ["zoom"], 4, 0.4, 8, 1.0],
};

export const UNCLUSTERED_POINT_ACTIVE_LAYOUT: SymbolLayout = {
  "icon-image": [
    "concat",
    ["coalesce", ["get", "category"], "general"],
    "_active",
  ],
  "icon-allow-overlap": true,
  "icon-ignore-placement": true,
};

export const UNCLUSTERED_POINT_ACTIVE_PAINT: SymbolPaint = {
  "icon-opacity": ["interpolate", ["linear"], ["zoom"], 4, 0.6, 8, 1.0],
};

export const SELECTED_POINT_ACTIVE_LAYOUT: SymbolLayout = {
  "icon-image": [
    "concat",
    ["coalesce", ["get", "category"], "general"],
    "_active",
  ],
  "icon-allow-overlap": true,
  "icon-ignore-placement": true,
  "symbol-sort-key": 1000,
};

export const SELECTED_POINT_ACTIVE_PAINT: SymbolPaint = {
  "icon-opacity": 1,
};

export const USGS_PAINT: CirclePaint = {
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
};

export const EONET_PAINT: CirclePaint = {
  "circle-color": [
    "match",
    ["get", "category"],
    "wildfires", "#f97316",
    "volcanoes", "#dc2626",
    "severeStorms", "#8b5cf6",
    "floods", "#3b82f6",
    "#ef4444"
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
};

export const FIRES_PAINT: CirclePaint = {
  "circle-color": [
    "interpolate",
    ["linear"],
    ["get", "frp"],
    10, "#fde047",
    50, "#f97316",
    150, "#ef4444",
    500, "#7f1d1d"
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
};

export const FLIGHTS_LAYOUT: SymbolLayout = {
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
};

export const FLIGHTS_PAINT: SymbolPaint = {
  "text-color": "#ffffff",
  "text-halo-color": "#0f172a",
  "text-halo-width": 1.5,
};

export const SHIPS_LAYOUT: SymbolLayout = {
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
};

export const SHIPS_PAINT: SymbolPaint = {
  "text-color": "#ffffff",
  "text-halo-color": "#090d16",
  "text-halo-width": 2.0,
};

export const ISS_LAYOUT: SymbolLayout = {
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
};

export const ISS_PAINT: SymbolPaint = {
  "text-color": "#ffffff",
  "text-halo-color": "#090d16",
  "text-halo-width": 2.0,
};
