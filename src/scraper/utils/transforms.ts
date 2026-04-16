/*
  Dan Sharan

  Scraper data transforms — converts scraped NewsItems into Supabase-ready DbEvent rows.
  Extracted from index.ts for testability.
*/

import type { NewsItem } from '@/lib/types';
import type { DbEvent } from '@/types';
import { ensureIsoDate } from './date';

/**
 * Removes incomplete surrogate pairs and other characters that break Postgres UTF-8/JSON parsing.
 */
export function cleanString(str: string | undefined | null): string {
    if (!str) return '';
    // Removes standalone surrogates (D800-DFFF) while keeping valid pairs
    return str.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '');
}

/**
 * Convert a scraped NewsItem into a Supabase-ready DbEvent row.
 * Items without a URL are dropped (URL is the UNIQUE conflict key).
 */
export function newsItemToDbEvent(item: NewsItem): DbEvent | null {
    if (!item.url) return null;

    // Security: Validate URL protocol to prevent javascript: or other injections
    if (!item.url.startsWith('http://') && !item.url.startsWith('https://')) {
        return null;
    }

    let tags = item.tags ?? null;
    if (Array.isArray(tags)) {
        tags = tags.filter(t => typeof t === 'string' && t.trim().length > 0);
        if (tags.length === 0) tags = null;
    }
    
    return {
        title: cleanString(item.title),
        description: cleanString(item.description),
        url: item.url,
        source: item.source,
        source_type: item.sourceType,
        category: item.category,
        image_url: item.imageUrl,
        published_at: ensureIsoDate(item.publishedAt),
        latitude: (typeof item.latitude === 'number' && Number.isFinite(item.latitude)) ? item.latitude : null,
        longitude: (typeof item.longitude === 'number' && Number.isFinite(item.longitude)) ? item.longitude : null,
        location_name: cleanString(item.locationName) || null,
        tags: tags,
    };
}
