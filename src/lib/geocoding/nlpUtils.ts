import {
    DEMONYM_MAP,
    COUNTRY_ABBREV_MAP,
    SOCIAL_MEDIA_TRAILER,
    HASHTAG_FUSED_PATTERN,
    MEDIA_ATTRIBUTION_SUFFIX,
} from './constants';

/**
 * Resolves demonyms to their base country (e.g., "Chinese" -> "China").
 */
export function extractDemonym(text: string): string | null {
    const words = text.split(/[\s\-]+/);
    for (let i = 0; i < words.length; i++) {
        const word = words[i];
        const lower = word.toLowerCase().replace(/[^a-z]/g, '');
        const mapped = DEMONYM_MAP[lower];
        if (typeof mapped === 'string') {
            // Protect "Mark Cuban" from being geocoded to Cuba
            if (lower === 'cuban' && i > 0) {
                const prev = words[i - 1].toLowerCase().replace(/[^a-z]/g, '');
                if (prev === 'mark') continue;
            }
            return mapped;
        }
        if (lower.endsWith('s')) {
            const singular = lower.slice(0, -1);
            const mappedSingular = DEMONYM_MAP[singular];
            if (typeof mappedSingular === 'string') {
                return mappedSingular;
            }
        }
    }
    return null;
}

/**
 * Resolves common country abbreviations (e.g., "U.S." -> "United States").
 */
export function extractCountryAbbrev(text: string): string | null {
    // Keep hyphenated model/product codes intact (for example, Casio GA-2100).
    // Geographic compounds such as "US-led" are normalized by preprocessText.
    const tokens = text.split(/\s+/);
    for (const token of tokens) {
        const cleaned = token.replace(/['\u2019]s$/i, '').replace(/[,;:!?'")\]]+$/, '').replace(/^['"(\[]+/, '');
        const lower = cleaned.toLowerCase();
        const mapped = COUNTRY_ABBREV_MAP[lower];
        if (typeof mapped === 'string' && mapped !== '__skip__') {
            // Pronoun 'us' protection: 'us' must be uppercase (US, U.S., Us) to match United States
            if (lower === 'us' && cleaned !== 'US' && cleaned !== 'U.S.' && cleaned !== 'Us' && cleaned !== 'U.S') {
                continue;
            }
            // State abbreviation 'or' protection: 'or' must be uppercase/capitalized (OR, O.R., Or) to match Oregon
            if (lower === 'or' && cleaned !== 'OR' && cleaned !== 'O.R.' && cleaned !== 'Or' && cleaned !== 'O.R') {
                continue;
            }
            // State abbreviation 'wa' protection: 'wa' must be uppercase/capitalized (WA, W.A., Wa) to match Washington
            if (lower === 'wa' && cleaned !== 'WA' && cleaned !== 'W.A.' && cleaned !== 'Wa' && cleaned !== 'W.A') {
                continue;
            }
            return mapped;
        }
    }
    return null;
}

/**
 * Removes metadata noise, social media trailers, and attribution suffixes
 * to prevent false positive location matches from source names or hashtags.
 */
export function preprocessText(text: string): string {
    text = text.replace(/\bL\.A\.(?=\s|$)/g, 'Los Angeles');
    text = text.replace(/\bB\.C\.(?=\s|$)/g, 'British Columbia');
    // Preserve both named parties in geographic compounds such as Kazakhstan-EU.
    text = text.replace(/\b([A-Z][a-z]+)-(EU|US|UK|NATO)\b/g, '$1 $2');
    text = text.replace(SOCIAL_MEDIA_TRAILER, '');
    text = text.replace(/^GeoConfirmed\s+\w+\.?\s*/i, '');
    text = text.replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"');
    text = text.replace(/\b(U\.S\.|U\.K\.|U\.A\.E\.|NK|EU|NATO|UK|US|UAE)['\u2019]s\b/gi, '$1 ');
    // Hyphenated compound adjective resolution (e.g. "Oregon-based" -> "Oregon ")
    text = text.replace(/\b([A-Za-z]+)-(based|led|linked|centric|backed|focused|mediated|aligned|sponsored)\b/gi, '$1 ');
    text = text.replace(HASHTAG_FUSED_PATTERN, '$2');
    text = text.replace(/#\w+/g, '');
    text = text.replace(MEDIA_ATTRIBUTION_SUFFIX, '');
    text = text.replace(/\b(?:turning\s+point\s+usa|america's\s+pastime|the\s+atlantic)\b/gi, '');
    text = text.replace(/\b(vietnam|korean|gulf|world|civil|cold)\s+war\b/gi, '');
    text = text.replace(/\bSt\.\s+Paul\b/gi, 'Saint Paul');
    text = text.replace(/\bLiberal\b(?=\s+(?:party|leader)\b)/gi, '');
    text = text.replace(/\bEl Ni(?:ñ|n)o\b(?=\s+(?:concerns?|conditions?|weather|pattern|cycle|event|phenomenon|impacts?|effects?)\b)/gi, '');
    text = text.replace(/\bvan(?=\s+(?:de(?:n|r)?|der|het)\b)/g, '');
    text = text.replace(/\bKnowledge Centre\b/gi, '');
    text = text.replace(/\bStrength in Unity\b/gi, 'Strength');
    text = text.replace(/\bLos Angeles Lakers\b/gi, 'Lakers');
    // Frequent, unambiguous Albanian variants from a feed where the Latin-script
    // names are otherwise absent from the GeoNames dictionary.
    text = text.replace(/\bSerbi(?:së|a)?\b/gi, 'Serbia');
    text = text.replace(/\bIrani\b/gi, 'Iran');
    text = text.replace(/\bRepublik(?:ës|a)\s+Srpska\b/gi, 'Srpska');
    text = text.replace(/\bN\.\s*Korea\b/gi, 'North Korea');
    return text.trim();
}
