import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAlertSession, type SessionEnvironment } from '@/features/browser-geofence/session';
import { emptyStore, readStore, storageKey, writeStore } from '@/features/browser-geofence/store';
import { SCRAPE_INTERVAL_MS, nextScrapeCheck } from '@/features/browser-geofence/schedule';
import type { BrowserDeliveryAdapter, DeliveryState } from '@/features/browser-geofence/delivery';
import { id, json, news, now, watch } from './fixtures/browserGeofence';

class MemoryStorage implements Storage {
  data = new Map<string,string>();
  get length() { return this.data.size; }
  clear() { this.data.clear(); }
  getItem(key: string) { return this.data.get(key) ?? null; }
  setItem(key: string, value: string) { this.data.set(key,value); }
  removeItem(key: string) { this.data.delete(key); }
  key(n: number) { return [...this.data.keys()][n] ?? null; }
}
function locks(): Pick<LockManager, 'request'> {
  let tail = Promise.resolve();
  return { request: ((_name: string, options: {signal: AbortSignal}, callback: () => Promise<void>) => {
    const task=tail.then(()=>{ options.signal?.throwIfAborted(); return callback(); });
    tail=task.catch(()=>{});return task;
  }) as LockManager['request'] };
}
function setup() {
  let time=now;let active=true;let permission: DeliveryState='granted';let rows=[1];
  const storage=new MemoryStorage();const store=emptyStore();store.enabled=true;store.watches=[watch(1),watch(2)];writeStore(storage,'A',store);
  const adapter: BrowserDeliveryAdapter = { inspect: vi.fn(async()=>permission), requestPermission:vi.fn(async()=>permission),
    deliver:vi.fn(async()=>{}), clear:vi.fn(async()=>{}) };
  const fetcher=vi.fn<typeof fetch>(async()=>json(news(rows)));
  const env: SessionEnvironment={storage,locks:locks(),adapter,fetcher,active:()=>active,now:()=>time,update:vi.fn()};
  return {env,storage,adapter,fetcher,advance:(ms=SCRAPE_INTERVAL_MS)=>{time+=ms;},rows:(r:number[])=>{rows=r;},active:(v:boolean)=>{active=v;},permission:(p:DeliveryState)=>{permission=p;},read:()=>readStore(storage,'A')};
}
afterEach(()=>vi.useRealTimers());

it.each([
  ['2026-11-01T06:02:00Z', '2026-11-01T06:17:00Z'],
  ['2026-11-01T05:47:00Z', '2026-11-01T06:02:00Z'],
])('does not repoll between scraper slots during New York fallback after %s', async (from, to) => {
  const previous = process.env.TZ;
  process.env.TZ = 'America/New_York';
  try {
    const s = setup();
    let time = Date.parse(from);
    s.env.now = () => time;
    const session = createAlertSession('A', s.env);
    await session.tick();
    expect(s.read().nextCheckAt).toBe(Date.parse(to));
    for (let i = 0; i < 3; i++) { time += 30_000; await session.tick(); }
    expect(s.fetcher).toHaveBeenCalledTimes(2); // One baseline per watch only.
    expect(s.adapter.deliver).not.toHaveBeenCalled();
    time = Date.parse(to); s.rows([1, 2]); await session.tick();
    expect(s.fetcher).toHaveBeenCalledTimes(4);
    expect(s.adapter.deliver).toHaveBeenCalledOnce();
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});

describe('browser alert sessions', () => {
  it('baselines each region independently and deduplicates overlap, simultaneous tabs and reloads', async()=>{
    const s=setup();const tab1=createAlertSession('A',s.env),tab2=createAlertSession('A',s.env);
    await Promise.all([tab1.tick(),tab2.tick()]);
    expect(s.fetcher).toHaveBeenCalledTimes(2);expect(s.adapter.deliver).not.toHaveBeenCalled();
    expect(s.read().watches.every(w=>w.checkpoint?.seen[0]===id(1))).toBe(true);
    s.rows([1,2]);s.advance();await Promise.all([tab1.tick(),tab2.tick()]);
    expect(s.adapter.deliver).toHaveBeenCalledTimes(1);expect(s.adapter.deliver).toHaveBeenCalledWith({ids:[id(2)]},expect.any(AbortSignal));
    s.advance();await createAlertSession('A',s.env).tick();expect(s.adapter.deliver).toHaveBeenCalledTimes(1);
    expect(s.adapter.requestPermission).not.toHaveBeenCalled();
  });
  it.each<DeliveryState>(['default','denied','unsupported','insecure','missing-registration','failed'])('pauses on %s without permission prompts or repeated attempts',async state=>{
    const s=setup();s.permission(state);const session=createAlertSession('A',s.env);
    await session.tick();s.advance();await session.tick();
    expect(s.read().enabled).toBe(false);expect(s.fetcher).not.toHaveBeenCalled();
    expect(s.adapter.inspect).toHaveBeenCalledTimes(1);expect(s.adapter.requestPermission).not.toHaveBeenCalled();
  });
  it('detects revoked permission even before the next scrape check',async()=>{
    const s=setup();const session=createAlertSession('A',s.env);await session.tick();
    s.permission('denied');await session.tick();expect(s.read().enabled).toBe(false);expect(s.adapter.deliver).not.toHaveBeenCalled();
  });
  it('keeps previous checkpoint on capped/stale/error reads and backs off boundedly',async()=>{
    const s=setup();const session=createAlertSession('A',s.env);await session.tick();const checkpoint=s.read().watches[0].checkpoint;
    s.advance();s.fetcher.mockImplementation(async()=>json(news([1,2],{isCapped:true})));await session.tick();
    expect(s.read().watches[0].checkpoint).toEqual(checkpoint);expect(s.read().watches[0].state).toBe('incomplete');
    expect(s.read().nextCheckAt).toBe(now+2*SCRAPE_INTERVAL_MS);expect(s.adapter.deliver).not.toHaveBeenCalled();
    s.advance(30*60_000);s.fetcher.mockImplementation(async()=>json({},403));await session.tick();expect(s.read().watches[0].state).toBe('error');
    expect(s.read().watches[0].nextCheckAt).toBe(now+5*SCRAPE_INTERVAL_MS);
  });
  it('skips offline/hidden checks and cancels pending account work without committing results',async()=>{
    const s=setup();const session=createAlertSession('A',s.env);s.active(false);await session.tick();expect(s.fetcher).not.toHaveBeenCalled();
    s.active(true);let resolve!:(response:Response)=>void;s.fetcher.mockImplementation(()=>new Promise(r=>{resolve=r;}));
    const pending=session.tick();await vi.waitFor(()=>expect(s.fetcher).toHaveBeenCalled());
    session.stop();s.active(false);resolve(json(news([1,2])));await pending;
    expect(s.read().watches[0].checkpoint).toBeNull();expect(s.adapter.deliver).not.toHaveBeenCalled();
  });
  it('does not resurrect externally deleted local data when a response arrives late',async()=>{
    const s=setup();const session=createAlertSession('A',s.env);
    let resolve!:(response:Response)=>void;
    s.fetcher.mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));
    const pending=session.tick();await vi.waitFor(()=>expect(s.fetcher).toHaveBeenCalled());
    s.storage.removeItem(storageKey('A'));resolve(json(news()));await pending;
    expect(s.storage.getItem(storageKey('A'))).toBeNull();expect(s.adapter.deliver).not.toHaveBeenCalled();
  });
  it('reserves failed deliveries durably and stops automatic retry loops',async()=>{
    const s=setup();const session=createAlertSession('A',s.env);await session.tick();s.rows([1,2]);s.advance();
    vi.mocked(s.adapter.deliver).mockRejectedValueOnce(new Error('revoked during delivery'));await session.tick();s.advance();await session.tick();
    expect(s.read().enabled).toBe(false);expect(s.read().delivered.some(d=>d.id===id(2))).toBe(true);
    expect(s.adapter.deliver).toHaveBeenCalledTimes(1);
  });
  it('isolates account-owned storage and fails closed when persistence is unavailable',async()=>{
    const s=setup();await createAlertSession('B',s.env).tick();expect(s.fetcher).not.toHaveBeenCalled();
    vi.spyOn(s.storage,'setItem').mockImplementation(()=>{throw new Error('quota');});
    const session=createAlertSession('A',s.env);await session.tick();await session.tick();
    expect(s.fetcher).not.toHaveBeenCalled();expect(s.env.update).toHaveBeenCalledWith(expect.objectContaining({enabled:false}),expect.stringContaining('storage'));
  });
});

it.each([0,1])('preserves healthy watch results when watch %s times out, with independent retry backoff',async slow=>{
  vi.useFakeTimers();const s=setup();const session=createAlertSession('A',s.env);
  const healthy=1-slow;
  // Give the watches distinct search scopes so the fake service can identify them.
  const stored=s.read();stored.watches[slow].scope={...stored.watches[slow].scope,query:'slow'};writeStore(s.storage,'A',stored);
  s.fetcher.mockImplementation(input=>String(input).includes('query=slow')?new Promise<Response>(()=>{}):Promise.resolve(json(news([1]))));
  let pending=session.tick();await vi.advanceTimersByTimeAsync(45_000);await pending;
  expect(s.read().watches[healthy].checkpoint?.seen).toEqual([id(1)]);
  expect(s.read().watches[slow]).toMatchObject({state:'error',failures:1,checkpoint:null,nextCheckAt:nextScrapeCheck(now)});
  expect(s.adapter.deliver).not.toHaveBeenCalled();
  s.advance();
  s.fetcher.mockImplementation(input=>String(input).includes('query=slow')?new Promise<Response>(()=>{}):Promise.resolve(json(news([1,2]))));
  pending=session.tick();await vi.advanceTimersByTimeAsync(45_000);await pending;
  expect(s.read().watches[slow]).toMatchObject({state:'error',failures:2,nextCheckAt:now+3*SCRAPE_INTERVAL_MS});
  expect(s.adapter.deliver).toHaveBeenCalledOnce();
  expect(s.read().watches[healthy].checkpoint?.seen).toEqual([id(1),id(2)]);
  s.advance();s.fetcher.mockClear();s.rows([1,2,3]);
  s.fetcher.mockImplementation(async()=>json(news([1,2,3])));await session.tick();
  expect(s.fetcher).toHaveBeenCalledOnce();expect(s.adapter.deliver).toHaveBeenCalledTimes(2);
  expect(s.read().watches[healthy].failures).toBe(0);
});
it('cancels lifecycle work without converting cancellation into check failures or publishing completed snapshots',async()=>{
  vi.useFakeTimers();const s=setup();const session=createAlertSession('A',s.env);
  s.fetcher.mockImplementationOnce(async()=>json(news())).mockImplementationOnce(()=>new Promise<Response>(()=>{}));
  const pending=session.tick();await vi.advanceTimersByTimeAsync(1);session.cancel();await pending;
  expect(s.read().watches.every(w=>!w.checkpoint&&w.failures===0)).toBe(true);
  expect(s.adapter.deliver).not.toHaveBeenCalled();
});
it('does not restore externally deleted data when delivery rejects after its durable reservation',async()=>{
  const s=setup();const session=createAlertSession('A',s.env);await session.tick();s.rows([1,2]);s.advance();
  let reject!:(error:Error)=>void;
  vi.mocked(s.adapter.deliver).mockImplementation(()=>new Promise((_resolve,r)=>{reject=r;}));
  const pending=session.tick();await vi.waitFor(()=>expect(s.adapter.deliver).toHaveBeenCalled());
  s.storage.removeItem(storageKey('A'));reject(new Error('registration removed'));await pending;
  expect(s.storage.getItem(storageKey('A'))).toBeNull();
});
