import { describe, expect, it, vi } from 'vitest';
const worker=vi.hoisted(()=>({ listeners: new Map<string,(event:{notification?:unknown;waitUntil(p:Promise<unknown>):void})=>void>(), options:null as unknown,
  clients:{matchAll:vi.fn(async()=>[]),openWindow:vi.fn(async()=>null)}, caches:{delete:vi.fn(async()=>true)} }));
vi.mock('@serwist/next/worker',()=>({defaultCache:[]}));
vi.mock('serwist',()=>({
  NetworkOnly:class NetworkOnly {},CacheFirst:class CacheFirst {},ExpirationPlugin:class ExpirationPlugin {},
  Serwist:class {constructor(options:unknown){worker.options=options;} addEventListeners(){}},
}));
vi.stubGlobal('self',{location:{origin:'https://seraphim.example'},clients:worker.clients,caches:worker.caches,
  addEventListener:(name:string,listener:(event:{waitUntil(p:Promise<unknown>):void})=>void)=>worker.listeners.set(name,listener)});
await import('@/app/sw');
import { NOTIFICATION_KIND } from '@/lib/pwa/notificationRoutes';
import { id } from './fixtures/browserGeofence';
describe('service worker notification integration',()=>{
  it('retains network-only navigations/private APIs and legacy cache cleanup',async()=>{
    const options=worker.options as {runtimeCaching:{handler:{constructor:{name:string}}}[]};
    expect(options.runtimeCaching.map(rule=>rule.handler.constructor.name)).toEqual(['NetworkOnly','CacheFirst','NetworkOnly']);
    let pending:Promise<unknown>|undefined;
    worker.listeners.get('activate')!({waitUntil:p=>{pending=p;}});await pending;
    expect(worker.caches.delete).toHaveBeenCalledWith('apis');
    expect(worker.listeners.has('push')).toBe(false);
  });
  it('closes notifications and validates the click before opening a same-origin window',async()=>{
    const close=vi.fn();let pending:Promise<unknown>|undefined;
    worker.listeners.get('notificationclick')!({notification:{close,data:{kind:NOTIFICATION_KIND,url:`/?eventId=${id(1)}`}},waitUntil:p=>{pending=p;}});await pending;
    expect(close).toHaveBeenCalledOnce();expect(worker.clients.openWindow).toHaveBeenCalledWith(`https://seraphim.example/?eventId=${id(1)}`);
    worker.clients.openWindow.mockClear();
    worker.listeners.get('notificationclick')!({notification:{close,data:{kind:NOTIFICATION_KIND,url:'//evil.example'}},waitUntil:p=>{pending=p;}});await pending;
    expect(worker.clients.openWindow).not.toHaveBeenCalled();
  });
});
