/** Run after replay-browser-server.mjs. Requires Playwright and a local Chromium. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const artifactDir = 'artifacts/replay';
await mkdir(artifactDir, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'], headless: true });
const results = [];
try {
    for (const [name, viewport, timezoneId] of [['desktop', { width: 1440, height: 900 }, 'UTC'], ['mobile', { width: 390, height: 844 }, 'America/New_York']]) {
        const context = await browser.newContext({ viewport, timezoneId });
        const page = await context.newPage();
        const errors = [];
        const outsideRequests = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.route('**/*', route => {
            if (new URL(route.request().url()).hostname === '127.0.0.1') return route.continue();
            outsideRequests.push(route.request().url());
            return route.abort();
        });
        await page.clock.setFixedTime(new Date('2026-09-30T12:00:00Z'));
        await page.goto('http://127.0.0.1:4175/?eventId=fixture-3');
        await page.waitForSelector('[data-revealed="true"]');
        await page.getByRole('button', { name: 'Freeze loaded view', exact: true }).waitFor({ state: 'visible' });
        await page.screenshot({ path: `${artifactDir}/${name}-live.png` });
        await page.getByRole('button', { name: 'Freeze loaded view', exact: true }).click();
        const slider = page.getByRole('slider', { name: 'Reporting cursor' });
        await slider.evaluate(element => {
            const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
            set.call(element, String(Date.parse('2026-09-30T00:00:00Z')));
            element.dispatchEvent(new Event('input', { bubbles: true }));
            element.dispatchEvent(new Event('change', { bubbles: true }));
        });
        await page.waitForFunction(() => document.querySelector('[data-testid="map-rows"]').querySelectorAll('button').length === 2).catch(async error => { await page.screenshot({ path: `${artifactDir}/${name}-failure.png` }); console.log(name, await page.getByRole('region', { name: 'Reporting replay' }).textContent()); throw error; });
        assert.equal(await page.getByTestId('map-rows').getByRole('button', { includeHidden: true }).count(), 2);
        assert.match(await page.getByRole('region', { name: 'Reporting replay' }).textContent(), /Selected event is outside/);
        assert.equal(await page.getByTestId('selected-id').textContent(), 'fixture-3');
        assert.equal(new URL(page.url()).searchParams.get('eventId'), 'fixture-3');
        await page.getByRole('button', { name: 'Play', exact: true }).click();
        await page.waitForFunction(() => Number(document.querySelector('input[type="range"]').value) > Date.parse('2026-09-30T00:00:00Z'));
        await page.getByRole('button', { name: 'Pause', exact: true }).click();
        await page.getByRole('button', { name: 'Inject late response', exact: true }).click();
        assert.equal(await page.getByTestId('map-rows').getByRole('button', { includeHidden: true }).count(), 2);
        await page.getByText('Compare two reporting windows', { exact: true }).click();
        assert.equal(await page.getByRole('table').count(), 1);
        if (name === 'mobile') await page.getByRole('button', { name: 'Map', exact: true }).click();
        await page.screenshot({ path: `${artifactDir}/${name}-comparison.png` });
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
        assert.equal(overflow, false, `${name}: horizontal overflow`);
        await page.getByRole('button', { name: 'Refresh snapshot', exact: true }).click();
        assert.equal(await page.getByTestId('map-rows').getByRole('button', { includeHidden: true }).count(), 4);
        await page.getByRole('button', { name: 'Return live', exact: true }).click();
        assert.equal(await slider.count(), 0);
        await page.getByRole('button', { name: 'Use Analyst fixture', exact: true }).click();
        await page.getByRole('button', { name: 'Freeze loaded view', exact: true }).click();
        await page.getByText('Compare two reporting windows', { exact: true }).click();
        await page.getByText('Edit comparison bounds (local time)', { exact: true }).click();
        await page.getByRole('button', { name: 'Apply A', exact: true }).click();
        assert.equal(await page.getByRole('alert').count(), 0, `${name}: default local bounds must round-trip`);
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent === 'Play' && button.disabled));
        assert.equal(await page.getByRole('button', { name: 'Play', exact: true }).isDisabled(), true);
        await page.screenshot({ path: `${artifactDir}/${name}-analyst.png` });
        await page.getByRole('button', { name: 'Switch to free account', exact: true }).click();
        assert.equal(await slider.count(), 0);
        assert.equal(await page.getByRole('button', { name: 'Replay · Pro', exact: true }).isDisabled(), true);
        assert.equal(await page.getByTestId('map-rows').getByRole('button', { includeHidden: true }).count(), 0);
        assert.equal(new URL(page.url()).searchParams.get('eventId'), 'fixture-3');
        assert.deepEqual(await page.evaluate(() => Object.keys(localStorage).filter(key => key.includes('replay'))), []);
        assert.deepEqual(errors, [], `${name}: browser errors`);
        assert.deepEqual(outsideRequests, [], `${name}: fixture must not call external services`);
        results.push({ name, viewport, timezoneId, checks: 'freeze/scrub/play/pause/late response/compare/refresh/restore/selection/account switch/permissions/reduced motion/no persistence/no external network', errors });
        await context.close();
    }
    await writeFile(`${artifactDir}/browser-results.json`, JSON.stringify(results, null, 2));
    console.log(JSON.stringify(results, null, 2));
} finally { await browser.close(); }
