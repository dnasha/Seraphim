// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { browserDelivery } from '@/features/browser-geofence/delivery';
import { NOTIFICATION_KIND, openNotificationEvent, safeNotificationUrl } from '@/lib/pwa/notificationRoutes';
import { id } from './fixtures/browserGeofence';
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
function browser(permission:NotificationPermission='default') {
  const notification={permission,requestPermission:vi.fn(async()=>{notification.permission='granted';return 'granted' as const;})};
  vi.stubGlobal('Notification',notification);vi.stubGlobal('isSecureContext',true);
  const showNotification=vi.fn(async()=>{}),close=vi.fn();
  const reg={active:{},showNotification,getNotifications:vi.fn(async()=>[{close}])};
  vi.stubGlobal('navigator',{locks:{},serviceWorker:{getRegistration:vi.fn(async()=>reg)}});
  return {notification,reg,close};
}
describe('explicit opt-in delivery',()=>{
  it('never prompts when inspected, prompts once for an explicit request, and uses private generic SW payloads',async()=>{
    const b=browser();const adapter=browserDelivery();expect(await adapter.inspect()).toBe('default');expect(b.notification.requestPermission).not.toHaveBeenCalled();
    expect(await adapter.requestPermission()).toBe('granted');await adapter.requestPermission();expect(b.notification.requestPermission).toHaveBeenCalledTimes(1);
    await adapter.deliver({ids:[id(1),id(2)]},new AbortController().signal);
    expect(b.reg.showNotification).toHaveBeenCalledWith('Seraphim activity',expect.objectContaining({tag:NOTIFICATION_KIND,data:{kind:NOTIFICATION_KIND,url:`/?eventId=${id(1)}`}}));
    const payload=JSON.stringify(b.reg.showNotification.mock.calls);expect(payload).not.toMatch(/Private region|headline|notes/);
    await adapter.clear();expect(b.close).toHaveBeenCalledOnce();
  });
  it('does not repeatedly request denied permission and handles missing registration',async()=>{
    const b=browser('denied');expect(await browserDelivery().requestPermission()).toBe('denied');expect(b.notification.requestPermission).not.toHaveBeenCalled();
    b.notification.permission='granted';vi.stubGlobal('navigator',{locks:{},serviceWorker:{getRegistration:vi.fn(async()=>undefined)}});
    expect(await browserDelivery().inspect()).toBe('missing-registration');
    await expect(browserDelivery().deliver({ids:[id(1)]},new AbortController().signal)).rejects.toThrow();
  });
  it('handles insecure/unsupported environments and browser errors without prompting',async()=>{
    const b=browser();vi.stubGlobal('isSecureContext',false);expect(await browserDelivery().requestPermission()).toBe('insecure');
    vi.stubGlobal('isSecureContext',true);vi.stubGlobal('navigator',{});expect(await browserDelivery().inspect()).toBe('unsupported');
    expect(b.notification.requestPermission).not.toHaveBeenCalled();browser();
    vi.mocked(Notification.requestPermission).mockRejectedValueOnce(new Error('browser error'));expect(await browserDelivery().requestPermission()).toBe('failed');
  });
  it('checks cancellation and revocation just before delivery',async()=>{
    const b=browser('granted');const signal=new AbortController();signal.abort();await expect(browserDelivery().deliver({ids:[id(1)]},signal.signal)).rejects.toThrow();
    b.notification.permission='denied';await expect(browserDelivery().deliver({ids:[id(1)]},new AbortController().signal)).rejects.toThrow();expect(b.reg.showNotification).not.toHaveBeenCalled();
  });
});

describe('notification event routes',()=>{
  const origin='https://seraphim.example';
  it.each(['https://evil.example/','//evil.example/','javascript:alert(1)','/?eventId=cluster-z1-x',`/?eventId=${id(1)}&region=secret`,`/?eventId=${id(1)}#bad`, '/account','/?eventId=%2F%2Fevil.example'])('rejects %s',url=>expect(safeNotificationUrl(url,origin)).toBeNull());
  it('opens or focuses only validated same-origin event URLs',async()=>{
    const focus=vi.fn(async()=>{});const navigate=vi.fn(async()=>({focus}));
    const clients={matchAll:vi.fn(async()=>[{url:origin+'/',navigate}]),openWindow:vi.fn(async()=>null)} as unknown as Pick<Clients,'matchAll'|'openWindow'>;
    const payload={kind:NOTIFICATION_KIND,url:`/?eventId=${id(1)}`};
    await openNotificationEvent(payload,origin,clients);expect(navigate).toHaveBeenCalledWith(origin+payload.url);expect(focus).toHaveBeenCalledOnce();expect(clients.openWindow).not.toHaveBeenCalled();
    vi.mocked(clients.matchAll).mockResolvedValue([]);await openNotificationEvent(payload,origin,clients);expect(clients.openWindow).toHaveBeenCalledWith(origin+payload.url);
    vi.mocked(clients.openWindow).mockClear();await openNotificationEvent({...payload,url:'//evil.example'},origin,clients);await openNotificationEvent({...payload,kind:'other'},origin,clients);expect(clients.openWindow).not.toHaveBeenCalled();
  });
});
