/** Loopback-only production-artifact QA. Real worker, synthetic clicks, no OS notifications or external services. */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const base = new URL(process.env.SERAPHIM_QA_BASE_URL ?? 'http://127.0.0.1:4175');
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(base.hostname), 'QA must target loopback only');
const screenshots = process.env.QA_SCREENSHOTS ?? '/tmp/geofence-production-qa';
await mkdir(screenshots, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox'] });
const id = n => `11111111-1111-4111-8111-${String(n).padStart(12, '0')}`;
const report = {};
try {
  const context = await browser.newContext();
  let offlineMode = false;
  await context.route('**/*', async route => {
    if (offlineMode) return route.abort();
    const url = new URL(route.request().url());
    if (url.origin !== base.origin) return route.abort();
    if (url.pathname.startsWith('/api/')) return route.fulfill({ status: 200, contentType: 'application/json', body: '{"fixture":"network"}', headers: { 'Cache-Control': 'no-store' } });
    return route.continue();
  });
  const page = await context.newPage();
  await page.goto(`${base.origin}/manifest.json`);
  await page.evaluate(async () => {
    for (const name of ['apis', 'pages', 'pages-rsc', 'next-static-js-assets', 'serwist-obsolete']) {
      await (await caches.open(name)).put('/api/qa-private', new Response('LEGACY_PRIVATE'));
    }
    await (await caches.open('public-news-images')).put('/api/news-image/qa-public', new Response('PUBLIC_THUMBNAIL'));
  });
  await page.goto(`${base.origin}/privacy`);
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, { timeout: 30_000 });
  const registration = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration('/');
    return { scope: reg.scope, active: reg.active.scriptURL, state: reg.active.state };
  });
  assert.equal(registration.active, `${base.origin}/sw.js`);
  assert.equal(registration.state, 'activated');
  const served = await page.evaluate(async () => {
    const response = await fetch('/sw.js');
    return { source: await response.text(), cache: response.headers.get('cache-control'), scope: response.headers.get('service-worker-allowed') };
  });
  assert.ok(served.source.includes('notificationclick'));
  assert.ok(served.cache.includes('no-store'));assert.equal(served.scope, '/');
  const keys = await page.evaluate(() => caches.keys());
  for (const key of ['apis', 'pages', 'pages-rsc', 'next-static-js-assets', 'serwist-obsolete']) assert.ok(!keys.includes(key));
  assert.ok(keys.includes('public-news-images'));
  const worker = context.serviceWorkers().find(worker => worker.url() === `${base.origin}/sw.js`);
  assert.ok(worker);
  // Dispatch synthetic events into the actual compiled worker, replacing only
  // window-opening APIs. Never call showNotification or request real permission.
  const clicks = await worker.evaluate(async ({ origin, eventId }) => {
    const opened = [];let closed = 0;
    const matchAll = self.clients.matchAll;const openWindow = self.clients.openWindow;
    self.clients.matchAll = async () => [];
    self.clients.openWindow = async url => { opened.push(url);return null; };
    try {
      for (const url of [`/?eventId=${eventId}`, '//attacker.invalid/', `/?eventId=${eventId}&region=private`]) {
        let pending;
        const event = new Event('notificationclick');
        event.notification = { data: { kind: 'seraphim-geofence-v1', url }, close: () => { closed++; } };
        event.waitUntil = promise => { pending = promise; };
        self.dispatchEvent(event);if (!pending) throw new Error('Compiled click listener absent');
        await pending;
      }
    } finally { self.clients.matchAll = matchAll;self.clients.openWindow = openWindow; }
    return { opened, closed, origin };
  }, { origin: base.origin, eventId: id(1) });
  assert.deepEqual(clicks.opened, [`${base.origin}/?eventId=${id(1)}`]);assert.equal(clicks.closed, 3);
  await page.evaluate(async () => {
    await fetch('/api/qa-private');
    await fetch('/privacy?qa-rsc=1', { headers: { RSC: '1', 'Next-Router-Prefetch': '1' } });
  });
  const chunk = await page.locator('script[src*="/_next/static/chunks/"]').first().getAttribute('src');
  assert.ok(chunk);
  await page.evaluate(async chunk => {
    await fetch(chunk);
    const forbidden = ['/api/qa-private', '/privacy?qa-rsc=1', chunk];
    for (const key of await caches.keys()) for (const request of await (await caches.open(key)).keys()) {
      if (forbidden.includes(new URL(request.url).pathname + new URL(request.url).search)) throw new Error(`Private/volatile response cached in ${key}`);
    }
    await (await caches.open('apis')).put('/api/qa-private', new Response('PRIVATE_FALLBACK'));
    await (await caches.open('pages-rsc')).put('/privacy?qa-rsc=1', new Response('RSC_FALLBACK'));
    await (await caches.open('next-static-js-assets')).put(chunk, new Response('CHUNK_FALLBACK'));
    await (await caches.open('pages')).put('/privacy', new Response('<h1>PRIVATE_NAVIGATION_FALLBACK</h1>', { headers: { 'Content-Type': 'text/html' } }));
  }, chunk);
  offlineMode = true;await context.setOffline(true);
  const offline = await page.evaluate(async chunk => {
    const results = [];
    for (const url of ['/api/qa-private', '/privacy?qa-rsc=1', chunk]) {
      try { results.push(await (await fetch(url)).text()); } catch { results.push('NETWORK_FAILED'); }
    }
    return { results, thumbnail: await (await fetch('/api/news-image/qa-public')).text() };
  }, chunk);
  assert.deepEqual(offline.results, ['NETWORK_FAILED', 'NETWORK_FAILED', 'NETWORK_FAILED']);
  assert.equal(offline.thumbnail, 'PUBLIC_THUMBNAIL');
  const navigationFailed = await page.goto(`${base.origin}/privacy`).then(() => false, () => true);
  assert.equal(navigationFailed, true, 'Offline navigation must not use a cached page');
  offlineMode = false;await context.setOffline(false);
  report.worker = { ...registration, compiledClicks: clicks.opened.length, unsafeClicksRejected: 2, privateRscChunksNetworkOnly: true, navigationsNetworkOnly: true, publicThumbnailRetained: true, legacyCachesPurged: true };
  console.log('Production worker checks passed:', JSON.stringify(report.worker));
  await context.close();

  // Exercise the real production dashboard at desktop and mobile widths. Auth,
  // profile and news are fixtures; SW registration remains native. Display is
  // mocked on the registration prototype, ensuring zero actual OS delivery.
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    let now = Date.now();let rows = [1];const queries = [];
    const user = { id: id(999), email: 'fixture@example.invalid', role: 'authenticated', aud: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: new Date(now).toISOString() };
    const ctx = await browser.newContext({ viewport });
    await ctx.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin === 'https://supabase.invalid') {
        if (url.pathname === '/auth/v1/user') return route.fulfill({ json: user });
        if (url.pathname.startsWith('/rest/v1/user_preferences')) return route.fulfill({ json: { preferences: {} } });
        return route.abort();
      }
      if (url.origin !== base.origin) return route.abort();
      if (url.pathname === '/api/account/profile') return route.fulfill({ json: { effectiveTier: 'free', tierSource: 'billing' }, headers: { 'Cache-Control': 'no-store' } });
      if (url.pathname === '/api/news') {
        queries.push(url.href);
        return route.fulfill({ json: { items: rows.map(n => ({ id: id(n), title: `Fixture event ${n}`, url: 'https://example.invalid/', source: 'Fixture', sourceType: 'rss', category: 'crisis', longitude: 12, latitude: 48, credibilityTier: 2, sourcesCount: 1, publishedAt: new Date(now - 12 * 60 * 60_000).toISOString() })), lastUpdated: new Date(now).toISOString(), meta: { view: url.searchParams.get('view') ?? 'sidebar', scope: url.searchParams.get('scope') ?? 'viewport', sort: 'new', clustered: false, stale: false, isCapped: false } }, headers: { 'Cache-Control': 'no-store' } });
      }
      if (url.pathname.startsWith('/api/')) return route.fulfill({ status: 200, json: {} });
      // The server remains a guest during QA. Its auth proxy must not attempt
      // verification of the synthetic browser session with any external service.
      return route.continue({ headers: { ...route.request().headers(), cookie: '' } });
    });
    const fixtureSession = { access_token: 'fixture-placeholder', refresh_token: 'fixture-placeholder', expires_at: Math.floor(now / 1000) + 86400, expires_in: 86400, token_type: 'bearer', user };
    const cookie = `base64-${Buffer.from(JSON.stringify(fixtureSession)).toString('base64url')}`;
    await ctx.addInitScript(({ now, cookie }) => {
      window.qa = { now, prompts: 0, notifications: [], permission: 'default' };
      Date.now = () => window.qa.now;
      document.cookie = `sb-supabase-auth-token=${cookie}; path=/; SameSite=Lax`;
      Object.defineProperty(Notification, 'permission', { configurable: true, get: () => window.qa.permission });
      Notification.requestPermission = async () => { window.qa.prompts++;window.qa.permission = 'granted';return 'granted'; };
      ServiceWorkerRegistration.prototype.showNotification = async function(title, options) { window.qa.notifications.push({ title, options }); };
      ServiceWorkerRegistration.prototype.getNotifications = async () => [];
    }, { now, cookie });
    const p = await ctx.newPage();const errors = [];p.on('pageerror', error => errors.push(error.message));
    await p.goto(`${base.origin}/?lat=48&lng=12&zoom=5`);
    await p.waitForFunction(() => !!navigator.serviceWorker.controller);
    await p.getByRole('button', { name: 'Essential Only', exact: true }).click();
    if (viewport.width <= 860) await p.getByRole('button', { name: 'Map', exact: true }).click();
    await p.getByRole('button', { name: 'Watch alerts', exact: true }).click();
    const save = p.getByRole('button', { name: 'Save current viewport + filters', exact: true });
    await save.waitFor();await p.waitForFunction(() => ![...document.querySelectorAll('button')].find(b => b.textContent === 'Save current viewport + filters')?.disabled);
    assert.equal(await p.evaluate(() => qa.prompts), 0);
    await save.click();await p.getByRole('button', { name: 'Enable browser notifications', exact: true }).click();
    const key = `seraphim:experiment:browser-geofence:v1:${user.id}`;
    await p.waitForFunction(key => !!JSON.parse(localStorage.getItem(key))?.watches[0]?.checkpoint, key);
    assert.equal(await p.evaluate(() => qa.notifications.length), 0);
    await save.click();await p.waitForFunction(key => JSON.parse(localStorage.getItem(key))?.watches.length === 2, key);
    const advance = async () => {
      now = await p.evaluate(key => JSON.parse(localStorage.getItem(key)).nextCheckAt, key);
      await p.evaluate(now => { qa.now = now;window.dispatchEvent(new Event('focus')); }, now);
      await p.waitForFunction(({ key, now }) => JSON.parse(localStorage.getItem(key)).watches.every(w => w.checkpoint?.checkedAt === now), { key, now });
    };
    await advance();rows = [1, 2];await advance();
    await p.waitForFunction(() => qa.notifications.length === 1);
    rows = [];await advance();rows = [1, 2, 3];await advance();
    await p.waitForFunction(() => qa.notifications.length === 2);
    const result = await p.evaluate(() => ({ prompts: qa.prompts, notifications: qa.notifications, width: document.documentElement.scrollWidth, viewport: innerWidth }));
    assert.equal(result.prompts, 1);assert.equal(result.notifications.length, 2);assert.ok(result.width <= result.viewport);
    assert.ok(!JSON.stringify(result.notifications).includes('Viewport watch'));
    assert.equal(result.notifications[1].options.data.url, `/?eventId=${id(3)}`);
    // Profile refresh can legitimately remount the keyed panel after focus.
    const launcher = p.getByRole('button', { name: /^Watch alerts/ });
    if (await launcher.getAttribute('aria-expanded') === 'false') await launcher.click();
    await p.getByRole('region', { name: 'Watch alerts', exact: true }).evaluate(panel => { panel.scrollTop = 0; });
    await p.screenshot({ path: `${screenshots}/production-${viewport.width}.png` });
    assert.deepEqual(errors, []);
    report[`ui${viewport.width}`] = { prompts: 1, baselineDeliveries: 0, mockedDeliveries: 2, overlapDedup: true, oldReentryQuiet: true, unseenArrivalDelivered: true, noOverflow: true, pageErrors: errors.length, watchReads: queries.filter(q => q.includes('force_raw=true')).length };
    await ctx.close();
  }
  console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); }
