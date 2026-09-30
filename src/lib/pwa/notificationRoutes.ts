const EVENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const NOTIFICATION_KIND = 'seraphim-geofence-v1';

export function safeNotificationUrl(value: unknown, origin: string): string | null {
  if (typeof value !== 'string' || value.length > 200 || !value.startsWith('/?eventId=')) return null;
  try {
    const url = new URL(value, origin);
    const id = url.searchParams.get('eventId');
    if (url.origin !== origin || url.pathname !== '/' || url.hash ||
        [...url.searchParams.keys()].length !== 1 || !id || !EVENT_ID.test(id)) return null;
    return `/?eventId=${id}`;
  } catch { return null; }
}

export async function openNotificationEvent(data: unknown, origin: string, clients: Pick<Clients, 'matchAll' | 'openWindow'>) {
  if (!data || typeof data !== 'object') return;
  const payload = data as { kind?: unknown; url?: unknown };
  if (payload.kind !== NOTIFICATION_KIND) return;
  const path = safeNotificationUrl(payload.url, origin);
  if (!path) return;
  const url = new URL(path, origin).href;
  const windows = await clients.matchAll({ type: 'window', includeUncontrolled: true });
  const existing = windows.find(client => {
    try { const current = new URL(client.url); return current.origin === origin && current.pathname === '/'; }
    catch { return false; }
  }) as WindowClient | undefined;
  if (existing) {
    const navigated = await existing.navigate(url);
    if (navigated) { await navigated.focus(); return; }
  }
  await clients.openWindow(url);
}
