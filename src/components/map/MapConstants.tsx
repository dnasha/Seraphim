/**
 * MapConstants and Utilities
 * 
 * Centralized configuration for the MapLibre engine, including base layer definitions,
 * dynamic icon generation, and temporal formatting.
 */

import { 
    getCategoryColor, 
    getSourceBadgeColor, 
    getCredibilityStyle, 
    CATEGORY_ICONS 
} from '@/lib/styles/colors';
import { layers, namedFlavor } from '@protomaps/basemaps';

/**
 * Available Map Base Layers
 * 
 * Defines the raster tile URLs and attributions for various map styles.
 * Voyager is used as the default 'standard' style.
 */
export const MAP_STYLES: Record<
  string,
  {
    url: string;
    labelsUrl?: string;
    attribution: string;
    label: string;
    isPmtiles?: boolean;
    theme?: string;
    isMapTiler?: boolean;
    showsMapTilerLogo?: boolean;
    requiresEntitlement?: boolean;
  }
> = {
  standard: {
    url: "https://tiles.seraphi.me/world_11/{z}/{x}/{y}.mvt",
    attribution: '<a href="https://protomaps.com">© Protomaps</a> <a href="https://www.openstreetmap.org/copyright">© OpenStreetMap contributors</a>',
    label: "Standard",
    isPmtiles: true,
    theme: "light",
  },
  dark: {
    url: "https://tiles.seraphi.me/world_11/{z}/{x}/{y}.mvt",
    attribution: '<a href="https://protomaps.com">© Protomaps</a> <a href="https://www.openstreetmap.org/copyright">© OpenStreetMap contributors</a>',
    label: "Dark",
    isPmtiles: true,
    theme: "dark",
  },
  black: {
    url: "https://tiles.seraphi.me/world_11/{z}/{x}/{y}.mvt",
    attribution: '<a href="https://protomaps.com">© Protomaps</a> <a href="https://www.openstreetmap.org/copyright">© OpenStreetMap contributors</a>',
    label: "Black",
    isPmtiles: true,
    theme: "black",
    requiresEntitlement: true,
  },
  light: {
    url: "https://tiles.seraphi.me/world_11/{z}/{x}/{y}.mvt",
    attribution: '<a href="https://protomaps.com">© Protomaps</a> <a href="https://www.openstreetmap.org/copyright">© OpenStreetMap contributors</a>',
    label: "White",
    isPmtiles: true,
    theme: "white",
    requiresEntitlement: true,
  },
  satellite: {
    // Premium styles resolve through the entitlement-aware server route. Keep
    // browser bundles free of any MapTiler credential.
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: '<a href="https://www.openstreetmap.org/copyright">© OpenStreetMap contributors</a>',
    label: "Satellite",
    showsMapTilerLogo: true,
    requiresEntitlement: true,
  },
  topographic: {
    url: "https://a.tile.opentopomap.org/{z}/{x}/{y}.png",
    attribution: '<a href="https://www.openstreetmap.org/copyright">© OpenStreetMap contributors</a>',
    label: "Terrain",
    showsMapTilerLogo: true,
    requiresEntitlement: true,
  },
};

export { getCategoryColor, getSourceBadgeColor, getCredibilityStyle };

/**
 * generateCategoryIcon
 * 
 * Generates a dynamic SVG marker icon as an HTMLImageElement.
 * The icon consists of a colored circle base with a white category-specific glyph.
 * 
 * @param category The event category determining the color and icon path.
 * @param isActive Whether the marker is in a selected/active state (affects size).
 * @returns A promise resolving to the generated image element for MapLibre consumption.
 */
export async function generateCategoryIcon(
  category?: string,
  isActive?: boolean,
): Promise<HTMLImageElement> {
  const color = getCategoryColor(category);
  const iconPath =
    CATEGORY_ICONS[category || "general"] || CATEGORY_ICONS.general;

  // Configuration for marker dimensions and scaling
  const containerSize = isActive ? 34 : 26;
  const r = containerSize / 2 - 2;
  const cx = containerSize / 2;
  const cy = containerSize / 2;
  const iconScale = isActive ? 0.7 : 0.58;
  const iconOffset = (containerSize - 24 * iconScale) / 2;

  const svgStr = `
        <svg width="${containerSize}" height="${containerSize}" viewBox="0 0 ${containerSize} ${containerSize}" xmlns="http://www.w3.org/2000/svg">
            <circle cx="${cx}" cy="${cy}" r="${r}" fill="${color}" />
            <g transform="translate(${iconOffset}, ${iconOffset}) scale(${iconScale})">
                <path d="${iconPath}" fill="#ffffff" />
            </g>
        </svg>
    `;

  return new Promise((resolve, reject) => {
    const img = new Image(containerSize, containerSize);
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgStr)}`;
  });
}

/**
 * getMapLibreStyle
 * 
 * Constructs a valid MapLibre Style Specification object for raster tile sources.
 * This is used to dynamically switch base layers without reloading the entire map instance.
 * 
 * @param styleKey The key identifying the style in MAP_STYLES.
 * @returns A MapLibre compatible style object.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getMapLibreStyle(styleKey: string, resolveProtected = true): any {
  const style = MAP_STYLES[styleKey] || MAP_STYLES.standard;

  if (resolveProtected && style.requiresEntitlement) {
    return `/api/map-style/${styleKey}`;
  }

  if (style.isMapTiler) {
    return style.url;
  }

  if (style.isPmtiles && style.theme) {
    return {
      version: 8,
      glyphs: "https://tiles.openstreetmap.us/fonts/{fontstack}/{range}.pbf",
      sprite: `https://protomaps.github.io/basemaps-assets/sprites/v4/${style.theme}`,
      sources: {
        "protomaps": {
          type: "vector",
          tiles: [style.url],
          attribution: style.attribution,
          minzoom: 0,
          maxzoom: 11,
        },
      },
      layers: layers("protomaps", namedFlavor(style.theme), { lang: "en" }),
    };
  }

  return {
    version: 8,
    sources: {
      "raster-tiles": {
        type: "raster",
        tiles: [style.url],
        tileSize: 256,
        attribution: style.attribution,
      },
    },
    layers: [
      {
        id: "simple-tiles",
        type: "raster",
        source: "raster-tiles",
        minzoom: 0,
        maxzoom: 22,
      },
    ],
  };
}

/** Used only by the protected map-style route to build the real style payload. */
export function getMapLibreStyleForServer(styleKey: string): unknown {
  return getMapLibreStyle(styleKey, false);
}

/**
 * formatTimeAgo
 * 
 * Converts an ISO date string into a concise human-readable relative time string.
 * Optimized for dashboard density (e.g., '5m ago', '2h ago').
 */
export function formatTimeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const mins = Math.floor(diffMs / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}
