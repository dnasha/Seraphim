import DOMPurify from 'isomorphic-dompurify';
import type { NewsItem } from '@/lib/types';
import type { DbEvent } from '@/types';
import { ensureIsoDate } from './date';
import { RSS_SOURCES, REDDIT_SOURCES, TELEGRAM_CHANNELS, X_ACCOUNTS } from '@/data/sources';

/* Build a static lookup map: source name → credibility_tier */
const SOURCE_TIER_MAP = new Map<string, number>();
[...RSS_SOURCES, ...REDDIT_SOURCES, ...TELEGRAM_CHANNELS, ...X_ACCOUNTS].forEach(s => {
    SOURCE_TIER_MAP.set(s.name, s.credibility_tier);
});

/*
Removes incomplete surrogate pairs and sanitizes HTML content.
Prevents database insertion errors and XSS vulnerabilities.
*/
export function cleanString(str: string | undefined | null): string {
    if (!str) return '';
    // Removes standalone surrogates (D800-DFFF) while keeping valid pairs
    const cleaned = str.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '');
    // Sanitize HTML to prevent XSS
    return DOMPurify.sanitize(cleaned);
}

/*
Converts a scraped NewsItem into a Supabase-ready DbEvent row.
Items without a valid HTTP/HTTPS URL are rejected as the URL is the unique conflict key.
*/
export function newsItemToDbEvent(item: NewsItem): DbEvent | null {
    if (!item.url) return null;

    // Validate URL protocol to prevent injection
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
        /* Assign credibility tier from source registry, default to Tier 3 (raw) */
        credibility_tier: SOURCE_TIER_MAP.get(item.source) ?? 3,
        /* Initialize the Story model sources array for new items */
        sources: [{
            name: item.source,
            url: item.url,
            source_type: item.sourceType,
            discovered_at: new Date().toISOString(),
        }],
    };
}


