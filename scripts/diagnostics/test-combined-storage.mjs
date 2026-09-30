/** Real combined UI/native storage with controlled failures and synthetic services. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const output = 'artifacts/combined-six';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
const drawKey = 'seraphim-experiment-drawing-history-v2:fixture-account', legacyKey = 'seraphim-map-draw-tools-v1';
const broken = '{synthetic malformed saved drawing';
const legacy = { version: 1, drawFeatures: [{ type: 'Feature', id: 'legacy-synthetic', geometry: { type: 'Point', coordinates: [14, 32] }, properties: { mode: 'point', color: '#5f62ec', size: 4 } }], textAnnotations: [] };
const report = [];
try {
    for (const [name, viewport] of [['desktop', { width: 1440, height: 900 }], ['mobile', { width: 390, height: 844 }]]) {
        const context = await browser.newContext({ viewport, isMobile: name === 'mobile', hasTouch: name === 'mobile' });
        await context.addInitScript(({ drawKey, legacyKey, broken, legacy }) => {
            localStorage.setItem('seraphim_cookie_consent', 'essential'); localStorage.setItem('seraphim_seen_overlays', 'true');
            localStorage.setItem(drawKey, broken); localStorage.setItem(legacyKey, JSON.stringify(legacy));
            Notification.requestPermission = () => { throw new Error('Native permission forbidden.'); };
            ServiceWorkerRegistration.prototype.showNotification = () => { throw new Error('Native delivery forbidden.'); };
        }, { drawKey, legacyKey, broken, legacy });
        const page = await context.newPage(), errors = [], forbidden = [];
        page.on('pageerror', error => errors.push(error.message));
        page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
        await context.route('**/*', route => {
            const url = new URL(route.request().url());
            if (url.origin === 'http://127.0.0.1:4176') return route.continue();
            forbidden.push(url.href); return route.abort();
        });
        await page.clock.setFixedTime(new Date('2026-09-30T12:00:00Z'));
        await page.goto('http://127.0.0.1:4176/?lat=32.5&lng=14&zoom=4&t=1d&s=new');
        await page.waitForSelector('[data-revealed="true"]');
        await page.waitForFunction(() => window.__combinedMap?.loaded());
        await page.getByRole('button', { name: /^Add to evidence selection:/ }).first().click();
        if (name === 'mobile') await page.getByRole('button', { name: 'Map', exact: true }).click();
        await page.getByRole('button', { name: 'Map settings', exact: true }).click();
        await page.getByRole('switch', { name: 'Activity heatmap', exact: true }).click();
        await page.getByRole('button', { name: 'Map settings', exact: true }).click();
        await page.getByRole('button', { name: 'Freeze loaded view', exact: true }).click();
        const density = () => page.evaluate(() => window.__combinedMap.getSource('experiment-activity-heatmap-source').serialize().data);
        const originalDensity = await density();
        await page.getByRole('button', { name: 'Region checkpoints', exact: true }).click();
        const regions = page.getByRole('region', { name: 'Region checkpoints', exact: true });
        await regions.getByLabel('Region name', { exact: true }).fill('Synthetic retained region');
        await regions.getByRole('button', { name: 'Save viewport', exact: true }).click();
        await regions.getByRole('button', { name: 'Synthetic retained region', exact: true }).click();
        await regions.getByRole('button', { name: 'Check changes', exact: true }).click();
        await regions.getByText(/Baseline saved/).waitFor();
        await regions.getByRole('button', { name: 'Close region checkpoints', exact: true }).click();
        await page.getByRole('button', { name: 'Watch alerts', exact: true }).click();
        const alerts = page.getByRole('region', { name: 'Watch alerts', exact: true });
        await alerts.getByRole('button', { name: 'Save current viewport + filters', exact: true }).click();
        await alerts.getByRole('button', { name: 'Enable browser notifications', exact: true }).waitFor();
        await alerts.getByRole('button', { name: 'Close watch alerts', exact: true }).click();
        const independentStores = () => page.evaluate(() => Object.fromEntries(Object.keys(localStorage).filter(key => /region-checkpoints|browser-geofence/.test(key)).map(key => [key, localStorage.getItem(key)])));
        const retainedStores = await independentStores();
        if (name === 'mobile') await page.getByRole('button', { name: 'Stories', exact: true }).click();
        await page.getByRole('button', { name: /^Evidence workspace/ }).click();
        const workspace = page.getByRole('dialog', { name: 'Evidence workspace', exact: true });
        await workspace.getByRole('button', { name: 'Capture selected events', exact: true }).click();
        await workspace.getByRole('button', { name: 'Download JSON', exact: true }).waitFor();
        await page.evaluate(() => {
            window.__combinedNativeTransaction = IDBDatabase.prototype.transaction;
            IDBDatabase.prototype.transaction = function(...args) {
                if (this.name === 'seraphim-experiment-analyst-evidence-v1' && args[1] === 'readonly') throw new DOMException('Synthetic read failure', 'UnknownError');
                return Reflect.apply(window.__combinedNativeTransaction, this, args);
            };
            window.dispatchEvent(new Event('focus'));
        });
        await workspace.getByRole('button', { name: 'Retry local saving', exact: true }).waitFor();
        assert.equal(await workspace.getByRole('button', { name: 'Download JSON', exact: true }).count(), 1);
        await page.evaluate(() => { IDBDatabase.prototype.transaction = window.__combinedNativeTransaction; });
        await workspace.getByRole('button', { name: 'Retry local saving', exact: true }).click();
        await workspace.getByRole('button', { name: 'Retry local saving', exact: true }).waitFor({ state: 'hidden' });
        await page.screenshot({ path: `${output}/${name}-storage-recovered-evidence.png` });
        await workspace.getByRole('button', { name: 'Close evidence workspace', exact: true }).click();
        if (name === 'mobile') await page.getByRole('button', { name: 'Map', exact: true }).click();
        await page.getByRole('button', { name: 'Draw & Measure', exact: true }).click();
        const tools = page.locator('[data-drawing-tools]');
        if (await page.getByRole('button', { name: 'Expand panel', exact: true }).isVisible()) await page.getByRole('button', { name: 'Expand panel', exact: true }).click();
        await tools.getByText(/Saved drawings could not be loaded/).waitFor();
        assert.equal(await page.evaluate(key => localStorage.getItem(key), drawKey), broken);
        await tools.getByRole('button', { name: 'Import device drawings', exact: true }).click();
        assert.equal(await page.evaluate(key => localStorage.getItem(key), drawKey), broken);
        assert.deepEqual(await page.evaluate(key => JSON.parse(localStorage.getItem(key)), legacyKey), legacy);
        await tools.getByRole('button', { name: 'Save current drawings instead', exact: true }).click();
        await page.waitForFunction(key => JSON.parse(localStorage.getItem(key))?.drawFeatures.length === 1, drawKey);
        const imported = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), drawKey);
        assert.notEqual(imported.drawFeatures[0].id, legacy.drawFeatures[0].id);
        await tools.getByRole('button', { name: 'Undo', exact: true }).click();
        await page.waitForFunction(key => !localStorage.getItem(key), drawKey);
        await tools.getByRole('button', { name: 'Redo', exact: true }).click();
        await page.waitForFunction(key => !!localStorage.getItem(key), drawKey);
        assert.deepEqual(await page.evaluate(key => JSON.parse(localStorage.getItem(key)), drawKey), imported);
        const chooser = page.waitForEvent('filechooser');
        await tools.getByRole('button', { name: 'Import', exact: true }).click();
        await (await chooser).setFiles({ name: 'synthetic-invalid.geojson', mimeType: 'application/geo+json', buffer: Buffer.from(JSON.stringify({ type: 'FeatureCollection', features: [legacy.drawFeatures[0], { ...legacy.drawFeatures[0], geometry: { type: 'Point', coordinates: [181, 0] } }] })) });
        await tools.getByText(/Use valid points/).waitFor();
        assert.deepEqual(await page.evaluate(key => JSON.parse(localStorage.getItem(key)), drawKey), imported);
        await page.evaluate(key => {
            window.__combinedNativeSetItem = Storage.prototype.setItem;
            Storage.prototype.setItem = function(name, value) {
                if (name === key) throw new DOMException('Synthetic quota failure', 'QuotaExceededError');
                return Reflect.apply(window.__combinedNativeSetItem, this, [name, value]);
            };
        }, drawKey);
        await tools.getByRole('button', { name: 'Clear', exact: true }).click();
        // Clearing uses removeItem, so test an actual edit write using redo.
        await tools.getByRole('button', { name: 'Undo', exact: true }).click();
        await tools.getByText(/Drawings could not be saved on this device/).waitFor();
        await page.getByRole('button', { name: 'Close drawing tools', exact: true }).click();
        await page.getByText(/Drawings could not be saved on this device/).waitFor();
        await page.screenshot({ path: `${output}/${name}-protected-drawing-recovery.png` });
        await page.evaluate(() => { Storage.prototype.setItem = window.__combinedNativeSetItem; });
        assert.deepEqual(await independentStores(), retainedStores);
        assert.deepEqual(await density(), originalDensity);
        assert.deepEqual(await page.evaluate(() => ({ prompts: window.__combinedCalls.prompts, deliveries: window.__combinedCalls.deliveries })), { prompts: 0, deliveries: [] });
        assert.deepEqual(forbidden, []); assert.deepEqual(errors, []);
        report.push({ name, nativeIndexedDbReadRecovery: true, retainedPacket: true, protectedMalformedDrawing: true, explicitLegacyCopy: true,
            legacyUntouched: true, undoRedoImport: true, atomicMalformedFileRejection: true, quotaNoticeWhileClosed: true, frozenDensityAndIndependentStoresUnchanged: true,
            realNotifications: 0, forbiddenRequests: 0, browserErrors: 0 });
        await context.close();
    }
} catch (error) {
    for (const context of browser.contexts()) for (const page of context.pages()) await page.screenshot({ path: `${output}/storage-failure.png` }).catch(() => {});
    throw error;
} finally { await writeFile(`${output}/storage-results.json`, JSON.stringify(report, null, 2)); await browser.close(); }
console.log(JSON.stringify(report, null, 2));
