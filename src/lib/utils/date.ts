/**
 * Date normalization and safety utilities for the Seraphim pipeline.
 * 
 * Provides functions to ensure that date strings from disparate sources 
 * (RSS, Reddit, GNews, etc.) are converted into a stable, valid ISO 8601 format 
 * for database storage and frontend consumption.
 */

/**
 * Normalizes a variety of date string formats to a valid ISO 8601 string.
 * 
 * Handles standard JS Date parsing and incorporates specialized cleaning for 
 * non-standard formats (e.g., CrisisWatch). To prevent timezone-induced 
 * future dates, all results are capped at the current system time.
 */
export function ensureIsoDate(dateStr: string | undefined | null): string {
    const now = new Date();
    if (!dateStr) return now.toISOString();

    // Attempt standard parsing first
    let d = new Date(dateStr);
    
    // Handle non-standard formats such as "Friday, April 10, 2026 - 16:35"
    if (isNaN(d.getTime())) {
        // Strip day name: "April 10, 2026 - 16:35"
        let cleaned = dateStr.replace(/^[A-Za-z]+,\s+/, ''); 
        // Normalize separators: "April 10, 2026 16:35"
        cleaned = cleaned.replace(/\s*-\s*/, ' ');           
        d = new Date(cleaned);
    }

    // Fallback to current time if parsing fails
    if (isNaN(d.getTime())) return now.toISOString();

    // Ensure date is not in the future
    if (d > now) return now.toISOString();

    return d.toISOString();
}
