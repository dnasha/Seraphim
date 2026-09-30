/** Match the dashboard's scraper slots plus its two-minute ingestion buffer. */
export const SCRAPE_INTERVAL_MS = 15 * 60_000;
export const DELIVERY_INTERVAL_MS = 5 * 60_000;
const SCRAPE_OFFSET_MS = 2 * 60_000;
export function nextScrapeCheck(now: number): number {
  // UTC quarter-hours plus the ingestion buffer. Advance strictly beyond now,
  // even at an exact slot; elapsed-time arithmetic avoids repeated local hours.
  return (Math.floor((now - SCRAPE_OFFSET_MS) / SCRAPE_INTERVAL_MS) + 1) * SCRAPE_INTERVAL_MS + SCRAPE_OFFSET_MS;
}
/** Failed watches skip a slot after repeated failures; healthy watches keep their cadence. */
export function nextWatchCheck(now: number, failures: number): number {
  return nextScrapeCheck(now + (failures >= 2 ? SCRAPE_INTERVAL_MS : 0));
}
