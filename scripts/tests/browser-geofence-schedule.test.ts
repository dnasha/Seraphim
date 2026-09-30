import { expect, it } from 'vitest';
import { DELIVERY_INTERVAL_MS, SCRAPE_INTERVAL_MS, nextScrapeCheck, nextWatchCheck } from '@/features/browser-geofence/schedule';

function inTimezone(timezone: string, check: () => void) {
  const previous = process.env.TZ;
  process.env.TZ = timezone;
  try { check(); }
  finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
}

it('aligns polls with scraper slots, including seconds, slot boundaries, hour and date rollover',()=>{
  for (const [from,to] of [[3,17],[17,32],[31,32],[32,47],[47,62],[59,62]]) {
    const time=Date.UTC(2026,8,30,7,from,30,500);
    expect(nextScrapeCheck(time)).toBe(Date.UTC(2026,8,30,7,to));
  }
  expect(nextScrapeCheck(Date.UTC(2026,8,30,23,58))).toBe(Date.UTC(2026,9,1,0,2));
});
it('backs failed watches off to at most 30 minutes without changing delivery caps',()=>{
  const time=Date.UTC(2026,8,30,7,2);
  expect(nextWatchCheck(time,0)).toBe(nextScrapeCheck(time));
  expect(nextWatchCheck(time,1)).toBe(time+15*60_000);
  for(const failures of [2,3,6])expect(nextWatchCheck(time,failures)).toBe(time+30*60_000);
  expect(DELIVERY_INTERVAL_MS).toBe(5*60_000);
});

it.each([
  ['2026-11-01T06:02:00Z', '2026-11-01T06:17:00Z'],
  ['2026-11-01T05:47:00Z', '2026-11-01T06:02:00Z'],
])('keeps the New York fallback check after %s on its next elapsed-time slot', (from, to) => {
  inTimezone('America/New_York', () => {
    expect(new Date(from).getHours()).toBe(1);
    expect(nextScrapeCheck(Date.parse(from))).toBe(Date.parse(to));
  });
});

it.each(['UTC', 'America/New_York'])('preserves slots and retry bounds through DST transitions in %s', timezone => {
  inTimezone(timezone, () => {
    // Cover both sides of the repeated hour and the missing spring-forward hour,
    // including exact slots, one millisecond before them and sub-minute ticks.
    for (const start of ['2026-11-01T05:00:00Z', '2026-03-08T06:00:00Z']) {
      for (let offset = 0; offset <= 3 * 60 * 60_000; offset += 30_000) {
        for (const fraction of [-1, 0, 1]) {
          const now = Date.parse(start) + offset + fraction;
          const next = nextScrapeCheck(now);
          expect(next).toBeGreaterThan(now);
          expect(next - now).toBeLessThanOrEqual(SCRAPE_INTERVAL_MS);
          expect([2, 17, 32, 47]).toContain(new Date(next).getUTCMinutes());
          expect(next % 60_000).toBe(0);
          for (const failures of [0, 1, 2, 3, 6]) {
            const retry = nextWatchCheck(now, failures);
            // First failure keeps the cadence; repeated failures double its
            // maximum delay to 30 minutes, with no further growth.
            expect(retry).toBe(next + (failures >= 2 ? SCRAPE_INTERVAL_MS : 0));
            expect(retry).toBeGreaterThan(now);
            expect(retry - now).toBeLessThanOrEqual(2 * SCRAPE_INTERVAL_MS);
          }
        }
      }
    }
    expect(nextScrapeCheck(Date.parse('2026-03-08T06:47:00Z'))).toBe(Date.parse('2026-03-08T07:02:00Z'));
  });
});
