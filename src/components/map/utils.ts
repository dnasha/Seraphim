/**
 * Map Utilities
 * Provides helper functions for map-related data processing, 
 * including client-side coordinate jittering and constant definitions.
 */

import { NewsItem } from "@/lib/core/types";

export const CLUSTER_MAX_ZOOM = 7;

export const CATEGORIES = [
  "general",
  "world",
  "crisis",
  "nation",
  "business",
  "technology",
  "science",
  "health",
];

/**
 * Deterministic client-side jitter to prevent unclustered pins from stacking perfectly.
 * 
 * Logic:
 * 1. Groups items by coordinate (rounded to 5 decimal places).
 * 2. If a group has multiple items, it sorts them by ID (anchoring the selected item at the center).
 * 3. Keeps the selected pin (or deterministic first pin) at its canonical coordinate
 *    and applies a bounded Golden-Angle Spiral to remaining display-only pins.
 * 4. Accounts for Mercator projection distortion by scaling longitude offsets based on latitude.
 */
export function applyClientJitter(
  items: NewsItem[],
  selectedId: string | null = null,
): NewsItem[] {
  const coordGroups = new Map<string, NewsItem[]>();

  for (const item of items) {
    if (item.latitude == null || item.longitude == null) continue;
    // Skip items that are part of a server-side cluster as they shouldn't be individual pins.
    if (item.storyCount && item.storyCount > 1) continue;

    const key = `${item.latitude.toFixed(5)},${item.longitude.toFixed(5)}`;
    if (!coordGroups.has(key)) coordGroups.set(key, []);
    coordGroups.get(key)!.push(item);
  }

  const jitteredMap = new Map<string, { lat: number; lng: number }>();

  for (const group of coordGroups.values()) {
    if (group.length <= 1) continue;

    group.sort((a, b) => {
      const aId = a.originalId || a.id;
      const bId = b.originalId || b.id;
      if (aId === selectedId) return -1;
      if (bId === selectedId) return 1;
      return aId.localeCompare(bId);
    });

    const baseLat = group[0].latitude!;
    const baseLng = group[0].longitude!;
    const latRad = (baseLat * Math.PI) / 180;
    
    // Scale longitude offset to maintain circular appearance across latitudes.
    const lngScale = Math.max(Math.cos(latRad), 0.2);
    const goldenAngle = (137.5 * Math.PI) / 180;
    
    // Convert kilometers to approximate degrees for visual spacing.
    const kmToLatDeg = (km: number) => km / 111.32;
    const growth = kmToLatDeg(0.9);
    const maxRadius = kmToLatDeg(6);

    for (let i = 0; i < group.length; i++) {
      const item = group[i];
      const angle = i * goldenAngle;
      // Square root growth ensures an even density as the spiral expands.
      const radius = i === 0 ? 0 : Math.min(maxRadius, Math.sqrt(i) * growth * 1.2);
      const latOffset = radius * Math.cos(angle);
      const lngOffset = (radius * Math.sin(angle)) / lngScale;

      const jitteredLat = Math.max(-85, Math.min(85, baseLat + latOffset));
      const jitteredLngRaw = baseLng + lngOffset;
      // Wrap longitude correctly around the dateline.
      const jitteredLng = ((((jitteredLngRaw + 180) % 360) + 360) % 360) - 180;

      jitteredMap.set(item.id, {
        lat: jitteredLat,
        lng: jitteredLng,
      });
    }
  }

  return items.map((item) => {
    const jittered = jitteredMap.get(item.id);
    if (jittered) {
      return { ...item, latitude: jittered.lat, longitude: jittered.lng };
    }
    return item;
  });
}
