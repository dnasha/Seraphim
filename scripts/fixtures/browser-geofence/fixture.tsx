import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import BrowserAlerts from '@/features/browser-geofence/BrowserAlerts';
import '@/app/globals.css';

// This harness runs only under Vite. All services and notification delivery are local fixtures.
const fixture = {
  prompts: 0, notifications: [] as { title: string; options: NotificationOptions }[], queries: [] as string[],
  rows: [1], permission: (localStorage.getItem('fixture:notification-permission') ?? 'default') as NotificationPermission,
  capped: false, stale: false, now: Date.now(),
  setAccount: null as null | ((account: string | null) => void),
};
Object.assign(window, { geofenceFixture: fixture });
Date.now = () => fixture.now;
const permissionMock = { get permission() { return fixture.permission; }, async requestPermission() { fixture.prompts++; fixture.permission = 'granted'; localStorage.setItem('fixture:notification-permission', 'granted'); return 'granted'; } };
Object.defineProperty(window, 'Notification', { configurable: true, value: permissionMock });
const registration = {
  active: {},
  async showNotification(title: string, options: NotificationOptions) { fixture.notifications.push({ title, options }); },
  async getNotifications() { return []; },
};
Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { async getRegistration() { return registration; } } });
Object.defineProperty(navigator, 'permissions', { configurable: true, value: { async query() { throw new Error('Fixture permission status uses focus checks.'); } } });
window.fetch = async (input) => {
  const url = String(input);
  if (!url.startsWith('/api/news?')) throw new Error('External requests are disabled in this fixture.');
  fixture.queries.push(url);
  return new Response(JSON.stringify({
    items: fixture.rows.map(n => ({ id: `11111111-1111-4111-8111-${String(n).padStart(12, '0')}`, longitude: 12, latitude: 48, publishedAt: '2026-01-01' })),
    lastUpdated: new Date(fixture.now).toISOString(),
    meta: { view: 'sidebar', scope: 'viewport', clustered: false, stale: fixture.stale, isCapped: fixture.capped },
  }));
};
function FixtureApp() {
  const [account, setAccount] = useState<string | null>('fixture-account-A');
  useEffect(() => {
    fixture.setAccount = setAccount;
    return () => { fixture.setAccount = null; };
  }, []);
  return <>
    <main style={{ padding: 24, maxWidth: 660 }}><h1>Seraphim watch alerts fixture</h1>
      <p>Mock account, viewport and live events. No external services or actual OS notifications.</p>
      <p>Viewport: 5–20° longitude, 40–55° latitude. Filters: crisis, news, all credibility tiers.</p>
      <p>Account: {account ?? 'guest'}</p>
    </main>
    <BrowserAlerts key={account ?? 'guest'} account={account}
      bbox={{ minLat: 40, maxLat: 55, minLng: 5, maxLng: 20 }}
      scope={{ sources: ['news'], categories: ['crisis'], minVolume: 1, credibilityTiers: [1, 2, 3], query: '' }} />
  </>;
}
createRoot(document.getElementById('root')!).render(<FixtureApp />);
