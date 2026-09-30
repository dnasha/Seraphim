"use client";
import { useEffect, type RefObject } from "react";
import type { Map, GeoJSONSource } from "maplibre-gl";
import type { RegionSpec } from "@/lib/regions/geometry";

const SOURCE = "experiment-region-checkpoints-region";
const FILL = "experiment-region-checkpoints-fill";
const LINE = "experiment-region-checkpoints-outline";
export function useCheckpointMapLayer(
  mapRef: RefObject<Map | null>,
  ready: boolean,
  region: RegionSpec | null,
) {
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !region) return;
    const remove = () => {
      if (map.getLayer(LINE)) map.removeLayer(LINE);
      if (map.getLayer(FILL)) map.removeLayer(FILL);
      if (map.getSource(SOURCE)) map.removeSource(SOURCE);
    };
    const install = () => {
      if (!map.isStyleLoaded()) return;
      const data: GeoJSON.Feature = {
        type: "Feature",
        properties: {},
        geometry: region.geometry,
      };
      const source = map.getSource(SOURCE) as GeoJSONSource | undefined;
      if (!source) map.addSource(SOURCE, { type: "geojson", data });
      if (!map.getLayer(FILL))
        map.addLayer({
          id: FILL,
          type: "fill",
          source: SOURCE,
          paint: { "fill-color": "#5f62ec", "fill-opacity": 0.08 },
        });
      if (!map.getLayer(LINE))
        map.addLayer({
          id: LINE,
          type: "line",
          source: SOURCE,
          paint: {
            "line-color": "#5f62ec",
            "line-width": 2,
            "line-dasharray": [3, 2],
          },
        });
    };
    install();
    map.on("style.load", install);
    map.on("idle", install);
    return () => {
      map.off("style.load", install);
      map.off("idle", install);
      try {
        remove();
      } catch {
        /* Map may already have been disposed by its owner. */
      }
    };
  }, [mapRef, ready, region]);
}
