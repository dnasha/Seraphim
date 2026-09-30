/** Match the dashboard's scraper slots plus its two-minute ingestion buffer. */
export const SCRAPE_INTERVAL_MS = 15 * 60_000;
export const DELIVERY_INTERVAL_MS = 5 * 60_000;
export function nextScrapeCheck(now: number): number {
  const next = new Date(now);
  next.setSeconds(0, 0);
  const minute = [2, 17, 32, 47].find(minute => minute > next.getMinutes());
  if (minute === undefined) next.setHours(next.getHours() + 1, 2, 0, 0);
  else next.setMinutes(minute);
  return next.getTime();
}
/** Failed watches skip a slot after repeated failures; healthy watches keep their cadence. */
export function nextWatchCheck(now: number, failures: number): number {
  return nextScrapeCheck(now + (failures >= 2 ? SCRAPE_INTERVAL_MS : 0));
}
