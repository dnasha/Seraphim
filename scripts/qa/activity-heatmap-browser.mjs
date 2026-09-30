// Run after installing the temporary QA fixture and starting a local dev server.
// NODE_PATH may point to an external @playwright/test installation; no repo dependency changes.
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const { chromium, expect } = createRequire(import.meta.url)('@playwright/test');
const output = resolve(process.env.HEATMAP_QA_ARTIFACTS ?? 'artifacts/activity-heatmap');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.HEATMAP_QA_CHROMIUM ?? '/usr/bin/chromium',
    headless: true, args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
const report = [];
const sourceId = 'experiment-activity-heatmap-source', hitId = 'experiment-activity-heatmap-hit';
try {
    for (const mobile of [false, true]) {
        const name = mobile ? 'mobile' : 'desktop';
        const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 },
            isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1, reducedMotion: 'reduce' });
        await context.addInitScript(() => { localStorage.setItem('seraphim_cookie_consent', 'essential'); localStorage.setItem('theme', 'light'); });
        // Font/remote resource responses are mocked. News, billing and preferences must never be requested.
        const requests = [], errors = [];
        await context.route('https://**/*', route => route.fulfill({ status: 200, contentType: 'application/octet-stream', body: Buffer.alloc(0) }));
        const page = await context.newPage();
        page.on('pageerror', error => errors.push(error.message));
        page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
        page.on('request', request => { if (request.url().includes('/api/')) requests.push(request.url()); });
        await page.goto(`${process.env.HEATMAP_QA_URL ?? 'http://localhost:3010'}/heatmap-qa`);
        await page.waitForFunction(() => window.__heatmapMap?.loaded());
        await page.screenshot({ path: `${output}/${name}-before.png` });
        await page.getByRole('button', { name: 'Map settings', exact: true }).click();
        const toggle = page.getByRole('switch', { name: 'Activity heatmap', exact: true });
        const modeBefore = await page.evaluate(() => window.__heatmapMap.getSource('news-events').serialize().cluster);
        const urlBefore = page.url();
        const start = performance.now();
        await toggle.focus(); await toggle.press('Space');
        await expect(toggle).toHaveAttribute('aria-checked', 'true');
        await page.waitForFunction(id => window.__heatmapMap.isSourceLoaded(id), sourceId);
        const toggleMs = performance.now() - start;
        const state = await page.evaluate(id => {
            const map = window.__heatmapMap, source = map.getSource(id).serialize();
            return { cluster: source.cluster, points: source.data.features.length, clutter: ['clusters-circle', 'clusters-count', 'unclustered-point', 'unclustered-point-active', 'hot-story-pulse'].map(layer => map.getLayoutProperty(layer, 'visibility')),
                queryMode: map.getSource('news-events').serialize().cluster, writes: window.__heatmapWrites };
        }, sourceId);
        expect(state.cluster).toBe(false); expect(state.points).toBe(1_000);
        expect(state.clutter).toEqual(['none', 'none', 'none', 'none', 'none']);
        expect(state.queryMode).toBe(modeBefore); expect(state.writes).toEqual([]); expect(page.url()).toBe(urlBefore);
        await page.getByRole('button', { name: 'Map settings', exact: true }).click();
        await page.screenshot({ path: `${output}/${name}-heatmap.png` });
        await page.getByLabel('Activity density legend').locator('summary').click();
        await page.screenshot({ path: `${output}/${name}-legend.png` });
        const legendBox = await page.getByLabel('Activity density legend').boundingBox();
        expect(legendBox.x).toBeGreaterThanOrEqual(0); expect(legendBox.x + legendBox.width).toBeLessThanOrEqual(mobile ? 390 : 1440);
        await page.getByLabel('Activity density legend').locator('summary').click();
        // Actual dot click chooses a canonical event and opens the existing React popup.
        const hit = await page.evaluate(id => {
            const map = window.__heatmapMap, feature = map.queryRenderedFeatures({ layers: [id] })[0];
            const point = map.project(feature.geometry.coordinates), rect = map.getCanvas().getBoundingClientRect();
            return { id: feature.properties.canonicalId, x: point.x + rect.x, y: point.y + rect.y };
        }, hitId);
        await page.mouse.click(hit.x, hit.y);
        await expect(page.getByLabel('Selected event')).not.toHaveText('none');
        await expect(page.locator('.news-popup')).toBeVisible();
        await page.waitForFunction(() => !window.__heatmapMap.isMoving());
        expect(await page.evaluate(() => window.__heatmapMap.getSource('selected-news-event').serialize().data.features.length)).toBe(1);
        await page.screenshot({ path: `${output}/${name}-selected.png` });
        await page.locator('.maplibregl-popup-close-button').click();
        await page.getByRole('button', { name: 'Sidebar story', exact: true }).click();
        await expect(page.getByLabel('Selected event')).toHaveText('fixture-0');
        await expect(page.locator('.news-popup')).toBeVisible();
        await page.locator('.maplibregl-popup-close-button').click();
        await page.getByRole('button', { name: 'Theme', exact: true }).click();
        await page.waitForFunction(id => window.__heatmapMap.getLayer(id) && window.__heatmapMap.loaded(), hitId);
        await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
        await page.screenshot({ path: `${output}/${name}-dark.png` });
        await page.getByRole('button', { name: 'Aggregate rows', exact: true }).click();
        await expect(page.getByLabel('Activity density legend')).toContainText('approximate');
        await page.getByRole('button', { name: 'Capped result', exact: true }).click();
        await expect(page.getByLabel('Activity density legend')).toContainText('Loaded result is capped.');
        await page.getByRole('button', { name: 'Displayed subset', exact: true }).click();
        await page.waitForFunction(id => window.__heatmapMap.getSource(id).serialize().data.features.length === 25, sourceId);
        await page.getByRole('button', { name: 'Empty data', exact: true }).click();
        await expect(page.getByLabel('Activity density legend')).toContainText('No located stories');
        await page.screenshot({ path: `${output}/${name}-empty-capped.png` });
        await page.getByRole('button', { name: 'Empty data', exact: true }).click();
        // Persisted display preference survives a reload; no preference service writes.
        await page.reload(); await page.waitForFunction(id => window.__heatmapMap?.getLayer(id), hitId);
        await expect(page.getByLabel('Activity density legend')).toBeVisible();
        // Exercise real WebGL loss/restoration and layer reinstall.
        const recovery = await page.evaluate(() => {
            const canvas = window.__heatmapMap.getCanvas(), gl = canvas.getContext('webgl2');
            const extension = gl?.getExtension('WEBGL_lose_context');
            if (!extension) return false;
            extension.loseContext(); setTimeout(() => extension.restoreContext(), 300); return true;
        });
        if (!recovery) throw new Error('WEBGL_lose_context unavailable');
        await page.waitForFunction(id => window.__heatmapMap?.getLayer(id) && window.__heatmapMap.loaded(), hitId);
        await page.getByRole('button', { name: 'Switch account', exact: true }).click();
        await expect(page.getByLabel('Activity density legend')).toHaveCount(0);
        expect(await page.evaluate(id => Boolean(window.__heatmapMap.getSource(id)), sourceId)).toBe(false);
        await page.getByRole('button', { name: 'Switch account', exact: true }).click();
        await expect(page.getByLabel('Activity density legend')).toBeVisible();
        await page.getByRole('button', { name: 'Map settings', exact: true }).click();
        await toggle.click();
        await expect(toggle).toHaveAttribute('aria-checked', 'false');
        expect(await page.evaluate(() => window.__heatmapMap.getLayoutProperty('clusters-count', 'visibility'))).toBe('visible');
        expect(await page.evaluate(id => Boolean(window.__heatmapMap.getSource(id)), sourceId)).toBe(false);
        // Verify on/off also retains an enabled individual-pin preference.
        await page.getByRole('button', { name: 'Force individual pins', exact: true }).click();
        await page.waitForFunction(() => window.__heatmapMap?.getSource('news-events')?.serialize().cluster === false && window.__heatmapMap.loaded());
        await toggle.click(); await toggle.click();
        expect(await page.evaluate(() => window.__heatmapMap.getSource('news-events').serialize().cluster)).toBe(false);
        await page.getByRole('button', { name: 'Reset saved heatmap choice', exact: true }).click();
        expect(await page.evaluate(() => localStorage.getItem('seraphim:experiment:activity-heatmap:v1:account:fixture-a'))).toBeNull();
        expect(requests).toEqual([]); expect(errors).toEqual([]);
        report.push({ viewport: name, events: 1_000, toggleMs: Math.round(toggleMs), keyboardToggle: true,
            dotAndSidebarSelection: true, styleReload: true, contextRestoration: true, accountIsolation: true,
            emptyCappedAndDisplayedSubset: true, preferenceRestore: true, pinPreferenceRetained: true, apiRequests: requests.length, browserErrors: errors.length });
        await context.close();
    }
} finally {
    await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
    await browser.close();
}
console.log(JSON.stringify(report, null, 2));
