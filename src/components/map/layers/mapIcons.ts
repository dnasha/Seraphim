import maplibregl from "maplibre-gl";
import { generateCategoryIcon } from "../MapConstants";
import { CATEGORIES } from "../utils";

export async function loadMapIcons(map: maplibregl.Map) {
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
}
