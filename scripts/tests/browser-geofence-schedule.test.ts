import { expect, it } from 'vitest';
import { DELIVERY_INTERVAL_MS, nextScrapeCheck, nextWatchCheck } from '@/features/browser-geofence/schedule';

it('aligns polls with scraper slots, including seconds, slot boundaries, hour and date rollover',()=>{
  for (const [from,to] of [[3,17],[17,32],[31,32],[32,47],[47,62],[59,62]]) {
    const time=new Date(2026,8,30,7,from,30,500).getTime();
    expect(nextScrapeCheck(time)).toBe(new Date(2026,8,30,7,to).getTime());
  }
  expect(nextScrapeCheck(new Date(2026,8,30,23,58).getTime())).toBe(new Date(2026,9,1,0,2).getTime());
});
it('backs failed watches off to at most 30 minutes without changing delivery caps',()=>{
  const time=new Date(2026,8,30,7,2).getTime();
  expect(nextWatchCheck(time,0)).toBe(nextScrapeCheck(time));
  expect(nextWatchCheck(time,1)).toBe(time+15*60_000);
  for(const failures of [2,3,6])expect(nextWatchCheck(time,failures)).toBe(time+30*60_000);
  expect(DELIVERY_INTERVAL_MS).toBe(5*60_000);
});
