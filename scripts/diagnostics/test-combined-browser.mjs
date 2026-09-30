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
    for (const [name, viewport, timezoneId] of [['desktop', { width: 1440, height: 900 }, 'UTC'], ['mobile', { width: 390, height: 844 }, 'America/New_York']]) {
        const mobile = name === 'mobile';
        const context = await browser.newContext({ viewport, timezoneId, isMobile: mobile, hasTouch: mobile });
        await context.addInitScript(() => { localStorage.setItem('seraphim_cookie_consent', 'essential'); localStorage.setItem('seraphim_seen_overlays', 'true'); });
        const page = await context.newPage(), errors = [], forbidden = [], mockedResources = [];
        page.on('pageerror', error => errors.push(error.message));
        page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
        await context.route('**/*', route => {
            const url = new URL(route.request().url());
            // NewsMap constructs this optional provider logo even when hidden.
            // Respond locally with an original synthetic SVG; never contact the provider.
            if (url.href === 'https://api.maptiler.com/resources/logo.svg') {
                mockedResources.push(url.href);
                return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>' });
            }
            if (url.origin === 'http://127.0.0.1:4176' && !url.pathname.startsWith('/api/')) return route.continue();
            forbidden.push(url.href); return route.abort();
        });
        await page.clock.setFixedTime(new Date('2026-09-30T12:00:00Z'));
        await page.goto(entry);
        await page.waitForSelector('[data-revealed="true"]');
        await page.waitForFunction(() => window.__combinedMap?.loaded());
        if (mobile) await page.getByRole('button', { name: 'Map', exact: true }).click();
        const camera = () => page.evaluate(() => { const map = window.__combinedMap; return { center: map.getCenter().toArray(), zoom: map.getZoom(), bearing: map.getBearing() }; });
        const data = () => page.evaluate(id => window.__combinedMap.getSource(id).serialize().data, sourceId);
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
        const hit = await page.evaluate(id => {
            const map = window.__combinedMap, row = map.queryRenderedFeatures({ layers: [id] })[0], point = map.project(row.geometry.coordinates), rect = map.getCanvas().getBoundingClientRect();
            return { id: row.properties.canonicalId, x: point.x + rect.x, y: point.y + rect.y };
        }, hitId);
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
        assert.equal(await page.getByText(`Synthetic event ${hit.id.replace('fixture-', '')}`, { exact: true }).count(), 1);
        await scrub('End');
        assert.deepEqual(await camera(), pickCamera);
        await page.locator('.maplibregl-popup-close-button').click();
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
        await fixtureControl('Restore Analyst fixture');
        await page.getByRole('button', { name: 'Freeze loaded view', exact: true }).click();
        await fixtureControl('Switch to free account');
        assert.equal(await page.getByRole('slider').count(), 0);
        assert.equal(await page.getByRole('button', { name: 'Replay · Pro', exact: true }).isDisabled(), true);
        assert.equal(await page.getByLabel('Activity density legend').count(), 0);
        await fixtureControl('Use guest fixture');
        assert.equal(await page.getByRole('button', { name: 'Replay · Pro', exact: true }).isDisabled(), true);
        assert.deepEqual(await page.evaluate(() => Object.keys(localStorage).filter(key => key.includes('replay'))), []);
        assert.deepEqual(await page.evaluate(() => window.__combinedCalls.fetches), []);
        assert.deepEqual(forbidden, []);
        assert.deepEqual(errors, []);
        results.push({ name, viewport, timezoneId, realMapLibre: true, syntheticRows: 1000, frozenFramePoints: 667,
            tests: 'density weights/canonical ids/native scrub/exact endpoints/frozen cap and readiness/late live updates/comparison/style recovery/dot selection/selected outside frame/no replay camera flights/WebGL loss and restore/reduced motion/keyboard focus/live restore/account and guest isolation',
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
