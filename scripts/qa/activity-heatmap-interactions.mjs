// Run with the same temporary fixture/server and external Playwright setup as
// activity-heatmap-browser.mjs. Regressions use Astra's 1,000-event repro points.
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const { chromium, expect } = createRequire(import.meta.url)('@playwright/test');
const output = resolve(process.env.HEATMAP_QA_ARTIFACTS ?? 'artifacts/activity-heatmap-interactions');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.HEATMAP_QA_CHROMIUM ?? '/usr/bin/chromium',
    headless: true, args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
const report = [];
const drawingModes = ['Area', 'Ruler', 'Rect', 'Circle', 'Pin', 'Sketch', 'Text', 'Eraser', 'Select'];
try {
    for (const mobile of [false, true]) {
        const name = mobile ? 'mobile' : 'desktop';
        const intendedId = mobile ? 'fixture-250' : 'fixture-0';
        const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 },
            isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1, reducedMotion: 'reduce' });
        await context.addInitScript(() => {
            localStorage.setItem('seraphim_cookie_consent', 'essential'); localStorage.setItem('theme', 'light');
            localStorage.setItem('seraphim:experiment:activity-heatmap:v1:account:fixture-a', '{"version":1,"enabled":true}');
        });
        await context.route('https://**/*', route => route.fulfill({ status: 200, body: '' }));
        const page = await context.newPage();
        page.setDefaultTimeout(15_000);
        const errors = [], requests = [];
        page.on('pageerror', error => errors.push(error.message));
        page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
        page.on('request', request => { if (request.url().includes('/api/')) requests.push(request.url()); });
        await page.goto(`${process.env.HEATMAP_QA_URL ?? 'http://localhost:3010'}/heatmap-qa`);
        await ready(page);
        const click = async point => mobile ? page.touchscreen.tap(point.x, point.y) : page.mouse.click(point.x, point.y);
        const exactSelection = async phase => {
            await resetView(page);
            const point = await fixturePoint(page, intendedId);
            expect(point.exact).toContain(intendedId);
            expect(point.near.length).toBeGreaterThan(1);
            await click(point);
            await expect(page.getByLabel('Selected event')).toHaveText(intendedId);
            await expect(page.locator('.news-popup')).toBeVisible();
            await page.waitForFunction(() => !window.__heatmapMap.isMoving());
            expect(await page.evaluate(() => window.__heatmapMap.getSource('selected-news-event').serialize().data.features[0].properties.canonicalId)).toBe(intendedId);
            await page.screenshot({ path: `${output}/${name}-${phase}-exact.png` });
            await page.locator('.maplibregl-popup-close-button').click();
            await expect(page.getByLabel('Selected event')).toHaveText('none');
            return point;
        };
        const initialPoint = await exactSelection('initial');
        // Outside the tiny circle, within the old eight-pixel tolerance: the
        // nearest canonical dot remains accessible to mouse and actual touch.
        await resetView(page);
        const tolerantPoint = await fixturePoint(page, intendedId, 5);
        expect(tolerantPoint.exact).toEqual([]);
        await click(tolerantPoint);
        await expect(page.getByLabel('Selected event')).toHaveText(intendedId);
        await page.locator('.maplibregl-popup-close-button').click();
        await expect(page.getByLabel('Selected event')).toHaveText('none');

        await page.getByRole('button', { name: 'Draw & Measure', exact: true }).click();
        // Await the actual mobile mount/collapse, including lazy module loading.
        // A fixed delay can race its initial collapse under a busy cloud GPU.
        if (mobile) await expect(page.getByRole('button', { name: 'Expand panel', exact: true })).toBeVisible();
        const drawingCheck = async (mode, phase) => {
            await expandDrawing(page);
            await page.getByRole('button', { name: mode, exact: true }).click();
            await page.getByRole('button', { name: 'Collapse panel', exact: true }).click();
            await resetView(page);
            const point = await fixturePoint(page, intendedId);
            await assertDrawingClick(page, click, point);
            if (mode === 'Area') {
                // Verify the drawing engine received a real vertex, rather than
                // passing because the event never reached the canvas.
                await page.waitForFunction(() => Object.entries(window.__heatmapMap.getStyle().sources).some(([id]) =>
                    id.startsWith('td-') && window.__heatmapMap.getSource(id).serialize().data?.features?.length > 0));
            }
            if (mode === 'Text') await expect(page.getByPlaceholder('Type here...')).toBeVisible();
            await page.screenshot({ path: `${output}/${name}-${phase}-${mode.toLowerCase()}.png` });
            await expandDrawing(page);
            await page.getByRole('button', { name: 'Clear', exact: true }).click();
            await page.getByRole('button', { name: 'Collapse panel', exact: true }).click();
        };
        for (const mode of drawingModes) await drawingCheck(mode, 'initial');
        // Ownership must survive a full light/dark style replacement while the
        // drawing panel and active mode remain open.
        await page.getByRole('button', { name: 'Theme', exact: true }).click();
        await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
        await ready(page);
        await drawingCheck('Area', 'style-reload');
        await page.getByRole('button', { name: 'Close drawing tools', exact: true }).click();
        await exactSelection('style-reload');

        // The retained selected marker has its own delegated click listener;
        // drawing must suppress that route too, including redundant selections.
        await resetView(page);
        await click(await fixturePoint(page, intendedId));
        await expect(page.getByLabel('Selected event')).toHaveText(intendedId);
        await page.waitForFunction(() => !window.__heatmapMap.isMoving());
        // Hide only the popup UI so mobile controls and the canvas can receive
        // clicks without clearing React selection or bypassing map handlers.
        await page.evaluate(() => document.querySelector('.news-popup').closest('.maplibregl-popup').style.display = 'none');
        await page.getByRole('button', { name: 'Draw & Measure', exact: true }).click();
        await expandDrawing(page);
        await page.getByRole('button', { name: 'Area', exact: true }).click();
        await page.getByRole('button', { name: 'Collapse panel', exact: true }).click();
        await assertDrawingClick(page, click, await fixturePoint(page, intendedId));
        await page.getByRole('button', { name: 'Close drawing tools', exact: true }).click();
        expect(requests).toEqual([]); expect(errors).toEqual([]);
        report.push({ viewport: name, events: 1_000, intendedCanonicalId: intendedId, recordedReproPoint: { x: initialPoint.x, y: initialPoint.y },
            exactSelection: true, nearestToleranceSelection: true, actualTouch: mobile, drawingModes,
            drawingVertexReceived: true, noDrawingSelectionOrCameraMovement: true, selectedMarkerSuppressed: true,
            styleReloadSelectionAndOwnership: true, selectionRestoredAfterDrawingClose: true, apiRequests: requests.length, browserErrors: errors.length });
        await context.close();
    }
} finally {
    await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
    await browser.close();
}
console.log(JSON.stringify(report, null, 2));

async function ready(page) {
    await page.waitForFunction(() => window.__heatmapMap?.loaded() && !window.__heatmapMap.isMoving()
        && window.__heatmapMap.getLayer('experiment-activity-heatmap-hit'));
}
async function resetView(page) {
    await page.evaluate(() => window.__heatmapMap.jumpTo({ center: [14, 32.5], zoom: 5 }));
    await ready(page);
}
async function fixturePoint(page, id, offsetY = 0) {
    return page.evaluate(({ id, offsetY }) => {
        const map = window.__heatmapMap, layer = 'experiment-activity-heatmap-hit';
        const feature = map.getSource('experiment-activity-heatmap-source').serialize().data.features.find(f => f.properties.canonicalId === id);
        const projected = map.project(feature.geometry.coordinates), rect = map.getCanvas().getBoundingClientRect();
        const point = { x: Math.round(projected.x), y: Math.round(projected.y) + offsetY };
        return { x: point.x + rect.x, y: point.y + rect.y,
            exact: map.queryRenderedFeatures([point.x, point.y], { layers: [layer] }).map(f => f.properties.canonicalId),
            near: map.queryRenderedFeatures([[point.x - 8, point.y - 8], [point.x + 8, point.y + 8]], { layers: [layer] }).map(f => f.properties.canonicalId) };
    }, { id, offsetY });
}
async function expandDrawing(page) {
    if (await page.getByRole('button', { name: 'Expand panel', exact: true }).isVisible())
        await page.getByRole('button', { name: 'Expand panel', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Area', exact: true })).toBeVisible();
}
async function assertDrawingClick(page, click, point) {
    expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y) === window.__heatmapMap.getCanvas(), point)).toBe(true);
    const selected = page.getByLabel('Selected event');
    const before = { id: await selected.textContent(), version: await selected.getAttribute('data-selection-version') };
    const camera = await page.evaluate(() => {
        window.__drawingCameraMoves = 0;
        window.__drawingMapClicks = 0;
        window.__drawingMoveListener = () => { window.__drawingCameraMoves++; };
        window.__drawingClickListener = () => { window.__drawingMapClicks++; };
        window.__heatmapMap.on('movestart', window.__drawingMoveListener);
        window.__heatmapMap.on('click', window.__drawingClickListener);
        return { center: window.__heatmapMap.getCenter().toArray(), zoom: window.__heatmapMap.getZoom() };
    });
    await click(point);
    await page.waitForTimeout(150);
    await expect(selected).toHaveText(before.id);
    await expect(selected).toHaveAttribute('data-selection-version', before.version);
    const after = await page.evaluate(() => {
        window.__heatmapMap.off('movestart', window.__drawingMoveListener);
        window.__heatmapMap.off('click', window.__drawingClickListener);
        return { center: window.__heatmapMap.getCenter().toArray(), zoom: window.__heatmapMap.getZoom(), moves: window.__drawingCameraMoves, clicks: window.__drawingMapClicks };
    });
    expect(after).toEqual({ ...camera, moves: 0, clicks: 1 });
}
