/**
 * GEOCODING UTILITIES
 * 
 * Helper functions for string normalization, geographic formatting,
 * and candidate cleaning. These utilities ensure consistent dictionary
 * keys and readable map labels.
 */

/**
 * Normalizes Unicode diacritics to their ASCII equivalents.
 * Example: "Irán" -> "Iran", "São Paulo" -> "Sao Paulo".
 */
export function normalizeAccents(s: string): string {
    return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/**
 * Converts a string to Title Case with support for hyphenated names
 * and common acronyms.
 */
export function toTitleCase(s: string): string {
    if (!s) return s;
    return s.toLowerCase().split(' ').map(word => {
        if (word === 'dc') return 'DC';
        if (word.includes('-')) {
            return word.split('-')
                .map(part => part.charAt(0).toUpperCase() + part.slice(1))
                .join('-');
        }
        return word.charAt(0).toUpperCase() + word.slice(1);
    }).join(' ');
}

/**
 * Strips possessives, trailing punctuation, and leading/trailing dashes
 * from raw extraction candidates to prepare them for dictionary lookup.
 */
export function cleanCandidate(raw: string): string {
    if (typeof raw !== 'string') return '';
    let s = raw.trim();
    s = s.replace(/['\u2019]s\b/g, '');
    s = s.replace(/['\u2019]s$/g, '');
    s = s.replace(/[.,;:!?"')]+$/, '');
    s = s.replace(/^["'(\u2014\u2013\-]+/, '');
    s = s.replace(/[\u2014\u2013\-]+$/, '');
    return s.trim();
}
