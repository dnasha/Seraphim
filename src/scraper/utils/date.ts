/**
 * Ensures a date string is in valid ISO 8601 format.
 * Handles non-standard formats like "Friday, April 10, 2026 - 16:35"
 */
export function ensureIsoDate(dateStr: string | undefined | null): string {
    if (!dateStr) return new Date().toISOString();

    // 1. Try standard JS parsing
    let d = new Date(dateStr);
    if (!isNaN(d.getTime())) return d.toISOString();

    // 2. Handle CrisisWatch format: "Friday, April 10, 2026 - 16:35"
    // Remove day of week and clean up separator
    let cleaned = dateStr.replace(/^[A-Za-z]+,\s+/, ''); // "April 10, 2026 - 16:35"
    cleaned = cleaned.replace(/\s*-\s*/, ' ');           // "April 10, 2026 16:35"

    d = new Date(cleaned);
    if (!isNaN(d.getTime())) return d.toISOString();

    // 3. Last resort: current time
    return new Date().toISOString();
}
