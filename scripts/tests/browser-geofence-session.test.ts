import { describe, expect, it, vi } from 'vitest';
import { createAlertSession, type SessionEnvironment } from '@/features/browser-geofence/session';
import { emptyStore, POLL_MS, readStore, storageKey, writeStore } from '@/features/browser-geofence/store';
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
  const fetcher=vi.fn(async()=>json(news(rows)));
  const env: SessionEnvironment={storage,locks:locks(),adapter,fetcher,active:()=>active,now:()=>time,update:vi.fn()};
  return {env,storage,adapter,fetcher,advance:(ms=POLL_MS)=>{time+=ms;},rows:(r:number[])=>{rows=r;},active:(v:boolean)=>{active=v;},permission:(p:DeliveryState)=>{permission=p;},read:()=>readStore(storage,'A')};
}

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
    expect(s.read().nextCheckAt).toBe(now+3*POLL_MS);expect(s.adapter.deliver).not.toHaveBeenCalled();
    s.advance(30*60_000);s.fetcher.mockImplementation(async()=>json({},403));await session.tick();expect(s.read().watches[0].state).toBe('error');
    expect(s.read().nextCheckAt).toBeLessThanOrEqual(now+34*60_000+30*60_000);
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
