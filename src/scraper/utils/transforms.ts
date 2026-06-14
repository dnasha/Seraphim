/*
Seraphim Scraper Utilities - Data Transformers
Handles sanitization, normalization, and conversion of raw items to database schemas.
*/

import DOMPurify from 'isomorphic-dompurify';
import type { NewsItem } from '@/lib/core/types';
import type { DbEvent } from '@/types';
import { ensureIsoDate } from '@/lib/utils/date';
import { RSS_SOURCES, REDDIT_SOURCES, TELEGRAM_CHANNELS, X_ACCOUNTS } from '@/data/sources';

/* 
Pre-computes a static lookup map of source names to their assigned credibility tiers.
This optimization avoids repeated array iterations during high-volume ingestion.
*/
const SOURCE_TIER_MAP = new Map<string, number>();
[...RSS_SOURCES, ...REDDIT_SOURCES, ...TELEGRAM_CHANNELS, ...X_ACCOUNTS].forEach(s => {
    SOURCE_TIER_MAP.set(s.name, s.credibility_tier);
});

/*
Performs multi-stage string sanitization:
1. Handles null/undefined/non-string inputs gracefully.
2. Removes standalone surrogate pairs (U+D800 to U+DFFF). These are often caused by 
   improperly truncated multibyte characters (like emojis) and will cause PostgreSQL 
   insertion failures with "invalid byte sequence for encoding UTF8".
3. Sanitize HTML content to prevent XSS.
*/
export function cleanString(str: unknown): string {
    let s = '';
    if (str === null || str === undefined) s = '';
    else if (typeof str === 'string') s = str;
    else {
        try { s = String(str); } catch { s = ''; }
    }
    const cleaned = s.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '');
    return DOMPurify.sanitize(cleaned);
}

/*
Maps a scraper NewsItem to the database DbEvent schema.
Primary validations:
- Rejects items without URLs (required for unique identification).
- Enforces HTTP/HTTPS protocol.
- Normalizes coordinates and dates.
- Assigns initial credibility metrics and the Story model sources array.
*/
export function newsItemToDbEvent(item: NewsItem): DbEvent | null {
    if (!item.url) return null;

    if (!item.url.startsWith('http://') && !item.url.startsWith('https://')) {
        return null;
    }

    const tier = SOURCE_TIER_MAP.get(item.source) ?? 3;
    
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
        credibility_tier: tier,
        event_count: 1,
        /* Impact score calculation: Tier 1 (3.5 - 1 = 2.5), Tier 2 (1.5), Tier 3 (0.5) */
        impact_score: 3.5 - tier,
        sources: [{
            name: item.source,
            url: item.url,
            source_type: item.sourceType,
            discovered_at: ensureIsoDate(item.publishedAt),
        }],
    };
}
