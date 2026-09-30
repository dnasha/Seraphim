/** All six compiled dashboard features, loopback-only services, native worker,
 * and intercepted OS delivery. No fixture module is added to the application. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer, request as httpRequest } from 'node:http';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const artifact = new URL(process.env.SERAPHIM_QA_BASE_URL || 'http://127.0.0.1:4175');
assert(['localhost', '127.0.0.1', '[::1]'].includes(artifact.hostname), 'Loopback QA only');
const output = 'artifacts/combined-six/served';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
const id = n => `22222222-2222-4222-8222-${String(n).padStart(12, '0')}`;
const results = [], servers = [];
try {
    for (const [name, viewport] of [['desktop', { width: 1440, height: 900 }], ['mobile', { width: 390, height: 844 }]]) {
        const mobile = name === 'mobile', user = { id: id(999), email: 'fixture@example.invalid', role: 'authenticated', aud: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() };
        let now = Date.now(), tier = 'analyst', raw = [1], revision = 0;
        const published = n => new Date(now - [20, 12, 1][(n - 1) % 3] * 3_600_000).toISOString();
        const row = n => ({ id: id(n), title: `Served synthetic event ${n}`, source: 'Fixture', sourceType: 'rss',
            url: `https://example.invalid/event-${n}`, category: 'crisis', longitude: 12, latitude: 48,
            credibilityTier: 2, sourcesCount: 1, storyCount: 1, publishedAt: published(n) });
        const reads = [], serviceReads = [];
        // Network-only worker fetches can bypass Playwright page routes. A
        // loopback service boundary mocks APIs for both window and worker while
        // forwarding the unchanged Next artifact, stripping synthetic cookies.
        const proxy = createServer((request, response) => {
            if (!request.url?.startsWith('/') || request.url.startsWith('//')) { response.writeHead(400); response.end('Path required'); return; }
            const url = new URL(request.url, 'http://127.0.0.1');
            if (url.pathname.startsWith('/api/')) serviceReads.push(url.pathname + url.search);
            const json = (body, status = 200) => { response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(body)); };
            if (url.pathname === '/api/account/profile') return json({ effectiveTier: tier, tierSource: 'billing' });
            if (url.pathname === '/api/analyst/access') return json({ userId: user.id, tier }, tier === 'analyst' ? 200 : 403);
            if (url.pathname === '/api/news') {
                const scope = Object.fromEntries(url.searchParams), independent = scope.force_raw === 'true' && scope.view === 'sidebar'; reads.push(scope);
                return json({ items: (independent ? raw : [1, 2, 3]).map(row), lastUpdated: new Date(now).toISOString(),
                    meta: { view: scope.view ?? 'sidebar', scope: scope.scope ?? 'viewport', sort: scope.sort ?? 'new', clustered: false, stale: false, isCapped: false, appliedLimit: Number(scope.limit || 1000) } });
            }
            if (url.pathname.startsWith('/api/news/22222222-2222-4222-8222-')) {
                const n = Number(url.pathname.slice(-12)), event = row(n);
                if (url.searchParams.get('evidence') === 'true') event.title = `Current exact served detail ${revision}`;
                return json({ event, sources: [{ name: 'Fixture source', url: event.url, source_type: 'rss', discovered_at: event.publishedAt }], totalSources: 1, timelineRestricted: false });
            }
            if (url.pathname.startsWith('/api/map-style/')) return json({ version: 8, glyphs: `${base.origin}/qa-glyphs/{fontstack}/{range}.pbf`, sources: {}, layers: [{ id: 'synthetic-background', type: 'background', paint: { 'background-color': '#e5e9ee' } }] });
            if (url.pathname.startsWith('/qa-glyphs/')) { response.writeHead(200, { 'Content-Type': 'application/octet-stream' }); return response.end(); }
            if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/_vercel/')) return json({});
            const upstream = httpRequest(new URL(request.url, artifact), { method: request.method, headers: { ...request.headers, host: artifact.host, cookie: '' } }, served => {
                response.writeHead(served.statusCode, served.headers); served.pipe(response);
            });
            upstream.on('error', error => { response.writeHead(503); response.end(error.message); }); request.pipe(upstream);
        });
        servers.push(proxy); await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
        const base = new URL(`http://127.0.0.1:${proxy.address().port}`);
        const ctx = await browser.newContext({ viewport, timezoneId: 'America/New_York', isMobile: mobile, hasTouch: mobile });
        const p = await ctx.newPage(), errors = [], forbidden = [];
        p.on('pageerror', error => errors.push(error.message));
        await ctx.route('**/*', async route => {
            const url = new URL(route.request().url());
            if (url.origin === 'https://supabase.invalid') {
                if (url.pathname === '/auth/v1/user') return route.fulfill({ json: user });
                if (url.pathname.startsWith('/rest/v1/user_preferences')) return route.fulfill({ json: { preferences: {} } });
                forbidden.push(url.href); return route.abort();
            }
            // Initial public vector style is replaced through the actual settings
            // UI below. These empty synthetic resources prevent provider calls.
            if (['tiles.seraphi.me', 'tiles.openstreetmap.us'].includes(url.hostname)) return route.fulfill({ status: 200, contentType: 'application/octet-stream', body: Buffer.alloc(0) });
            if (url.hostname === 'protomaps.github.io') return route.fulfill(url.pathname.endsWith('.json')
                ? { json: {} } : { contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64') });
            if (url.href === 'https://api.maptiler.com/resources/logo.svg') return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>' });
            if (url.origin !== base.origin) { forbidden.push(url.href); return route.abort(); }
            // Browser session is synthetic; SSR/proxy remains a guest and never
            // tries to verify this placeholder token against an external auth.
            return route.continue({ headers: { ...route.request().headers(), cookie: '' } });
        });
        const session = { access_token: 'fixture-placeholder', refresh_token: 'fixture-placeholder', expires_at: Math.floor(now / 1000) + 86400, expires_in: 86400, token_type: 'bearer', user };
        const cookie = `base64-${Buffer.from(JSON.stringify(session)).toString('base64url')}`;
        await ctx.addInitScript(({ now, cookie }) => {
            window.qa = { now, prompts: 0, deliveries: [], permission: 'default' };
            Date.now = () => qa.now;
            document.cookie = `sb-supabase-auth-token=${cookie}; path=/; SameSite=Lax`;
            localStorage.setItem('seraphim_cookie_consent', 'essential'); localStorage.setItem('seraphim_seen_overlays', 'true');
            Object.defineProperty(Notification, 'permission', { configurable: true, get: () => qa.permission });
            Notification.requestPermission = async () => { qa.prompts++; qa.permission = 'granted'; return 'granted'; };
            ServiceWorkerRegistration.prototype.showNotification = async (title, options) => { qa.deliveries.push({ title, options }); };
            ServiceWorkerRegistration.prototype.getNotifications = async () => [];
        }, { now, cookie });
        await p.goto(`${base.origin}/privacy`);
        await p.waitForFunction(() => !!navigator.serviceWorker.controller);
        const activeWorker = ctx.serviceWorkers().find(worker => worker.url() === `${base.origin}/sw.js`);
        assert(activeWorker);
        // The worker remains compiled/native. Mock its external service inputs
        // as well as page routes; otherwise network-only requests can bypass
        // page interception. Cache invariants are tested without this shim by
        // verify-production.mjs in a separate fresh context.
        await activeWorker.evaluate(({ origin, user }) => {
            const realFetch = self.fetch.bind(self); self.qaForbidden = [];
            self.fetch = async (input, init) => {
                const url = new URL(input instanceof Request ? input.url : String(input), self.location.href);
                if (url.origin === origin) return realFetch(input, init);
                if (url.origin === 'https://supabase.invalid' && url.pathname === '/auth/v1/user') return Response.json(user);
                if (url.origin === 'https://supabase.invalid' && url.pathname.startsWith('/rest/v1/user_preferences')) return Response.json({ preferences: {} });
                if (['tiles.seraphi.me', 'tiles.openstreetmap.us'].includes(url.hostname)) return new Response(new Uint8Array(), { headers: { 'Content-Type': 'application/octet-stream' } });
                if (url.hostname === 'protomaps.github.io') return url.pathname.endsWith('.json') ? Response.json({}) : new Response(Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='), character => character.charCodeAt(0)), { headers: { 'Content-Type': 'image/png' } });
                if (url.href === 'https://api.maptiler.com/resources/logo.svg') return new Response('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>', { headers: { 'Content-Type': 'image/svg+xml' } });
                self.qaForbidden.push(url.href); throw new Error('External request forbidden in served QA');
            };
        }, { origin: base.origin, user });
        await p.goto(`${base.origin}/?lat=48&lng=12&zoom=5&t=1d&s=new`);
        if (await p.getByRole('button', { name: 'Essential Only', exact: true }).isVisible()) await p.getByRole('button', { name: 'Essential Only', exact: true }).click();
        if (mobile) await p.getByRole('button', { name: 'Map', exact: true }).click();
        // Synthetic responses can settle before React commits the initial user
        // ref. Exercise the normal, throttled profile focus revalidation once.
        await p.waitForFunction(() => document.body.textContent.includes('Served synthetic event'));
        now += 31_000; await p.evaluate(now => { qa.now = now; window.dispatchEvent(new Event('focus')); }, now);
        await p.getByRole('button', { name: 'Freeze loaded view', exact: true }).waitFor().catch(async error => {
            await p.screenshot({ path: `${output}/${name}-startup-failure.png` });
            await writeFile(`${output}/${name}-startup-failure.txt`, JSON.stringify({ body: await p.locator('body').innerText(), reads, serviceReads, errors, forbidden }, null, 2));
            throw error;
        });
        await p.getByRole('button', { name: 'Map settings', exact: true }).click();
        await p.getByRole('button', { name: 'Satellite', exact: true }).click();
        await p.getByRole('switch', { name: 'Activity heatmap', exact: true }).click();
        await p.getByLabel('Activity density legend').getByText('3 displayed points', { exact: true }).waitFor();
        await p.getByRole('button', { name: 'Map settings', exact: true }).click();
        await p.getByRole('button', { name: 'Freeze loaded view', exact: true }).click();
        const slider = p.getByRole('slider', { name: 'Reporting cursor' });
        await slider.focus(); await slider.press('Home');
        await p.getByLabel('Activity density legend').getByText('No located stories in the displayed data.', { exact: true }).waitFor();
        await p.getByRole('button', { name: 'Region checkpoints', exact: true }).click();
        const region = p.getByRole('region', { name: 'Region checkpoints', exact: true });
        await region.getByLabel('Region name', { exact: true }).fill(`Served ${name} region`);
        await region.getByRole('button', { name: 'Save viewport', exact: true }).click();
        await region.getByRole('button', { name: `Served ${name} region`, exact: true }).click();
        await region.getByRole('button', { name: 'Check changes', exact: true }).click();
        await region.getByText(/Baseline saved/).waitFor();
        const regionKey = `seraphim:experiment:region-checkpoints:v1:${user.id}`;
        const baseline = () => p.evaluate(key => JSON.parse(localStorage.getItem(key)).regions[0].baseline, regionKey);
        assert.equal((await baseline()).events.length, 1);
        raw = [1, 2]; await region.getByRole('button', { name: 'Check changes', exact: true }).click();
        await region.getByText('Newly observed event', { exact: true }).waitFor();
        await region.getByRole('button', { name: 'Mark reviewed', exact: true }).click();
        const reviewed = await baseline(); assert.equal(reviewed.events.length, 2);
        await region.getByRole('button', { name: 'Close region checkpoints', exact: true }).click();
        await p.getByRole('button', { name: 'Watch alerts', exact: true }).click();
        const alerts = p.getByRole('region', { name: 'Watch alerts', exact: true });
        assert.equal(await p.evaluate(() => qa.prompts), 0);
        await alerts.getByRole('button', { name: 'Save current viewport + filters', exact: true }).click();
        await alerts.getByRole('button', { name: 'Enable browser notifications', exact: true }).click();
        const watchKey = `seraphim:experiment:browser-geofence:v1:${user.id}`;
        await p.waitForFunction(key => JSON.parse(localStorage.getItem(key))?.watches[0]?.checkpoint?.seen.length === 2, watchKey);
        assert.equal(await p.evaluate(() => qa.deliveries.length), 0);
        now = await p.evaluate(key => JSON.parse(localStorage.getItem(key)).nextCheckAt, watchKey);
        assert([2, 17, 32, 47].includes(new Date(now).getUTCMinutes())); raw = [1, 2, 3];
        await p.evaluate(now => { qa.now = now; window.dispatchEvent(new Event('focus')); }, now);
        await p.waitForFunction(() => qa.deliveries.length === 1);
        assert.deepEqual(await baseline(), reviewed);
        assert.equal(await p.evaluate(() => qa.prompts), 1);
        await p.getByLabel('Activity density legend').getByText('No located stories in the displayed data.', { exact: true }).waitFor();
        if (await p.getByRole('button', { name: 'Watch alerts', exact: true }).getAttribute('aria-expanded') === 'false') await p.getByRole('button', { name: 'Watch alerts', exact: true }).click();
        await alerts.getByRole('button', { name: 'Pause all checks', exact: true }).click();
        await alerts.getByRole('button', { name: 'Close watch alerts', exact: true }).click();
        await slider.focus(); await slider.press('End');
        await p.getByLabel('Activity density legend').getByText('3 displayed points', { exact: true }).waitFor();
        await p.screenshot({ path: `${output}/${name}-compiled-replay-heatmap.png` });
        const canvas = p.locator('.maplibregl-canvas'), box = await canvas.boundingBox();
        await canvas.click({ position: { x: box.width / 2, y: box.height / 2 } });
        await p.waitForFunction(() => !!new URL(location.href).searchParams.get('eventId'));
        const selected = new URL(p.url()).searchParams.get('eventId'); assert.equal(selected, id(1));
        await p.locator('.maplibregl-popup-close-button').click();
        await p.waitForFunction(() => !new URL(location.href).searchParams.has('eventId'));
        const beforeDraw = p.url();
        await p.getByRole('button', { name: 'Draw & Measure', exact: true }).click();
        await p.getByRole('button', { name: 'Close drawing tools', exact: true }).waitFor();
        if (mobile) await p.getByRole('button', { name: 'Expand panel', exact: true }).waitFor();
        if (await p.getByRole('button', { name: 'Expand panel', exact: true }).isVisible()) await p.getByRole('button', { name: 'Expand panel', exact: true }).click();
        await p.getByRole('button', { name: 'Pin', exact: true }).click();
        await p.getByRole('button', { name: 'Collapse panel', exact: true }).click();
        await canvas.click({ position: { x: box.width / 2, y: box.height / 2 } });
        await p.getByRole('button', { name: 'Expand panel', exact: true }).click();
        const drawingKey = `seraphim-experiment-drawing-history-v2:${user.id}`;
        await p.waitForFunction(key => JSON.parse(localStorage.getItem(key))?.drawFeatures.length === 1, drawingKey);
        assert.equal(p.url(), beforeDraw);
        const pin = await p.evaluate(key => JSON.parse(localStorage.getItem(key)), drawingKey);
        await p.getByRole('button', { name: 'Undo', exact: true }).click(); await p.waitForFunction(key => !localStorage.getItem(key), drawingKey);
        await p.getByRole('button', { name: 'Redo', exact: true }).click(); await p.waitForFunction(key => !!localStorage.getItem(key), drawingKey);
        assert.deepEqual(await p.evaluate(key => JSON.parse(localStorage.getItem(key)), drawingKey), pin);
        await p.getByRole('button', { name: 'Clear', exact: true }).click(); await p.waitForFunction(key => !localStorage.getItem(key), drawingKey);
        await p.getByRole('button', { name: 'Close drawing tools', exact: true }).click();
        await canvas.click({ position: { x: box.width / 2, y: box.height / 2 } });
        await p.waitForFunction(id => new URL(location.href).searchParams.get('eventId') === id, selected);
        if (mobile) await p.getByRole('button', { name: 'Stories', exact: true }).click();
        await p.getByRole('button', { name: /^Evidence workspace/ }).click();
        const workspace = p.getByRole('dialog', { name: 'Evidence workspace', exact: true });
        await workspace.getByRole('button', { name: 'Toggle active event in evidence selection', exact: true }).click();
        await workspace.getByRole('textbox', { name: /^Private note for/ }).fill('Private served fixture note');
        await workspace.getByRole('button', { name: 'Capture selected events', exact: true }).click();
        await workspace.getByRole('button', { name: 'Download JSON', exact: true }).waitFor();
        const downloadJson = async () => {
            const pending = p.waitForEvent('download'); await workspace.getByRole('button', { name: 'Download JSON', exact: true }).click();
            const stream = await (await pending).createReadStream(), chunks = []; for await (const chunk of stream) chunks.push(chunk);
            return JSON.parse(Buffer.concat(chunks).toString());
        };
        const packet = await downloadJson(); assert.equal(packet.packet.entries[0].event.title, 'Current exact served detail 0');
        assert(packet.packet.scope.reportingReplay); assert.equal(packet.notesIncluded, false); assert(!JSON.stringify(packet).includes('Private served fixture note'));
        assert.match(packet.packet.disclaimer, /not event state at the replay cursor/);
        await p.screenshot({ path: `${output}/${name}-compiled-evidence.png` });
        await p.keyboard.press('Escape'); await workspace.waitFor({ state: 'hidden' }); assert.equal(new URL(p.url()).searchParams.get('eventId'), selected);
        if (mobile) await p.getByRole('button', { name: 'Map', exact: true }).click();
        await slider.focus(); await slider.press('Home'); revision = 1;
        if (mobile) await p.getByRole('button', { name: 'Stories', exact: true }).click();
        await p.getByRole('button', { name: /^Evidence workspace/ }).click(); assert.deepEqual((await downloadJson()).packet, packet.packet);
        await workspace.getByRole('checkbox', { name: 'Include private notes in this export', exact: true }).check(); assert.equal((await downloadJson()).privateNotes[selected], 'Private served fixture note');
        await workspace.getByRole('button', { name: 'Close evidence workspace', exact: true }).click();
        if (mobile) await p.getByRole('button', { name: 'Map', exact: true }).click();
        await p.getByRole('button', { name: 'Return live', exact: true }).click();
        await p.getByRole('button', { name: 'Freeze loaded view', exact: true }).click();
        if (mobile) await p.getByRole('button', { name: 'Stories', exact: true }).click();
        await p.getByRole('button', { name: /^Evidence workspace/ }).click();
        tier = 'free'; now += 31_000;
        await p.evaluate(now => { qa.now = now; window.dispatchEvent(new Event('focus')); }, now);
        await workspace.waitFor({ state: 'hidden' });
        await p.getByRole('button', { name: /^Evidence workspace/ }).click();
        await workspace.getByRole('heading', { name: 'Analyst or Angel access required', exact: true }).waitFor();
        assert.equal(await workspace.getByRole('button', { name: 'Download JSON', exact: true }).count(), 0);
        await workspace.getByRole('button', { name: 'Close evidence workspace', exact: true }).click();
        if (mobile) await p.getByRole('button', { name: 'Map', exact: true }).click();
        await p.getByRole('button', { name: 'Replay · Pro', exact: true }).waitFor();
        assert.equal(await p.getByRole('button', { name: 'Replay · Pro', exact: true }).isDisabled(), true);
        assert.equal(await p.getByRole('slider', { name: 'Reporting cursor' }).count(), 0);
        assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        assert.deepEqual(forbidden, []); assert.deepEqual(await activeWorker.evaluate(() => self.qaForbidden), []); assert.deepEqual(errors, []);
        const worker = await p.evaluate(async () => { const reg = await navigator.serviceWorker.getRegistration('/'); return { active: reg.active.scriptURL, controlled: !!navigator.serviceWorker.controller }; });
        assert.equal(worker.active, `${base.origin}/sw.js`); assert(worker.controlled);
        results.push({ name, viewport, compiledDashboard: true, nativeWorker: worker, replayHeatmap: true, regionLiveDuringEmptyReplay: true,
            explicitReviewedBoundary: true, alertsLiveDuringEmptyReplay: true, separateReviewAndDelivery: true, mockedPermissionClicks: 1, mockedDeliveries: 1,
            canonicalDotSelection: selected, drawingOwnership: true, undoRedoPersistence: true, frozenReplayEvidence: true, notesOptIn: true,
            nativeModalEscape: true, tierRevalidationCleanup: true, noOverflow: true, forbiddenRequests: forbidden.length, pageErrors: errors.length,
            independentRawReads: reads.filter(read => read.force_raw === 'true' && read.view === 'sidebar').length });
        await writeFile(`${output}/results.json`, JSON.stringify(results, null, 2));
        console.log(`${name} served six-feature checks passed`); await ctx.close();
    }
} finally {
    await browser.close();
    for (const server of servers) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
