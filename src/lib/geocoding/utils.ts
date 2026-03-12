/**
 * Utility functions for string normalization and cleaning.
 */

/**
 * Normalize unicode diacritics/accents to ascii equivalents.
 * e.g. "Irán" → "Iran", "São Paulo" → "Sao Paulo", "Zürich" → "Zurich"
 */
export function normalizeAccents(s: string): string {
    return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/**
 * Normalizes a location string to Title Case.
 * Handles special cases like "DC" and hyphenated names.
 */
export function toTitleCase(s: string): string {
    if (!s) return s;
    return s.toLowerCase().split(' ').map(word => {
        if (word === 'dc') return 'DC';
        // Handle hyphenated words like "Port-au-Prince" or "Guinea-Bissau"
        if (word.includes('-')) {
            return word.split('-')
                .map(part => part.charAt(0).toUpperCase() + part.slice(1))
                .join('-');
        }
        return word.charAt(0).toUpperCase() + word.slice(1);
    }).join(' ');
}

/**
 * Clean a candidate: strip possessives, trailing punctuation, dashes, etc.
 */
export function cleanCandidate(raw: string): string {
    let s = raw.trim();
    s = s.replace(/['\u2019]s\b/g, '');      // "Canada's" → "Canada"
    s = s.replace(/['\u2019]s$/g, '');        // trailing possessive at end of string
    s = s.replace(/[.,;:!?"')]+$/, '');       // trailing punctuation
    s = s.replace(/^["'(\u2014\u2013\-]+/, ''); // leading punctuation + em-dash/en-dash/hyphen
    s = s.replace(/[\u2014\u2013\-]+$/, '');   // trailing em-dash/en-dash/hyphen
    return s.trim();
}
