interface ProjectionMap {
  setProjection?: (projection: { type: string }) => void;
  setFog?: (fog: {
    range: [number, number];
    color: string;
    "horizon-blend": number;
  } | null) => void;
  jumpTo: (options: { pitch: number; bearing: number }) => unknown;
  resize: () => void;
}

/**
 * Applies the requested projection without waiting for every style source to be idle.
 * MapLibre can safely change projection after the base style has loaded even while a
 * GeoJSON source is updating, although isStyleLoaded() reports false in that window.
 */
export function applyMapProjection(
  map: ProjectionMap,
  isGlobe: boolean,
  currentStyle: string,
): boolean {
  try {
    map.setProjection?.({ type: isGlobe ? "globe" : "mercator" });

    if (map.setFog) {
      map.setFog(isGlobe
        ? {
            range: [-1, 2],
            color: currentStyle === "dark" ? "#000b1e" : "#ffffff",
            "horizon-blend": 0.1,
          }
        : null);
    }

    if (!isGlobe) {
      map.jumpTo({ pitch: 0, bearing: 0 });
    }

    map.resize();
    return true;
  } catch {
    // A full base-style replacement can make projection setters throw briefly.
    // The caller retries when that style finishes loading.
    return false;
  }
}
