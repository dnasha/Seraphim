export const NEWS_SOURCES = ['news', 'reddit', 'x', 'telegram', 'extra'] as const;
export const NEWS_CATEGORIES = ['all', 'world', 'crisis', 'nation', 'business', 'technology', 'science', 'health', 'general'] as const;

export interface NewsFilters {
  sources?: string[];
  categories?: string[];
  credibilityTiers?: number[];
  minVolume?: number;
}

export function newsFilterKey(filters: NewsFilters) {
  return JSON.stringify([
    [...(filters.sources ?? NEWS_SOURCES)].sort(),
    [...(filters.categories ?? ['all'])].sort(),
    [...(filters.credibilityTiers ?? [1, 2, 3])].sort(),
    filters.minVolume ?? 1,
  ]);
}

export function appendNewsFilters(params: URLSearchParams, key: string) {
  const [sources, categories, tiers, minimum] = JSON.parse(key) as [string[], string[], number[], number];
  params.set('sources', sources.join(','));
  params.set('categories', categories.join(','));
  params.set('credibility', tiers.join(','));
  params.set('min_reports', String(minimum));
}
