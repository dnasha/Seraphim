/*
Map configuration constants and utilities.
Provides map styles, category icons, and helper functions for formatting and icon generation.
*/

import { getCategoryColor, getSourceBadgeColor } from "@/lib/colors";

// Definitions for available map base layers and their attributions.
export const MAP_STYLES: Record<
  string,
  { url: string; labelsUrl?: string; attribution: string; label: string }
> = {
  standard: {
    url: "https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
    attribution: "&copy; OpenStreetMap contributors &copy; CARTO",
    label: "Standard",
  },
  dark: {
    url: "https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    attribution: "&copy; OpenStreetMap contributors &copy; CARTO",
    label: "Dark",
  },
  light: {
    url: "https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
    attribution: "&copy; OpenStreetMap contributors &copy; CARTO",
    label: "Light",
  },
  satellite: {
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: "&copy; Esri - Esri, DeLorme, NAVTEQ",
    label: "Satellite",
  },
  topographic: {
    url: "https://a.tile.opentopomap.org/{z}/{x}/{y}.png",
    attribution: "&copy; OpenStreetMap contributors, &copy; OpenTopoMap",
    label: "Terrain",
  },
};

export { getCategoryColor, getSourceBadgeColor };

// SVG path data for news category icons.
export const CATEGORY_ICONS: Record<string, string> = {
  general:
    "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z",
  world:
    "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z",
  crisis: "M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z",
  nation: "M14.4 6L14 4H5v17h2v-7h5.6l.4 2h7V6z",
  business: "M5 9.2h3V19H5V9.2zM10.6 5h2.8v14h-2.8V5zm5.6 8H19v6h-2.8v-6z",
  technology:
    "M15 9H9v6h6V9zm-2 4h-2v-2h2v2zm8-2V9h-2V7c0-1.1-.9-2-2-2h-2V3h-2v2h-2V3H9v2H7c-1.1 0-2 .9-2 2v2H3v2h2v2H3v2h2v2c0 1.1.9 2 2 2h2v2h2v-2h2v2h2v-2h2c1.1 0 2-.9 2-2v-2h2v-2h-2v-2h2zm-4 6H7V7h10v10z",
  science:
    "M13 11.33L18 18H6l5-6.67V6h2v5.33zM15.96 4H8.04C7.62 4 7.39 4.48 7.65 4.81L9 6.5v4.17L3.2 18.4C2.71 19.06 3.18 20 4 20h16c.82 0 1.29-.94.8-1.6L15 10.67V6.5l1.35-1.69c.26-.33.03-.81-.39-.81z",
  health:
    "M19 3H5c-1.1 0-1.99.9-1.99 2L3 19c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-1 11h-4v4h-4v-4H6v-4h4V6h4v4h4v4z",
};

/*
Generates a category icon as an HTMLImageElement by wrapping an SVG path in a circle.
Returns a Promise that resolves with the generated image.
*/
export async function generateCategoryIcon(
  category?: string,
  isActive?: boolean,
): Promise<HTMLImageElement> {
  const color = getCategoryColor(category);
  const iconPath =
    CATEGORY_ICONS[category || "general"] || CATEGORY_ICONS.general;

  const containerSize = isActive ? 34 : 26;
  const r = containerSize / 2 - 2;
  const cx = containerSize / 2;
  const cy = containerSize / 2;
  const iconScale = isActive ? 0.7 : 0.58;
  const iconOffset = (containerSize - 24 * iconScale) / 2;

  const svgStr = `
        <svg width="${containerSize}" height="${containerSize}" viewBox="0 0 ${containerSize} ${containerSize}" xmlns="http://www.w3.org/2000/svg">
            <circle cx="${cx}" cy="${cy}" r="${r + 1.5}" fill="#ffffff" />
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

/*
Returns a MapLibre style object for the requested style key.
Fallback to standard style if the key is not recognized.
*/
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getMapLibreStyle(styleKey: string): any {
  const style = MAP_STYLES[styleKey] || MAP_STYLES.standard;

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

// Formats a date string into a relative time string (e.g., "5m ago", "2h ago").
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
