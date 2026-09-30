import { NOTIFICATION_KIND, safeNotificationUrl } from '@/lib/pwa/notificationRoutes';
export type DeliveryState = NotificationPermission | 'unsupported' | 'insecure' | 'missing-registration' | 'failed';
export interface DeliveryBatch { ids: string[] }
/** Later email/server push adapters must implement delivery outside this browser polling lifecycle. */
export interface DeliveryAdapter {
  deliver(batch: DeliveryBatch, signal: AbortSignal): Promise<void>;
}
export interface BrowserDeliveryAdapter extends DeliveryAdapter {
  inspect(): Promise<DeliveryState>;
  requestPermission(): Promise<DeliveryState>;
  clear(): Promise<void>;
}
export function browserDelivery(): BrowserDeliveryAdapter {
  const supported = (): DeliveryState | null => {
    if (!window.isSecureContext) return 'insecure';
    if (!('Notification' in window) || !('serviceWorker' in navigator) || !navigator.locks) return 'unsupported';
    return null;
  };
  const registration = async () => {
    const reg = await navigator.serviceWorker.getRegistration('/');
    return reg?.active && typeof reg.showNotification === 'function' ? reg : null;
  };
  return {
    async inspect() {
      const unavailable = supported();
      if (unavailable) return unavailable;
      if (Notification.permission !== 'granted') return Notification.permission;
      try { return await registration() ? 'granted' : 'missing-registration'; } catch { return 'failed'; }
    },
    async requestPermission() {
      const unavailable = supported();
      if (unavailable) return unavailable;
      // This method is invoked exclusively from the user's enable button.
      try {
        if (Notification.permission === 'default') await Notification.requestPermission();
        return this.inspect();
      } catch { return 'failed'; }
    },
    async deliver({ ids }, signal) {
      if (signal.aborted || Notification.permission !== 'granted') throw new Error('Notification delivery stopped.');
      const reg = await registration();
      if (!reg || signal.aborted || Notification.permission !== 'granted') throw new Error('Notification delivery unavailable.');
      const url = safeNotificationUrl(`/?eventId=${ids[0]}`, window.location.origin);
      if (!ids.length || !url) throw new Error('Invalid notification event.');
      await reg.showNotification('Seraphim activity', {
        body: ids.length === 1 ? 'A new event matched a saved watch. Open Seraphim to review.' : `${ids.length} new events matched saved watches. Open Seraphim to review.`,
        tag: NOTIFICATION_KIND,
        data: { kind: NOTIFICATION_KIND, url },
      });
    },
    async clear() {
      if (supported()) return;
      try {
        const reg = await registration();
        const notifications = await reg?.getNotifications({ tag: NOTIFICATION_KIND });
        notifications?.forEach(n => n.close());
      } catch { /* Best effort when the browser has removed the registration. */ }
    },
  };
}
