import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
const require = createRequire(resolve(process.env.DRAWING_QA_PACKAGE_ROOT ?? '.', 'package.json'));
const { chromium, expect } = require('@playwright/test');
const artifactDir = resolve(process.env.DRAWING_QA_ARTIFACTS ?? 'artifacts/drawing-history');
await mkdir(artifactDir, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/chromium', args: ['--no-sandbox'] });
const baseUrl = process.env.DRAWING_QA_URL ?? 'http://127.0.0.1:4175';
const results = [];
async function scenario(name, options, run) {
  const context = await browser.newContext(options);
  // Fixture uses real MapLibre/TerraDraw with a blank style and no external services.
  await context.route('**/*', route => new URL(route.request().url()).origin === new URL(baseUrl).origin
    ? route.continue() : route.abort());
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(baseUrl); await page.waitForSelector('canvas');
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
  const tools = page.locator('[data-drawing-tools]');
  const button = name => tools.getByRole('button', { name, exact: true });
  const state = () => page.evaluate(() => JSON.parse(localStorage.getItem('seraphim-experiment-drawing-history-v2:fixture-a') ?? '{"drawFeatures":[],"textAnnotations":[]}'));
  try {
    await run({ page, context, button, state, tools });
    await expect.poll(async () => Number(await page.getByLabel('Rendered drawings').innerText())).toBeGreaterThan(0);
    await expect(page.locator('[data-fixture-error]')).toHaveCount(0);
    assert.deepEqual(errors, [], 'No browser runtime/console errors');
    await page.screenshot({ path: resolve(artifactDir, `${name}.png`), fullPage: true });
    results.push({ scenario: name, passed: true });
  } catch (error) {
    await page.screenshot({ path: resolve(artifactDir, `${name}-failure.png`), fullPage: true });
    console.error('QA failure state', await page.evaluate(() => ({ storage: Object.entries(localStorage), buttons: Array.from(document.querySelectorAll('[data-drawing-tools] button')).map(b => ({ text: b.textContent, title: b.title, disabled: b.disabled })) })));
    throw error;
  } finally { await context.close(); }
}
try {
  await scenario('desktop', { viewport: { width: 1440, height: 1000 } }, async ({ page, button, state, tools }) => {
    const clickMap = (x, y) => page.mouse.click(x, y);
    await button('Pin').click(); await clickMap(320, 320);
    await expect.poll(async () => (await state()).drawFeatures.length).toBe(1);
    const first = await state();
    await button('Undo').click(); assert.equal((await state()).drawFeatures.length, 0);
    await button('Redo').click(); assert.deepEqual(await state(), first);
    await button('Select').click(); await clickMap(320, 320);
    await expect(button('Duplicate')).toBeEnabled();
    // One long drag, including multiple intermediate adapter updates, is one undo.
    await page.mouse.move(320, 320); await page.mouse.down(); await page.mouse.move(400, 370, { steps: 20 }); await page.mouse.up();
    await expect.poll(async () => JSON.stringify((await state()).drawFeatures[0].geometry)).not.toBe(JSON.stringify(first.drawFeatures[0].geometry));
    const moved = await state();
    await button('Undo').click(); assert.deepEqual(await state(), first);
    await button('Redo').click(); assert.deepEqual(await state(), moved);
    await clickMap(400, 370);
    await tools.getByRole('button', { name: 'Use #ef4444 as the draw color' }).click();
    await page.getByRole('textbox', { name: 'Outside editor' }).click();
    await expect.poll(async () => (await state()).drawFeatures[0].properties.color).toBe('#ef4444');
    const styled = await state();
    await button('Duplicate').click();
    await expect.poll(async () => (await state()).drawFeatures.length).toBe(2);
    const duplicate = await state();
    assert.notEqual(duplicate.drawFeatures[0].id, duplicate.drawFeatures[1].id);
    assert.deepEqual(duplicate.drawFeatures[0].properties, duplicate.drawFeatures[1].properties);
    await button('Undo').click(); assert.deepEqual(await state(), styled);
    // A new operation after undo discards redo.
    await button('Text').click(); await clickMap(530, 450);
    const text = page.getByRole('textbox', { name: 'Edit the text annotation' });
    await text.fill('Example annotation'); await text.press('Enter');
    await expect.poll(async () => (await state()).textAnnotations[0]?.text).toBe('Example annotation');
    await expect(button('Redo')).toBeDisabled();
    const beforeTyping = await state();
    await text.click(); await text.press('End'); await text.pressSequentially(' edited');
    // Native typing undo is left to the textarea and never triggers document history.
    const shapeBeforeNativeUndo = JSON.stringify((await state()).drawFeatures);
    await text.press('Control+z'); assert.equal(JSON.stringify((await state()).drawFeatures), shapeBeforeNativeUndo);
    await text.fill('Updated annotation'); await text.press('Enter');
    await button('Undo').click(); await expect(text).toHaveValue('Example annotation');
    assert.deepEqual(await state(), beforeTyping);
    await button('Redo').click(); await expect(text).toHaveValue('Updated annotation');
    const beforeReload = await state();
    await page.getByRole('button', { name: 'Reload style', exact: true }).click();
    await expect(button('Undo')).toBeEnabled();
    assert.deepEqual(await state(), beforeReload);
    await button('Undo').click(); await expect(text).toHaveValue('Example annotation');
    await button('Redo').click();
    // Clear reverses both text and shapes together.
    await button('Clear').click(); assert.equal((await state()).drawFeatures.length, 0); assert.equal((await state()).textAnnotations.length, 0);
    await button('Undo').click(); assert.deepEqual(await state(), beforeReload);
    // Invalid batch: first valid feature would previously have been accepted on its own.
    const chooser = page.waitForEvent('filechooser'); await button('Import').click();
    await (await chooser).setFiles({ name: 'invalid.geojson', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ type: 'FeatureCollection', features: [
      { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: {} },
      { type: 'Feature', geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] }, properties: { mode: 'circle' } },
    ] })) });
    await expect(page.getByRole('alert')).toBeVisible(); assert.deepEqual(await state(), beforeReload);
    await expect(button('Redo')).toBeEnabled();
    // Generic GeoJSON without TerraDraw mode, plus text, imports atomically with fresh IDs.
    const validChooser = page.waitForEvent('filechooser'); await button('Import').click();
    await (await validChooser).setFiles({ name: 'valid.geojson', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ type: 'FeatureCollection', features: [
      { type: 'Feature', id: 'external', geometry: { type: 'Point', coordinates: [10, 10] }, properties: { color: '#10b981', size: 8 } },
      { type: 'Feature', geometry: { type: 'Point', coordinates: [11, 11] }, properties: { isText: true, text: 'Imported text', initialZoom: 3 } },
    ] })) });
    await expect.poll(async () => (await state()).drawFeatures.length).toBe(2);
    const imported = await state();
    await button('Undo').click(); assert.deepEqual(await state(), beforeReload);
    await button('Redo').click(); assert.deepEqual(await state(), imported);
    // Outside editor focus does not claim document shortcuts.
    const outside = page.getByRole('textbox', { name: 'Outside editor' });
    await outside.fill('Native field'); await outside.press('Control+z'); assert.deepEqual(await state(), imported);
    // Keyboard shortcuts when the toolbar owns focus.
    await button('Select').focus(); await page.keyboard.press('Control+z'); assert.deepEqual(await state(), beforeReload);
    await page.keyboard.press('Control+Shift+z'); assert.deepEqual(await state(), imported);
    await page.keyboard.press('Control+z'); await page.keyboard.press('Control+y'); assert.deepEqual(await state(), imported);
    // Account switch removes private UI immediately and remounts without session history.
    await page.getByRole('button', { name: 'Switch account' }).click();
    await expect(page.getByRole('textbox', { name: 'Edit the text annotation' })).toHaveCount(0);
    await expect(button('Undo')).toBeDisabled();
    await page.getByRole('button', { name: 'Switch account' }).click();
    await expect(page.getByRole('textbox', { name: 'Edit the text annotation' })).toHaveCount(2);
    await expect(button('Undo')).toBeDisabled(); assert.deepEqual(await state(), imported);
  });
  await scenario('geometry-editing', { viewport: { width: 1440, height: 1000 } }, async ({ page, button, state, tools }) => {
    const clickMap = (x, y) => page.mouse.click(x, y);
    const drag = async (from, to) => {
      await page.mouse.move(...from); await page.mouse.down(); await page.mouse.move(...to, { steps: 12 }); await page.mouse.up();
    };
    await button('Area').click();
    for (const point of [[200, 250], [400, 250], [400, 450], [200, 450], [200, 250]]) await clickMap(...point);
    await expect.poll(async () => (await state()).drawFeatures.length).toBe(1);
    const polygon = await state(); assert.equal(polygon.drawFeatures[0].geometry.type, 'Polygon');
    assert.ok((await tools.innerText()).includes('sq km'));
    await button('Select').click(); await clickMap(300, 350);
    await expect(button('Delete')).toBeEnabled();
    await drag([200, 250], [175, 220]);
    await expect.poll(async () => JSON.stringify((await state()).drawFeatures[0].geometry)).not.toBe(JSON.stringify(polygon.drawFeatures[0].geometry));
    await button('Undo').click(); assert.deepEqual(await state(), polygon);
    await button('Redo').click();
    await button('Undo').click();
    await clickMap(300, 350); await clickMap(300, 250);
    await expect.poll(async () => (await state()).drawFeatures[0].geometry.coordinates[0].length).toBe(6);
    await button('Undo').click(); assert.deepEqual(await state(), polygon);
    await button('Rect').click(); await drag([500, 250], [650, 370]);
    await expect.poll(async () => (await state()).drawFeatures.length).toBe(2);
    const rectangle = await state(); assert.equal(rectangle.drawFeatures[1].properties.mode, 'rectangle');
    await button('Undo').click(); assert.deepEqual(await state(), polygon);
    await button('Redo').click(); assert.deepEqual(await state(), rectangle);
    await button('Circle').click(); await drag([700, 300], [780, 370]);
    await expect.poll(async () => (await state()).drawFeatures.length).toBe(3);
    const circle = await state(); assert.equal(circle.drawFeatures[2].properties.mode, 'circle');
    await button('Undo').click(); assert.deepEqual(await state(), rectangle);
    await button('Redo').click(); assert.deepEqual(await state(), circle);
    await button('Ruler').click(); await clickMap(200, 600); await clickMap(400, 620); await clickMap(400, 620);
    await expect.poll(async () => (await state()).drawFeatures.length).toBe(4);
    assert.equal((await state()).drawFeatures[3].properties.mode, 'linestring');
    await button('Text').click(); await clickMap(600, 550);
    const text = page.getByRole('textbox', { name: 'Edit the text annotation' }); await text.fill('Move this text'); await text.press('Enter');
    const beforeMove = await state();
    const handle = page.getByTitle('Drag to move'); const bounds = await handle.boundingBox();
    await drag([bounds.x + bounds.width / 2, bounds.y + bounds.height / 2], [bounds.x + 70, bounds.y + 50]);
    await expect.poll(async () => JSON.stringify((await state()).textAnnotations[0].lngLat)).not.toBe(JSON.stringify(beforeMove.textAnnotations[0].lngLat));
    await button('Undo').click(); assert.deepEqual(await state(), beforeMove);
    // Export keeps the existing FeatureCollection/text-point representation.
    const download = page.waitForEvent('download'); await button('Export').click();
    const saved = await (await download).path();
    const { readFile } = await import('node:fs/promises'); const exported = JSON.parse(await readFile(saved, 'utf8'));
    assert.equal(exported.type, 'FeatureCollection'); assert.equal(exported.features.length, 5);
    assert.equal(exported.features.at(-1).properties.isText, true); assert.equal(exported.features.at(-1).properties.text, 'Move this text');
  });
  await scenario('mobile-touch', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }, async ({ page, button, state, tools }) => {
    await tools.getByRole('button', { name: 'Expand panel' }).tap();
    await button('Sketch').tap();
    await tools.getByRole('button', { name: 'Collapse panel' }).tap();
    const client = await page.context().newCDPSession(page);
    const touch = (type, x, y) => client.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
    await touch('touchStart', 50, 400);
    for (let x = 55; x <= 280; x += 15) await touch('touchMove', x, 400 + Math.sin(x / 35) * 25);
    await touch('touchEnd');
    await expect.poll(async () => (await state()).drawFeatures.length).toBe(1);
    const sketch = await state(); assert.equal(sketch.drawFeatures[0].properties.mode, 'freehand-linestring');
    assert.ok(sketch.drawFeatures[0].geometry.coordinates.length > 3);
    await button('Undo').tap(); await expect.poll(async () => (await state()).drawFeatures.length).toBe(0);
    await button('Redo').tap(); await expect.poll(state).toEqual(sketch);
    // History remains accessible while the mobile drawing panel is collapsed.
    const bounds = await tools.boundingBox(); assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 390);
    await tools.getByRole('button', { name: 'Expand panel' }).tap(); await button('Eraser').tap();
    await tools.getByRole('button', { name: 'Collapse panel' }).tap();
    await touch('touchStart', 50, 400); await touch('touchMove', 120, 400); await touch('touchEnd');
    await expect.poll(async () => (await state()).drawFeatures.length).toBe(0);
    await button('Undo').tap(); await expect.poll(state).toEqual(sketch);
    await tools.getByRole('button', { name: 'Expand panel' }).tap(); await button('Pin').tap();
    await tools.getByRole('button', { name: 'Collapse panel' }).tap(); await page.touchscreen.tap(175, 520);
    await expect.poll(async () => (await state()).drawFeatures.length).toBe(2);
    await tools.getByRole('button', { name: 'Expand panel' }).tap(); await button('Select').tap();
    await tools.getByRole('button', { name: 'Collapse panel' }).tap(); await page.touchscreen.tap(175, 520);
    await expect(button('Delete')).toBeEnabled(); await button('Delete').tap();
    await expect.poll(async () => (await state()).drawFeatures.length).toBe(1);
    await button('Undo').tap(); await expect.poll(async () => (await state()).drawFeatures.length).toBe(2);
  });
  console.log(JSON.stringify({ results, artifactDir }, null, 2));
} finally { await browser.close(); }
