/** Run with combined-browser-server.mjs. All provider/auth/feed resources are synthetic. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const output = 'artifacts/combined-six';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true,
    args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
const sourceId = 'experiment-activity-heatmap-source', hitId = 'experiment-activity-heatmap-hit';
const results = [];
const entry = 'http://127.0.0.1:4176/?lat=32.5&lng=14&zoom=4&t=1d&s=new';
try {
    const viewports = [['desktop', { width: 1440, height: 900 }, 'UTC'], ['mobile', { width: 390, height: 844 }, 'America/New_York'],
        ['narrow', { width: 320, height: 568 }, 'Asia/Kolkata'], ['landscape', { width: 844, height: 390 }, 'America/New_York']];
    for (const [name, viewport, timezoneId] of viewports) {
        const mobile = name !== 'desktop';
        const context = await browser.newContext({ viewport, timezoneId, isMobile: mobile, hasTouch: mobile });
        await context.addInitScript(() => {
            localStorage.setItem('seraphim_cookie_consent', 'essential'); localStorage.setItem('seraphim_seen_overlays', 'true');
            // A fixture boundary regression must fail before any native prompt or display.
            Notification.requestPermission = () => { throw new Error('Native permission prompt forbidden in this fixture.'); };
            ServiceWorkerRegistration.prototype.showNotification = () => { throw new Error('Native notification forbidden in this fixture.'); };
        });
        const page = await context.newPage(), errors = [], forbidden = [], mockedResources = [], regionRequests = [], watchRequests = [], evidenceRequests = [];
        let regionStage = 0, watching = false, feedTime = '2026-09-30T12:00:00Z';
        let evidenceRevision = 0, releaseEvidence, evidenceGate = null;
        const regionRow = index => ({ id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`, title: `Synthetic live region event ${index}`,
            source: 'Fixture', sourceType: 'rss', url: `https://example.invalid/region-${index}`, publishedAt: '2026-09-29T18:00:00Z',
            latitude: 32, longitude: 14, sourcesCount: 1, storyCount: 1 });
        page.on('pageerror', error => errors.push(error.message));
        page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
        await context.route('**/*', async route => {
            const url = new URL(route.request().url());
            // NewsMap constructs this optional provider logo even when hidden.
            // Respond locally with an original synthetic SVG; never contact the provider.
            if (url.href === 'https://api.maptiler.com/resources/logo.svg') {
                mockedResources.push(url.href);
                return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>' });
            }
            if (url.origin === 'http://127.0.0.1:4176' && url.pathname === '/api/news') {
                const scope = Object.fromEntries(url.searchParams);
                (watching ? watchRequests : regionRequests).push(scope);
                assert.equal(scope.force_raw, 'true'); assert.equal(scope.view, 'sidebar'); assert.equal(scope.scope, 'viewport');
                return route.fulfill({ json: { items: Array.from({ length: regionStage + 1 }, (_, index) => regionRow(index + 1)),
                    lastUpdated: feedTime, meta: { clustered: false, scope: 'viewport', view: 'sidebar', sort: scope.sort, isCapped: false, stale: false, appliedLimit: 1000 } } });
            }
            if (url.origin === 'http://127.0.0.1:4176' && url.pathname.startsWith('/api/news/00000000-0000-4000-8000-')) {
                assert.equal(url.searchParams.get('refresh'), 'true');
                const row = regionRow(Number(url.pathname.slice(-12)));
                return route.fulfill({ json: { event: row, sources: [{ url: row.url }], totalSources: 1, timelineRestricted: false } });
            }
            if (url.origin === 'http://127.0.0.1:4176' && url.pathname === '/api/analyst/access') {
                const account = await page.evaluate(() => ({ userId: window.__combinedCalls.owner, tier: window.__combinedCalls.tier }));
                return route.fulfill({ status: ['analyst', 'angel'].includes(account.tier) ? 200 : 403, json: account });
            }
            if (url.origin === 'http://127.0.0.1:4176' && url.pathname.startsWith('/api/news/10000000-0000-4000-8000-')) {
                assert.equal(url.searchParams.get('evidence'), 'true');
                const id = url.pathname.split('/').at(-1), revision = evidenceRevision;
                evidenceRequests.push({ id, revision });
                if (evidenceGate) await evidenceGate;
                return route.fulfill({ json: { event: { id, title: `Current exact detail revision ${revision}`, description: 'Synthetic current observation.',
                    source: 'Fixture publisher', sourceType: 'rss', url: `https://example.invalid/${id}`, publishedAt: '2026-09-29T18:00:00Z', latitude: 32, longitude: 14 },
                    sources: [{ name: 'Fixture source', url: 'https://example.invalid/source', source_type: 'rss', discovered_at: '2026-09-29T18:30:00Z' }], totalSources: 1, timelineRestricted: false } });
            }
            if (url.origin === 'http://127.0.0.1:4176' && !url.pathname.startsWith('/api/')) return route.continue();
            forbidden.push(url.href); return route.abort();
        });
        await page.clock.setFixedTime(new Date('2026-09-30T12:00:00Z'));
        await page.goto(entry);
        await page.waitForSelector('[data-revealed="true"]');
        await page.waitForFunction(() => window.__combinedMap?.loaded());
        if (mobile) await page.getByRole('button', { name: 'Map', exact: true }).click();
        const launcherRects = await Promise.all(['Draw & Measure', 'Region checkpoints', 'Watch alerts'].map(label => page.getByRole('button', { name: label, exact: true }).boundingBox()));
        for (let i = 0; i < launcherRects.length; i++) for (let j = i + 1; j < launcherRects.length; j++) {
            const a = launcherRects[i], b = launcherRects[j];
            assert(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y, 'Map experiment launchers must not overlap');
        }
        const camera = () => page.evaluate(() => { const map = window.__combinedMap; return { center: map.getCenter().toArray(), zoom: map.getZoom(), bearing: map.getBearing() }; });
        const data = () => page.evaluate(id => window.__combinedMap.getSource(id).serialize().data, sourceId);
        const visibleHit = layers => page.evaluate(layers => {
            const map = window.__combinedMap, canvas = map.getCanvas(), rect = canvas.getBoundingClientRect();
            for (const row of map.queryRenderedFeatures({ layers })) {
                const point = map.project(row.geometry.coordinates), x = point.x + rect.x, y = point.y + rect.y;
                if (document.elementFromPoint(x, y) === canvas) return { id: row.properties.canonicalId, x, y };
            }
            throw new Error('No unobscured rendered news point reaches the actual canvas.');
        }, layers);
        const fixtureControl = async name => {
            const details = page.locator('.fixture-switches');
            if (!(await details.evaluate(node => node.open))) await details.locator('summary').click();
            await page.getByRole('button', { name, exact: true }).click();
            await details.locator('summary').click();
        };
        const scrub = async key => { const slider = page.getByRole('slider', { name: 'Reporting cursor' }); await slider.focus(); await slider.press(key); };
        await page.getByRole('button', { name: 'Map settings', exact: true }).click();
        const toggle = page.getByRole('switch', { name: 'Activity heatmap', exact: true });
        await toggle.focus(); await toggle.press('Space');
        await page.waitForFunction(id => window.__combinedMap.isSourceLoaded(id), sourceId);
        assert.equal((await data()).features.length, 1000);
        await page.getByRole('button', { name: 'Map settings', exact: true }).click();
        await page.screenshot({ path: `${output}/${name}-live-heatmap.png` });
        await page.getByRole('button', { name: 'Freeze loaded view', exact: true }).click();
        await scrub('Home');
        await page.waitForFunction(id => window.__combinedMap.getSource(id).serialize().data.features.length === 0, sourceId);
        await scrub('End');
        assert.equal((await data()).features.length, 1000);
        // A region check reads its own live raw scope even when replay displays no rows.
        await scrub('Home');
        const launcher = page.getByRole('button', { name: 'Region checkpoints', exact: true });
        await launcher.click();
        const regions = page.getByRole('region', { name: 'Region checkpoints', exact: true });
        const regionName = `Synthetic ${name} watch`;
        await regions.getByLabel('Region name', { exact: true }).fill(regionName);
        await regions.getByRole('button', { name: 'Save viewport', exact: true }).click();
        await regions.getByRole('button', { name: regionName, exact: true }).click();
        await regions.getByRole('button', { name: 'Check changes', exact: true }).click();
        await regions.getByText(/Baseline saved/).waitFor();
        assert.equal((await data()).features.length, 0);
        const checkpointKey = 'seraphim:experiment:region-checkpoints:v1:fixture-account';
        const saved = () => page.evaluate(key => JSON.parse(localStorage.getItem(key)).regions[0], checkpointKey);
        assert.equal((await saved()).baseline.events.length, 1);
        await page.screenshot({ path: `${output}/${name}-region-during-empty-replay.png` });
        // Region panel bounds and its close button remain usable above the replay panel.
        const regionBox = await regions.boundingBox();
        assert(regionBox.y >= 0); assert(regionBox.x >= 0); assert(regionBox.x + regionBox.width <= viewport.width);
        await regions.getByRole('button', { name: 'Close region checkpoints', exact: true }).click();
        const beforePan = await camera();
        await page.evaluate(() => window.__combinedMap.jumpTo({ center: [16, 33], zoom: 5 }));
        await launcher.click(); regionStage = 1;
        await regions.getByRole('button', { name: 'Check changes', exact: true }).click();
        await regions.getByText('Newly observed event', { exact: true }).waitFor();
        assert.deepEqual(regionRequests[1], regionRequests[0]);
        assert.equal((await saved()).baseline.events.length, 1);
        regionStage = 2; // A later backend change must not enter the displayed review.
        await regions.getByRole('button', { name: 'Mark reviewed', exact: true }).click();
        assert.equal((await saved()).baseline.events.length, 2); assert.equal(regionRequests.length, 2);
        assert(!page.url().includes(regionName));
        await regions.getByRole('button', { name: 'Close region checkpoints', exact: true }).click();
        await page.evaluate(view => window.__combinedMap.jumpTo(view), beforePan);
        // Real alert sessions read and deduplicate live identities independently
        // of both an empty replay frame and an explicitly reviewed region result.
        watching = true;
        const alertLauncher = page.getByRole('button', { name: 'Watch alerts', exact: true });
        await alertLauncher.click();
        const alerts = page.getByRole('region', { name: 'Watch alerts', exact: true });
        const alertBox = await alerts.boundingBox(), mapBox = await page.locator('main').boundingBox();
        assert(alertBox.x >= 0 && alertBox.x + alertBox.width <= viewport.width);
        assert(alertBox.y >= mapBox.y && alertBox.y + alertBox.height <= mapBox.y + mapBox.height);
        assert.equal(await page.evaluate(() => window.__combinedCalls.prompts), 0);
        const watchName = `Synthetic ${name} alerts`;
        await alerts.getByLabel('New watch name', { exact: true }).fill(watchName);
        await alerts.getByRole('button', { name: 'Save current viewport + filters', exact: true }).click();
        const alertKey = 'seraphim:experiment:browser-geofence:v1:fixture-account';
        await page.waitForFunction(key => JSON.parse(localStorage.getItem(key))?.watches.length === 1, alertKey);
        assert.equal(await page.evaluate(() => window.__combinedCalls.prompts), 0);
        await alerts.getByRole('button', { name: 'Enable browser notifications', exact: true }).click();
        assert.equal(await page.evaluate(() => window.__combinedCalls.prompts), 1);
        await page.waitForFunction(key => JSON.parse(localStorage.getItem(key))?.watches[0].checkpoint?.seen.length === 3, alertKey);
        assert.equal(await page.evaluate(() => window.__combinedCalls.prompts), 1);
        assert.deepEqual(await page.evaluate(() => window.__combinedCalls.deliveries), []);
        assert.equal((await data()).features.length, 0);
        assert.equal((await saved()).baseline.events.length, 2);
        const watchBaseline = await page.evaluate(key => JSON.parse(localStorage.getItem(key)).watches[0], alertKey);
        await alerts.getByText('Review saved scope', { exact: true }).click();
        assert.deepEqual(await page.evaluate(key => JSON.parse(localStorage.getItem(key)).watches[0].checkpoint, alertKey), watchBaseline.checkpoint);
        await page.screenshot({ path: `${output}/${name}-alerts-during-empty-replay.png` });
        await alerts.getByRole('button', { name: 'Close watch alerts', exact: true }).click();
        await page.evaluate(() => window.__combinedMap.jumpTo({ center: [16, 33], zoom: 5 }));
        regionStage = 3;
        const nextWatchCheck = await page.evaluate(key => JSON.parse(localStorage.getItem(key)).nextCheckAt, alertKey);
        feedTime = new Date(nextWatchCheck).toISOString();
        assert.equal(new Date(nextWatchCheck).getUTCMinutes(), 2);
        await page.clock.setFixedTime(new Date(nextWatchCheck));
        await page.evaluate(() => window.dispatchEvent(new Event('focus')));
        await page.waitForFunction(key => JSON.parse(localStorage.getItem(key))?.watches[0].checkpoint?.seen.length === 4, alertKey);
        assert.deepEqual(watchRequests[1], watchRequests[0]);
        assert.equal(watchRequests[0].time_range, '1d');
        assert.deepEqual(await page.evaluate(() => window.__combinedCalls.deliveries), [[regionRow(4).id]]);
        assert.equal((await saved()).baseline.events.length, 2);
        assert.equal((await data()).features.length, 0);
        assert(!page.url().includes(watchName));
        await alertLauncher.click();
        await alerts.getByRole('button', { name: 'Pause all checks', exact: true }).click();
        await page.waitForFunction(key => !JSON.parse(localStorage.getItem(key)).enabled, alertKey);
        await alerts.getByRole('button', { name: 'Close watch alerts', exact: true }).click();
        await page.evaluate(view => window.__combinedMap.jumpTo(view), beforePan);
        await scrub('End');
        // Actual native pointer scrub to halfway excludes all 1-hour rows.
        const slider = page.getByRole('slider', { name: 'Reporting cursor' }), box = await slider.boundingBox();
        await slider.click({ position: { x: box.width / 2, y: box.height / 2 } });
        await page.waitForFunction(id => window.__combinedMap.getSource(id).serialize().data.features.length === 667, sourceId);
        const frozen = await data(), fixedCamera = await camera(), fixedUrl = page.url();
        assert(frozen.features.some(row => row.properties.weight === 15));
        assert(frozen.features.every(row => !row.properties.canonicalId.startsWith('cluster-')));
        await fixtureControl('Live status change');
        assert.match(await page.getByLabel('Activity density legend').textContent(), /Loaded result is capped/);
        assert.doesNotMatch(await page.getByLabel('Activity density legend').textContent(), /Updating displayed stories|Update unavailable/);
        await fixtureControl('Inject late response');
        assert.deepEqual(await data(), frozen);
        assert.deepEqual(await camera(), fixedCamera);
        assert.equal(page.url(), fixedUrl);
        await page.getByText('Compare two reporting windows', { exact: true }).click();
        assert.equal(await page.getByRole('table').count(), 1);
        await page.screenshot({ path: `${output}/${name}-frozen-comparison.png` });
        await page.getByText('Compare two reporting windows', { exact: true }).click();
        await fixtureControl('Theme');
        await page.waitForFunction(id => window.__combinedMap.getLayer(id) && window.__combinedMap.loaded(), hitId);
        assert.deepEqual(await data(), frozen);
        await page.screenshot({ path: `${output}/${name}-frozen-dark.png` });
        // Pick a real rendered dot while replay owns presentation; the camera stays put.
        await page.waitForFunction(id => window.__combinedMap.queryRenderedFeatures({ layers: [id] }).length > 0, hitId);
        const hit = await visibleHit([hitId]);
        const pickCamera = await camera();
        if (mobile) await page.touchscreen.tap(hit.x, hit.y); else await page.mouse.click(hit.x, hit.y);
        await page.waitForFunction(id => new URL(location.href).searchParams.get('eventId') === id, hit.id);
        await page.locator('.news-popup').waitFor({ state: 'visible' });
        assert.deepEqual(await camera(), pickCamera);
        await scrub('Home');
        await page.waitForFunction(id => window.__combinedMap.getSource(id).serialize().data.features.length === 0, sourceId);
        assert.match(await page.getByRole('region', { name: 'Reporting replay' }).textContent(), /Selected event is outside/);
        assert.equal(new URL(page.url()).searchParams.get('eventId'), hit.id);
        // The selected sidebar detail is explicitly retained outside the frame;
        // it contributes neither a normal marker nor any heatmap density.
        assert.equal(await page.evaluate(() => window.__combinedMap.getSource('selected-news-event').serialize().data.features.length), 0);
        if (mobile) await page.getByRole('button', { name: 'Stories', exact: true }).click();
        await page.getByText(`Synthetic event ${Number(hit.id.slice(-12)) - 1}`, { exact: true }).waitFor({ state: 'visible' });
        if (mobile) await page.getByRole('button', { name: 'Map', exact: true }).click();
        await scrub('End');
        assert.deepEqual(await camera(), pickCamera);
        // Capture begins while replay is playing and the live hook is loading.
        // Both continue changing while the exact-ID response is held in flight.
        await page.getByRole('button', { name: 'Play', exact: true }).click();
        if (mobile) await page.getByRole('button', { name: 'Stories', exact: true }).click();
        await page.getByRole('button', { name: /^Evidence workspace/ }).click();
        const workspace = page.getByRole('dialog', { name: 'Evidence workspace', exact: true });
        await workspace.getByRole('button', { name: 'Toggle active event in evidence selection', exact: true }).click();
        const privateNote = `Private synthetic ${name} note`;
        await workspace.getByRole('textbox', { name: /^Private note for/ }).fill(privateNote);
        await workspace.getByRole('button', { name: 'Close evidence workspace', exact: true }).focus();
        const isolatedUrl = page.url(), isolatedCamera = await camera();
        const preferenceWrites = await page.evaluate(() => window.__combinedCalls.preferences.length);
        for (const key of ['t', 'c', 'm', '/', 'f']) await page.keyboard.press(key);
        assert.equal(page.url(), isolatedUrl); assert.deepEqual(await camera(), isolatedCamera);
        assert.equal(await page.evaluate(() => window.__combinedCalls.preferences.length), preferenceWrites);
        // Stories hides replay controls in compact layouts while keeping its
        // presentation clock mounted. Only read that clock through the DOM;
        // native scrubbing above still targets the visible accessible slider.
        const replayClock = page.locator('[aria-label="Reporting replay"] input[type="range"]');
        if (mobile) { assert.equal(await slider.count(), 0); assert.equal(await replayClock.isVisible(), false); }
        const cursorBefore = await replayClock.inputValue();
        evidenceGate = new Promise(resolve => { releaseEvidence = resolve; });
        const captureRequest = page.waitForRequest(request => new URL(request.url()).pathname === `/api/news/${hit.id}`);
        await workspace.getByRole('button', { name: 'Capture selected events', exact: true }).click();
        await captureRequest;
        const captureDeadline = Date.now() + 10_000;
        while (evidenceRequests.length === 0 && Date.now() < captureDeadline) await new Promise(resolve => setTimeout(resolve, 10));
        assert.equal(evidenceRequests.length, 1);
        const capturesBefore = Number(await replayClock.inputValue());
        evidenceRevision = 1;
        await page.evaluate(() => window.__combinedChangeFixture({ error: 'Synthetic change during capture', loading: true }));
        await page.waitForFunction(value => Number(document.querySelector('[aria-label="Reporting replay"] input[type="range"]').value) > value, capturesBefore);
        releaseEvidence(); evidenceGate = null;
        await workspace.getByRole('button', { name: 'Download JSON', exact: true }).waitFor();
        const jsonCopy = async () => {
            const download = page.waitForEvent('download');
            await workspace.getByRole('button', { name: 'Download JSON', exact: true }).click();
            const content = await (await download).createReadStream(), chunks = [];
            for await (const chunk of content) chunks.push(chunk);
            return JSON.parse(Buffer.concat(chunks).toString());
        };
        const captured = await jsonCopy();
        assert.equal(captured.packet.entries[0].event.title, 'Current exact detail revision 0');
        assert.equal(captured.packet.entries[0].selection.id, hit.id);
        assert(captured.packet.scope.reportingReplay);
        assert.equal(captured.packet.scope.isCapped, true);
        assert.equal(captured.packet.scope.feedStatus, 'freshness-not-reported');
        assert.equal(captured.packet.scope.reportingReplay.liveFeedStatus, 'loading');
        assert.match(captured.packet.disclaimer, /not event state at the replay cursor/);
        assert.equal(captured.notesIncluded, false); assert(!JSON.stringify(captured).includes(privateNote));
        await page.screenshot({ path: `${output}/${name}-evidence-during-replay.png` });
        assert.notEqual(await replayClock.inputValue(), cursorBefore);
        await workspace.getByRole('button', { name: 'Close evidence workspace', exact: true }).click();
        if (mobile) await page.getByRole('button', { name: 'Map', exact: true }).click();
        await scrub('End');
        if (mobile) await page.getByRole('button', { name: 'Stories', exact: true }).click();
        await page.getByRole('button', { name: /^Evidence workspace/ }).click();
        assert.deepEqual((await jsonCopy()).packet, captured.packet);
        await workspace.getByRole('checkbox', { name: 'Include private notes in this export', exact: true }).check();
        assert.equal((await jsonCopy()).privateNotes[hit.id], privateNote);
        await page.keyboard.press('Escape');
        await workspace.waitFor({ state: 'hidden' });
        assert.equal(new URL(page.url()).searchParams.get('eventId'), hit.id);
        if (mobile) await page.getByRole('button', { name: 'Map', exact: true }).click();
        await page.locator('.maplibregl-popup-close-button').waitFor({ state: 'visible' });
        await page.locator('.maplibregl-popup-close-button').click();
        // A real drawing vertex over news must not pick a story or expand a cluster.
        for (const heatmap of [true, false]) {
            if (!heatmap) {
                await page.getByRole('button', { name: 'Map settings', exact: true }).click(); await toggle.click();
                await page.getByRole('button', { name: 'Map settings', exact: true }).click();
            }
            await page.getByRole('button', { name: 'Draw & Measure', exact: true }).click();
            await page.getByRole('button', { name: 'Close drawing tools', exact: true }).waitFor();
            // Mobile collapses on first mount; reopening keeps the user's last state.
            if (mobile && heatmap) await page.getByRole('button', { name: 'Expand panel', exact: true }).waitFor();
            if (await page.getByRole('button', { name: 'Expand panel', exact: true }).isVisible()) await page.getByRole('button', { name: 'Expand panel', exact: true }).click();
            await page.getByRole('button', { name: 'Pin', exact: true }).click();
            await page.getByRole('button', { name: 'Collapse panel', exact: true }).click();
            const layers = heatmap ? [hitId] : ['clusters-circle', 'unclustered-point'];
            await page.waitForFunction(layers => window.__combinedMap.queryRenderedFeatures({ layers }).length > 0, layers);
            const vertex = await visibleHit(layers);
            await page.evaluate(() => { window.__combinedCanvasClicks = 0; window.__combinedMap.once('click', () => window.__combinedCanvasClicks++); });
            const drawCamera = await camera(), drawUrl = page.url();
            if (mobile) await page.touchscreen.tap(vertex.x, vertex.y); else await page.mouse.click(vertex.x, vertex.y);
            await page.waitForFunction(() => Object.keys(window.__combinedMap.getStyle().sources).some(id => id.startsWith('experiment-drawing-history-') && window.__combinedMap.getSource(id).serialize().data?.features?.length > 0));
            assert.equal(await page.evaluate(() => window.__combinedCanvasClicks), 1);
            assert.deepEqual(await camera(), drawCamera); assert.equal(page.url(), drawUrl);
            await page.getByRole('button', { name: 'Expand panel', exact: true }).click();
            const drawKey = 'seraphim-experiment-drawing-history-v2:fixture-account';
            await page.waitForFunction(key => JSON.parse(localStorage.getItem(key))?.drawFeatures.length === 1, drawKey);
            const completedPin = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), drawKey);
            await page.getByRole('button', { name: 'Undo', exact: true }).click();
            await page.waitForFunction(key => !localStorage.getItem(key), drawKey);
            await page.getByRole('button', { name: 'Redo', exact: true }).click();
            await page.waitForFunction(key => JSON.parse(localStorage.getItem(key))?.drawFeatures.length === 1, drawKey);
            assert.deepEqual(await page.evaluate(key => JSON.parse(localStorage.getItem(key)), drawKey), completedPin);
            await page.getByRole('button', { name: 'Clear', exact: true }).click();
            await page.waitForFunction(key => !localStorage.getItem(key), drawKey);
            await page.getByRole('button', { name: 'Close drawing tools', exact: true }).click();
        }
        await page.getByRole('button', { name: 'Map settings', exact: true }).click(); await toggle.click();
        await page.getByRole('button', { name: 'Map settings', exact: true }).click();
        // Restoring from a real WebGL loss must reinstall the current frozen density.
        const recovery = await page.evaluate(() => {
            const map = window.__combinedMap, extension = map.getCanvas().getContext('webgl2')?.getExtension('WEBGL_lose_context');
            if (!extension) return false;
            window.__combinedContextEvents = [];
            map.once('webglcontextlost', () => window.__combinedContextEvents.push('lost'));
            map.once('webglcontextrestored', () => window.__combinedContextEvents.push('restored'));
            extension.loseContext(); setTimeout(() => extension.restoreContext(), 300); return true;
        });
        assert.equal(recovery, true);
        await page.waitForFunction(id => window.__combinedContextEvents.includes('lost') && window.__combinedContextEvents.includes('restored') && window.__combinedMap.getLayer(id) && window.__combinedMap.loaded(), hitId);
        assert.equal((await data()).features.length, 1000);
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent === 'Play' && button.disabled));
        assert.equal(await page.getByRole('button', { name: 'Play', exact: true }).isDisabled(), true);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        // Native keyboard focus stays visible in the replay scroll body.
        await slider.focus();
        for (let step = 0; step < 6; step++) {
            await page.keyboard.press('Tab');
            const focus = await page.evaluate(() => {
                const element = document.activeElement, rect = element.getBoundingClientRect(), panel = document.querySelector('[aria-label="Reporting replay"]').getBoundingClientRect();
                return { inside: Boolean(element.closest('[aria-label="Reporting replay"]')), top: rect.top, bottom: rect.bottom, panelTop: panel.top, panelBottom: panel.bottom };
            });
            if (focus.inside) { assert(focus.top >= focus.panelTop - 1); assert(focus.bottom <= focus.panelBottom + 1); }
        }
        await page.getByRole('button', { name: 'Return live', exact: true }).click();
        await page.waitForFunction(id => window.__combinedMap.getSource(id).serialize().data.features.every(row => row.geometry.coordinates[0] === 80), sourceId);
        assert.match(await page.getByLabel('Activity density legend').textContent(), /Updating displayed stories/);
        // The real dismiss action clears the injected live error after leaving
        // replay, so its floating notice cannot cover the fixture switch menu.
        await page.getByRole('button', { name: 'Dismiss stories error', exact: true }).click();
        await fixtureControl('Restore Analyst fixture');
        await page.getByRole('button', { name: 'Freeze loaded view', exact: true }).click();
        await fixtureControl('Switch to free account');
        assert.equal(await page.getByRole('slider').count(), 0);
        assert.equal(await page.getByRole('button', { name: 'Replay · Pro', exact: true }).isDisabled(), true);
        assert.equal(await page.getByLabel('Activity density legend').count(), 0);
        await alertLauncher.click();
        assert.equal(await alerts.getByRole('button', { name: 'Enable browser notifications', exact: true }).isDisabled(), true);
        assert.equal(await alerts.getByLabel(`Rename ${watchName}`).count(), 0);
        await alerts.getByRole('button', { name: 'Close watch alerts', exact: true }).click();
        await fixtureControl('Use guest fixture');
        assert.equal(await page.getByRole('button', { name: 'Replay · Pro', exact: true }).isDisabled(), true);
        await alertLauncher.click();
        assert.equal(await alerts.getByRole('button', { name: 'Save current viewport + filters', exact: true }).count(), 0);
        assert.equal(await page.evaluate(() => window.__combinedCalls.prompts), 1);
        assert.deepEqual(await page.evaluate(() => Object.keys(localStorage).filter(key => key.includes('replay'))), []);
        assert.deepEqual(await page.evaluate(() => window.__combinedCalls.fetches), []);
        assert.deepEqual(forbidden, []);
        assert.deepEqual(errors, []);
        results.push({ name, viewport, timezoneId, realMapLibre: true, syntheticRows: 1000, frozenFramePoints: 667,
            tests: 'density weights/canonical ids/native scrub/exact endpoints/frozen cap and readiness/live independent raw region and alert checks while replay empty/fixed saved scopes after pan/explicit displayed region review boundary/quiet alert baseline/explicit mocked permission/UTC-aligned unseen alert arrival/independent checkpoints/late live updates/comparison/style recovery/dot selection/selected outside frame/no replay camera flights/immutable analyst capture during changing replay and live/private note opt-in/modal shortcut isolation/hidden compact replay clock/drawing ownership with heatmap on and off/native undo redo persistence/WebGL loss and restore/reduced motion/keyboard focus/live restore/account and guest isolation',
            mockedRegionReads: regionRequests.length, mockedWatchReads: watchRequests.length, mockedPermissionClicks: 1, mockedDeliveries: 1,
            forbiddenRequests: forbidden.length, mockedResources: mockedResources.length, browserErrors: errors.length });
        await context.close();
    }
} catch (error) {
    for (const context of browser.contexts()) for (const page of context.pages()) await page.screenshot({ path: `${output}/failure.png` }).catch(() => {});
    throw error;
} finally {
    await writeFile(`${output}/browser-results.json`, JSON.stringify(results, null, 2)); await browser.close();
}
console.log(JSON.stringify(results, null, 2));
