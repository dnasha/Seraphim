import type { NewsItem } from "@/lib/core/types";
import { canonicalNewsId } from "@/lib/utils/ranking";

export type MapNewsItem = NewsItem & {
  isTopHot?: boolean;
};

/**
 * Keep worker-bound map data limited to properties used by layer expressions
 * and marker selection. Article bodies and image URLs stay in React state.
 */
export function buildNewsFeatureCollection(
  items: readonly MapNewsItem[],
): GeoJSON.FeatureCollection<GeoJSON.Point> {
  return {
    type: "FeatureCollection",
    features: items.map((item) => ({
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [item.longitude!, item.latitude!],
      },
      properties: {
        id: item.id,
        canonicalId: canonicalNewsId(item),
        category: item.category,
        storyCount: item.storyCount ?? 1,
        isTopHot: item.isTopHot ?? false,
      },
    })),
  };
}
