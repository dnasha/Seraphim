/*
Date normalization utilities.
Ensures date strings from various sources are converted to valid ISO 8601 format,
handling non-standard formats encountered during scraping.
*/

/*
Normalizes a date string to valid ISO 8601 format.
Handles standard JS parsing and specific non-standard formats (e.g., CrisisWatch).
Falls back to current system time if parsing fails.
*/
export function ensureIsoDate(dateStr: string | undefined | null): string {
    if (!dateStr) return new Date().toISOString();

    // Try standard JS parsing first
    let d = new Date(dateStr);
    if (!isNaN(d.getTime())) return d.toISOString();

    // Normalizes CrisisWatch format: "Friday, April 10, 2026 - 16:35"
    let cleaned = dateStr.replace(/^[A-Za-z]+,\s+/, ''); // "April 10, 2026 - 16:35"
    cleaned = cleaned.replace(/\s*-\s*/, ' ');           // "April 10, 2026 16:35"

    d = new Date(cleaned);
    if (!isNaN(d.getTime())) return d.toISOString();

    // Fallback to current system time for resilience
    return new Date().toISOString();
}

