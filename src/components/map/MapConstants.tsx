/*
Map configuration constants and utilities.
Provides map styles, category icons, and helper functions for formatting and icon generation.
*/

import { 
    getCategoryColor, 
    getSourceBadgeColor, 
    getCredibilityStyle, 
    CATEGORY_ICONS 
} from '@/lib/styles/colors';

// Definitions for available map base layers and their attributions.
export const MAP_STYLES: Record<
  string,
  { url: string; labelsUrl?: string; attribution: string; label: string }
> = {
  standard: {
    url: "https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
    attribution: "&copy; Seraphim 2026 &copy; OpenStreetMap contributors &copy; CARTO",
    label: "Standard",
  },
  dark: {
    url: "https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    attribution: "&copy; Seraphim 2026 &copy; OpenStreetMap contributors &copy; CARTO",
    label: "Dark",
  },
  light: {
    url: "https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
    attribution: "&copy; Seraphim 2026 &copy; OpenStreetMap contributors &copy; CARTO",
    label: "Light",
  },
  satellite: {
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: "&copy; Seraphim 2026 &copy; Esri - Esri, DeLorme, NAVTEQ",
    label: "Satellite",
  },
  topographic: {
    url: "https://a.tile.opentopomap.org/{z}/{x}/{y}.png",
    attribution: "&copy; Seraphim 2026 &copy; OpenStreetMap contributors, &copy; OpenTopoMap",
    label: "Terrain",
  },
};

export { getCategoryColor, getSourceBadgeColor, getCredibilityStyle };



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
