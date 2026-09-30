import { describe, expect, it, vi } from 'vitest';
import { advanceWatch, fetchWatch, IncompleteCheck, reserveBatch } from '@/features/browser-geofence/checks';
import { containsEvent, validateRegion, viewportRegion } from '@/features/browser-geofence/region';
import { emptyStore, MAX_BYTES, MAX_OBSERVED_IDS, parseStore } from '@/features/browser-geofence/store';
import { DELIVERY_INTERVAL_MS } from '@/features/browser-geofence/schedule';

import { id, scope, now, watch, news, json } from './fixtures/browserGeofence';

describe('local viewport geometry', () => {
  it('splits antimeridian viewports and tests raw coordinates on both sides', () => {
    const region = viewportRegion({ minLat: -10, maxLat: 10, minLng: 170, maxLng: 190 }, 'Dateline', id(1), now);
    expect(region.geometry.type).toBe('MultiPolygon');
    expect(validateRegion(region)).toBe(true);
    expect(containsEvent(region, 179, 0)).toBe(true);
    expect(containsEvent(region, -179, 0)).toBe(true);
    expect(containsEvent(region, 0, 0)).toBe(false);
    expect(viewportRegion({ minLat: -10, maxLat: 10, minLng: 170, maxLng: -170 }, 'Crossing', id(1), now).geometry).toEqual(region.geometry);
  });
  it('validates holes and excludes their membership', () => {
    const region = watch().region;
    region.geometry = { type: 'Polygon', coordinates: [[[0,0],[20,0],[20,20],[0,20],[0,0]], [[5,5],[5,15],[15,15],[15,5],[5,5]]] };
    expect(validateRegion(region)).toBe(true);
    expect(containsEvent(region, 10, 10)).toBe(false);
    expect(containsEvent(region, 1, 1)).toBe(true);
    region.geometry.coordinates[1] = [[19,19],[19,25],[25,25],[25,19],[19,19]];
    expect(validateRegion(region)).toBe(false);
  });
  it('rejects broad, degenerate, malformed and self-intersecting regions', () => {
    expect(() => viewportRegion({minLat:-90,maxLat:90,minLng:-180,maxLng:180}, 'World', id(1), now)).toThrow(/Zoom/);
    expect(() => viewportRegion({minLat:0,maxLat:0,minLng:0,maxLng:20}, 'Flat', id(1), now)).toThrow();
    for (const coordinates of [
      [[[0,0],[20,20],[0,20],[20,0],[0,0]]],
      [[[0,0],[200,0],[20,20],[0,0]]],
      [[[0,0],[20,0],[20,20],[0,20]]],
      [[[0,0],[10,0],[20,0],[0,0]]],
    ]) expect(validateRegion({...watch().region,geometry:{type:'Polygon',coordinates}})).toBe(false);
    expect(validateRegion({...watch().region, geometry:{type:'Polygon',coordinates:[Array(129).fill([0,0])]}})).toBe(false);
  });
});

describe('account storage validation', () => {
  it('bounds watches, checkpoints, ids and storage size and rejects future schemas', () => {
    const store = emptyStore(); store.watches = [watch()];
    expect(parseStore(JSON.stringify(store))).toEqual(store);
    expect(parseStore(null)).toEqual(emptyStore());
    expect(() => parseStore('{bad')).toThrow(/invalid/);
    expect(() => parseStore(JSON.stringify({...store,version:2}))).toThrow(/invalid/);
    expect(() => parseStore(JSON.stringify({...store,watches:[watch(1),watch(2),watch(3),watch(4)]}))).toThrow();
    expect(() => parseStore(JSON.stringify({...store,watches:[{...watch(),checkpoint:{seen:['cluster-z2-foo'],checkedAt:now}}]}))).toThrow();
    expect(() => parseStore(' '.repeat(MAX_BYTES + 1))).toThrow(/quota/);
    expect(() => parseStore(JSON.stringify({...store,watches:[{...watch(),scope:{...scope,query:'x'.repeat(161)}}]}))).toThrow();
  });
});

describe('independent entitled raw reads', () => {
  it('uses bounded viewport/live/filter parameters independently of presentation and excludes nonmembers', async () => {
    const w = watch(); w.scope = {...scope,query:'test',categories:['crisis']};
    const fetcher = vi.fn(async () => json({...news([1,2]),items:[news([1]).items[0],{...news([2]).items[0],longitude:30}]}));
    expect(await fetchWatch(w, new AbortController().signal, fetcher)).toEqual([id(1)]);
    const [url, options] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    const p = new URL(url,'https://seraphim.example').searchParams;
    expect(p.get('force_raw')).toBe('true'); expect(p.get('time_range')).toBe('1d'); expect(p.get('scope')).toBe('viewport');
    expect(p.get('query')).toBe('test'); expect(p.get('categories')).toBe('crisis');
    expect(p.has('until')).toBe(false); expect(p.has('zoom')).toBe(false);
    expect(url).not.toContain('Private'); expect(options.cache).toBe('no-store');
  });
  it.each([{isCapped:true},{stale:true},{clustered:true},{scope:'global'},{view:'map'}])('refuses incomplete metadata %j', async meta => {
    await expect(fetchWatch(watch(),new AbortController().signal,vi.fn(async()=>json(news([1],meta))))).rejects.toBeInstanceOf(IncompleteCheck);
  });
  it('refuses representative clusters, old cache, unknown ids, denied scopes and missing locations', async () => {
    for (const data of [
      {...news(),items:[{...news().items[0],id:'cluster-z1-test',originalId:id(1)}]},
      {...news(),items:[{...news().items[0],storyCount:2}]},
      {...news(),lastUpdated:'2000-01-01'},
      {...news(),items:[{...news().items[0],id:'unsafe'}]},
      {...news(),items:[{id:id(1)}]},
    ]) await expect(fetchWatch(watch(),new AbortController().signal,vi.fn(async()=>json(data)))).rejects.toBeInstanceOf(IncompleteCheck);
    await expect(fetchWatch(watch(),new AbortController().signal,vi.fn(async()=>json({},403)))).rejects.toThrow(/no longer available/);
  });
  it('bounds reads for a split antimeridian watch', async () => {
    const w = watch();w.region=viewportRegion({minLat:-10,maxLat:10,minLng:170,maxLng:190},'Date line',id(2),now);
    const fetcher=vi.fn(async()=>json({...news(),items:[{...news().items[0],longitude:179,latitude:0}]}));
    expect(await fetchWatch(w,new AbortController().signal,fetcher)).toEqual([id(1)]);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});

describe('observation checkpoints and delivery budgets', () => {
  it('never alerts on first check, updated publications or gaps beyond the horizon', () => {
    const baseline = advanceWatch(watch(),[id(1)],now);
    expect(baseline.candidates).toEqual([]);
    expect(advanceWatch(baseline.watch,[id(1),id(2)],now+DELIVERY_INTERVAL_MS).candidates).toEqual([id(2)]);
    expect(advanceWatch(baseline.watch,[id(1),id(2)],now+24*60*60_000).candidates).toEqual([]);
  });
  it('deduplicates overlap/reloads and consumes suppressed bursts without later backlog', () => {
    const store = emptyStore();
    const many=Array.from({length:30},(_,i)=>id(i+1));
    expect(reserveBatch(store,[...many,...many],now)).toHaveLength(20);
    expect(reserveBatch(parseStore(JSON.stringify(store)),many,now+DELIVERY_INTERVAL_MS)).toEqual([]);
    expect(reserveBatch(store,[id(99)],now+1000)).toEqual([]);
    expect(reserveBatch(store,[id(99)],now+DELIVERY_INTERVAL_MS)).toEqual([]);
    expect(reserveBatch(store,[id(100)],now+DELIVERY_INTERVAL_MS)).toEqual([id(100)]);
  });
  it('never evicts recent dedup entries to make room for a burst', () => {
    const store=emptyStore();store.delivered=Array.from({length:3000},(_,i)=>({id:id(i),at:now}));
    expect(reserveBatch(store,[id(5000)],now)).toEqual([]);
    expect(store.delivered).toHaveLength(3000);
  });
});

it('retains quiet baseline identities across disappearance, reload and mutable publication changes',()=>{
  const baseline=advanceWatch(watch(),[id(1)],now);
  const absent=advanceWatch(baseline.watch,[],now+15*60_000);
  expect(absent.watch.checkpoint?.seen).toEqual([]);
  expect(absent.watch.checkpoint?.observed).toEqual([id(1)]);
  const store=emptyStore();store.watches=[absent.watch];
  const returned=advanceWatch(parseStore(JSON.stringify(store)).watches[0],[id(1),id(2)],now+30*60_000);
  expect(returned.candidates).toEqual([id(2)]);
  expect(returned.watch.checkpoint?.observed).toEqual([id(1),id(2)]);
});
it('allows an unseen old-publication arrival after baseline',async()=>{
  const baseline=advanceWatch(watch(),[id(1)],now);
  const ids=await fetchWatch(baseline.watch,new AbortController().signal,async()=>json(news([1,2])));
  expect(advanceWatch(baseline.watch,ids,now+15*60_000).candidates).toEqual([id(2)]);
});
it('pauses at the observed identity quota without evicting history or emitting backlog',()=>{
  const full=watch();full.checkpoint={seen:[],checkedAt:now,observed:Array.from({length:MAX_OBSERVED_IDS},(_,i)=>id(i))};
  const result=advanceWatch(full,[id(9999)],now+15*60_000);
  expect(result.watch).toMatchObject({enabled:false,state:'history-full',checkpoint:full.checkpoint});
  expect(result.candidates).toEqual([]);
});
it('upgrades earlier v1 membership into identity history and rejects oversized histories',()=>{
  const store=emptyStore();const legacy={...watch(),checkpoint:{seen:[id(1)],checkedAt:now}};
  const raw=JSON.stringify({...store,watches:[legacy]});
  expect(parseStore(raw).watches[0].checkpoint?.observed).toEqual([id(1)]);
  expect(()=>parseStore(JSON.stringify({...store,watches:[{...watch(),checkpoint:{...legacy.checkpoint,observed:Array(MAX_OBSERVED_IDS+1).fill(id(1))}}]}))).toThrow(/invalid/);
});
