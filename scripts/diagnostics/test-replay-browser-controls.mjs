/** Native input regressions. Run alongside test-replay-browser.mjs with the fixture server. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const artifactDir = 'artifacts/replay';
await mkdir(artifactDir, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'], headless: true });
const results = [];

async function openFixture(name, viewport, query = {}, timezoneId = 'UTC') {
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
    await page.goto(`http://127.0.0.1:4175/?${new URLSearchParams(query)}`);
    await page.waitForSelector('[data-revealed="true"]');
    return { page, finish: async checks => {
        assert.deepEqual(errors, [], `${name}: browser errors`);
        assert.deepEqual(outsideRequests, [], `${name}: external requests`);
        assert.deepEqual(await page.evaluate(() => Object.keys(localStorage).filter(key => key.includes('replay'))), []);
        results.push({ name, viewport, timezoneId, checks });
        await context.close();
    } };
}

async function assertFrame(page, timestamp, count) {
    await page.waitForFunction(expected => document.querySelector('section[aria-label="Reporting replay"] time')?.dateTime === expected, timestamp);
    assert.equal(await page.getByTestId('map-rows').getByRole('button', { includeHidden: true }).count(), count);
}

async function assertFocusedVisible(page, name) {
    const result = await page.evaluate(() => {
        const element = document.activeElement;
        const rect = element.getBoundingClientRect();
        const scroller = element.closest('section[aria-label="Reporting replay"]')?.lastElementChild;
        const scrollRect = scroller?.getBoundingClientRect();
        const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        return {
            focus: element.getAttribute('type') || element.textContent?.trim(),
            tag: element.tagName,
            rect: [rect.left, rect.top, rect.right, rect.bottom],
            scrollRect: scrollRect ? [scrollRect.left, scrollRect.top, scrollRect.right, scrollRect.bottom] : null,
            covering: hit?.tagName,
            visible: rect.top >= 0 && rect.bottom <= innerHeight && rect.left >= 0 && rect.right <= innerWidth
                && (!scrollRect || (rect.top >= scrollRect.top && rect.bottom <= scrollRect.bottom))
                && (element === hit || element.contains(hit)),
        };
    });
    if (!result.visible) {
        await page.screenshot({ path: `${artifactDir}/${name}-focus-failure.png` });
        console.log(JSON.stringify(result));
    }
    assert.equal(result.visible, true, `${name}: focused ${result.focus} must be visible and unobscured`);
}

try {
    // Include the exact review repro and a one-millisecond window whose arrows
    // must still advance instead of resetting onto a redundant slider position.
    for (const [name, from, to] of [
        ['custom-endpoint', '2026-09-29T12:00:00.000Z', '2026-09-30T11:59:59.999Z'],
        ['one-millisecond', '2026-09-30T11:59:59.123Z', '2026-09-30T11:59:59.124Z'],
    ]) {
        const { page, finish } = await openFixture(name, { width: 1440, height: 900 }, { t: 'custom', from, to, eventId: 'endpoint-end' });
        await page.evaluate(async bounds => {
            const fixture = await import('/services.tsx');
            fixture.changeFixture({ tier: 'analyst', rows: [bounds.from, bounds.to].map((publishedAt, index) => ({
                ...fixture.fixtureRows[0], id: index ? 'endpoint-end' : 'endpoint-start', title: index ? 'Last report' : 'First report', publishedAt, sources: [],
            })) });
        }, { from, to });
        await page.getByRole('button', { name: 'Freeze loaded view', exact: true }).click();
        const slider = page.getByRole('slider', { name: 'Reporting cursor' });
        await assertFrame(page, to, 2);
        await slider.press('Home');
        await assertFrame(page, from, 1);
        assert.match(await page.getByRole('region', { name: 'Reporting replay' }).textContent(), /Selected event is outside/);
        await slider.press('End');
        await assertFrame(page, to, 2);
        await slider.press('ArrowLeft');
        assert.equal(await page.getByTestId('map-rows').getByRole('button', { includeHidden: true }).count(), 1);
        await slider.press('End');
        await slider.scrollIntoViewIfNeeded();
        const rect = await slider.boundingBox();
        await page.mouse.move(rect.x + rect.width - 1, rect.y + rect.height / 2);
        await page.mouse.down();
        await page.mouse.move(rect.x + 1, rect.y + rect.height / 2, { steps: 10 });
        await page.mouse.up();
        await assertFrame(page, from, 1);
        // The selected-event warning may resize the panel between the drags.
        const returnedRect = await slider.boundingBox();
        await page.mouse.move(returnedRect.x + 1, returnedRect.y + returnedRect.height / 2);
        await page.mouse.down();
        await page.mouse.move(returnedRect.x + returnedRect.width - 1, returnedRect.y + returnedRect.height / 2, { steps: 10 });
        await page.mouse.up();
        await assertFrame(page, to, 2);
        if (name === 'one-millisecond') {
            await slider.press('Home');
            await slider.press('ArrowRight');
            await assertFrame(page, to, 2);
        }
        assert.equal(new URL(page.url()).searchParams.get('eventId'), 'endpoint-end');
        await page.screenshot({ path: `${artifactDir}/${name}-native.png` });
        await finish('exact custom bounds, native Home/End/arrows and pointer drags, endpoint reports, preserved URL selection');
    }

    for (const [name, viewport] of [['narrow', { width: 320, height: 568 }], ['landscape', { width: 844, height: 390 }]]) {
        const { page, finish } = await openFixture(name, viewport, { eventId: 'fixture-3' }, 'America/New_York');
        await page.getByRole('button', { name: 'Use Analyst fixture', exact: true }).click();
        await page.getByRole('button', { name: 'Freeze loaded view', exact: true }).click();
        await page.getByRole('button', { name: 'Return live', exact: true }).focus();
        await page.keyboard.press('Tab');
        assert.equal(await page.getByRole('slider', { name: 'Reporting cursor' }).evaluate(element => element === document.activeElement), true, `${name}: slider must lead visual and tab order`);
        await assertFocusedVisible(page, name);
        await page.screenshot({ path: `${artifactDir}/${name}-focused-slider.png` });
        await page.keyboard.press('Home');
        await page.keyboard.press('ArrowRight');
        for (let index = 0; index < 4; index++) {
            await page.keyboard.press('Tab');
            await assertFocusedVisible(page, name);
        }
        // Focus is now the comparison summary. Open both editors by keyboard,
        // then traverse every input and button through the scrolling body.
        await page.keyboard.press('Enter');
        for (let index = 0; index < 3; index++) {
            await page.keyboard.press('Tab');
            await assertFocusedVisible(page, name);
        }
        await page.keyboard.press('Enter');
        const visited = new Set();
        for (let index = 0; index < 60; index++) {
            await page.keyboard.press('Tab');
            await assertFocusedVisible(page, name);
            const focused = await page.evaluate(() => {
                const element = document.activeElement;
                return (element.closest('label')?.textContent || element.textContent)?.trim();
            });
            visited.add(focused);
            if (focused === 'Reconstruction and coverage') break;
        }
        for (const control of ['Window A start (local time)', 'Window A end (local time)', 'Apply A', 'Window B start (local time)', 'Window B end (local time)', 'Apply B', 'Reconstruction and coverage']) assert.equal(visited.has(control), true, `${name}: tab must reach ${control}`);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        await finish('native tab/visual order, unobscured focused slider/buttons/select/summaries/editors, no horizontal overflow');
    }

    for (const [name, from, to, explanation] of [
        ['future-capture', '2026-10-01T00:00:00Z', '2026-10-02T00:00:00Z', /future reporting/],
        ['reversed-capture', '2026-09-30T11:00:00Z', '2026-09-29T12:00:00Z', /after the start/],
        ['invalid-calendar-capture', '2026-02-30T12:00:00Z', '2026-09-30T11:00:00Z', /valid custom/],
    ]) {
        const { page, finish } = await openFixture(name, { width: 390, height: 844 }, { t: 'custom', from, to });
        await page.getByRole('button', { name: 'Use Analyst fixture', exact: true }).click();
        const action = page.getByRole('button', { name: 'Freeze loaded view', exact: true });
        assert.equal(await action.isDisabled(), true);
        assert.match(await page.getByRole('region', { name: 'Reporting replay' }).getByRole('status').textContent(), explanation);
        const description = await action.getAttribute('aria-describedby');
        assert.match(await page.locator(`[id="${description}"]`).textContent(), explanation);
        assert.equal(await page.getByRole('slider').count(), 0);
        await page.screenshot({ path: `${artifactDir}/${name}.png` });
        await finish('disabled capture with visible, accessible validation explanation');
    }
    await writeFile(`${artifactDir}/browser-controls-results.json`, JSON.stringify(results, null, 2));
    console.log(JSON.stringify(results, null, 2));
} finally { await browser.close(); }
