import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const desktop = { viewport: { width: 1440, height: 1000 } };
const key = 'seraphim-experiment-drawing-history-v2:fixture-a';
const drag = async (page, from, to) => {
  await page.mouse.move(...from); await page.mouse.down(); await page.mouse.move(...to, { steps: 12 });
};
const rawState = page => page.evaluate(key => localStorage.getItem(key), key);
const rendered = page => page.evaluate(() => window.__drawingFixture.renderedPoints());
const rendersPoint = async (page, coordinates) => {
  const points = await rendered(page);
  return points.length === 1 && points[0].every((value, index) => Math.abs(value - coordinates[index]) < 1e-6);
};

/** Exact Astra interruption cases, with real browser input and rendered geometry. */
export async function verifyRegressions(scenario, expect) {
  await scenario('eraser-global-termination', desktop, async ({ page, button, state }) => {
    await button('Pin').click();
    for (const p of [[300, 300], [500, 400], [650, 500]]) await page.mouse.click(...p);
    await expect.poll(async () => (await state()).drawFeatures.length).toBe(3);
    const initial = await state(); await button('Eraser').click();
    const bounds = await button('Undo').boundingBox();
    await drag(page, [300, 300], [bounds.x + 10, bounds.y + 10]); await page.mouse.up();
    await expect.poll(async () => (await state()).drawFeatures.length).toBe(2);
    const erased = await state(); await page.mouse.move(500, 400, { steps: 12 });
    await expect.poll(async () => Number(await page.getByLabel('Rendered drawings').innerText())).toBe(2);
    assert.deepEqual(await state(), erased);
    await button('Undo').click(); assert.deepEqual(await state(), initial); // one transaction
    for (const interruption of ['blur', 'pointercancel', 'lostpointercapture']) {
      await page.mouse.move(300, 300); await page.mouse.down();
      await page.evaluate(type => {
        if (type === 'blur') window.dispatchEvent(new Event('blur'));
        else document.querySelector('canvas').dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
      }, interruption);
      await page.mouse.move(500, 400, { steps: 8 }); await page.mouse.up();
      await expect.poll(async () => (await state()).drawFeatures.length).toBe(2);
      await expect.poll(async () => Number(await page.getByLabel('Rendered drawings').innerText())).toBe(2);
      await button('Undo').click(); assert.deepEqual(await state(), initial);
    }
  });

  await scenario('recovery-during-drag', desktop, async ({ page, button, state }) => {
    await button('Pin').click(); await page.mouse.click(300, 300); await button('Select').click(); await page.mouse.click(300, 300);
    const initial = await state();
    await drag(page, [300, 300], [450, 400]);
    await page.getByRole('button', { name: 'Reload style', exact: true }).evaluate(el => el.click()); await page.mouse.up();
    // Source/worker rendering is asynchronous; wait for the restored coordinates, not a stale drag frame.
    await expect.poll(() => rendersPoint(page, initial.drawFeatures[0].geometry.coordinates)).toBe(true);
    assert.deepEqual(await state(), initial);
    const beforeNavigation = await rendered(page);
    assert.equal(beforeNavigation.length, 1);
    assert.ok(Math.abs(beforeNavigation[0][0] - initial.drawFeatures[0].geometry.coordinates[0]) < 1e-6);
    await button('Undo').click(); assert.equal((await state()).drawFeatures.length, 0);
    await button('Redo').click(); assert.deepEqual(await state(), initial);
    await page.reload(); await page.waitForSelector('canvas');
    await expect.poll(() => rendersPoint(page, initial.drawFeatures[0].geometry.coordinates)).toBe(true);
    assert.deepEqual(await state(), initial);
    assert.ok(Math.abs((await rendered(page))[0][0] - beforeNavigation[0][0]) < 1e-6);
    await button('Select').click(); await page.mouse.click(300, 300);
    await drag(page, [300, 300], [400, 350]); await page.mouse.up();
    await expect.poll(async () => JSON.stringify((await state()).drawFeatures[0].geometry)).not.toBe(JSON.stringify(initial.drawFeatures[0].geometry));
    const moved = await state();
    for (let i = 0; i < 20; i++) { await button('Undo').click(); assert.deepEqual(await state(), initial); await button('Redo').click(); assert.deepEqual(await state(), moved); }
  });

  await scenario('rapid-selection-drag-recovery', desktop, async ({ page, button, state }) => {
    for (let trial = 0; trial < 8; trial++) {
      if (trial > 0) await button('Clear').click();
      await button('Pin').click(); await page.mouse.click(300, 300);
      await expect.poll(async () => (await state()).drawFeatures.length).toBe(1);
      const initial = await state();
      await button('Select').click(); await page.mouse.click(300, 300);
      // No state read/wait here: the selection release can still be pending when this drag begins.
      await drag(page, [300, 300], [450, 400]);
      await page.getByRole('button', { name: 'Reload style', exact: true }).evaluate(el => el.click());
      await page.mouse.up();
      await expect.poll(() => rendersPoint(page, initial.drawFeatures[0].geometry.coordinates)).toBe(true);
      await page.waitForTimeout(5000);
      assert.deepEqual(await state(), initial, `trial ${trial}: persisted document after five seconds`);
      assert.equal(await rendersPoint(page, initial.drawFeatures[0].geometry.coordinates), true, `trial ${trial}: displayed document after five seconds`);
      await button('Undo').click(); assert.equal((await state()).drawFeatures.length, 0);
      await button('Redo').click(); assert.deepEqual(await state(), initial);
      await page.reload(); await page.waitForSelector('canvas');
      await expect.poll(() => rendersPoint(page, initial.drawFeatures[0].geometry.coordinates)).toBe(true);
      assert.deepEqual(await state(), initial, `trial ${trial}: document after navigation`);
      await expect(button('Undo')).toBeDisabled(); // History is intentionally limited to this session.
    }
  });

  await scenario('text-creation-transaction', desktop, async ({ page, button, state }) => {
    await button('Pin').click(); await page.mouse.click(300, 300); const initial = await state();
    await button('Text').click(); await page.mouse.click(500, 500);
    const text = page.getByTitle('Edit the text annotation'); await text.pressSequentially('Alpha'); await text.press('Enter');
    const typed = await state();
    await button('Undo').click(); assert.deepEqual(await state(), initial); await expect(text).toHaveCount(0);
    await button('Redo').click(); await expect(text).toHaveValue('Alpha');
    await page.mouse.click(600, 600);
    const empty = page.getByTitle('Edit the text annotation').nth(1); await empty.press('Enter');
    assert.deepEqual(await state(), typed);
    await button('Undo').click(); assert.deepEqual(await state(), initial); // no empty creation/deletion entries
    await button('Redo').click(); await expect(text).toHaveValue('Alpha');
    await text.click(); await text.press('End'); await text.pressSequentially(' Beta');
    await text.press('Control+z'); await expect(text).not.toHaveValue('Alpha Beta');
    await text.press('Control+Shift+z'); await expect(text).toHaveValue('Alpha Beta'); await text.press('Enter');
    await button('Undo').click(); await expect(text).toHaveValue('Alpha');
    await button('Eraser').click(); await text.click();
    await expect(text).toHaveCount(0); assert.deepEqual(await state(), initial);
    await button('Undo').click(); await expect(text).toHaveValue('Alpha');
  });

  for (const engineRejection of [false, true]) {
    const malformed = JSON.stringify({ version: 2, drawFeatures: [{ type: 'Feature', id: '11111111-1111-4111-8111-111111111111',
      properties: { mode: 'circle', color: '#5f62ec', size: 4 }, geometry: engineRejection
        ? { type: 'Polygon', coordinates: [[[0, 0], [10, 10], [0, 10], [10, 0], [0, 0]]] }
        : { type: 'Point', coordinates: [0, 0] } }], textAnnotations: [] });
    await scenario(engineRejection ? 'protected-engine-rejection' : 'protected-malformed-save', desktop, async ({ page, button, state }) => {
      await expect(page.getByRole('alert')).toBeVisible(); assert.equal(await rawState(page), malformed);
      await button('Pin').click(); assert.equal(await rawState(page), malformed);
      await page.mouse.click(300, 300); assert.equal(await rawState(page), malformed);
      await button('Clear').click(); assert.equal(await rawState(page), malformed);
      const download = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download saved copy' }).click();
      assert.equal(await readFile(await (await download).path(), 'utf8'), malformed);
      await page.mouse.click(300, 300);
      await page.getByRole('button', { name: 'Reload style', exact: true }).click();
      await expect.poll(async () => Number(await page.getByLabel('Rendered drawings').innerText())).toBeGreaterThan(0);
      assert.equal(await rawState(page), malformed); await expect(page.getByRole('alert')).toBeVisible();
      await page.getByRole('button', { name: 'Save current drawings instead' }).click();
      await expect(page.getByRole('alert')).toHaveCount(0); assert.notEqual(await rawState(page), malformed);
      assert.equal((await state()).drawFeatures.length, 1);
      await button('Undo').click(); assert.equal(await rawState(page), null);
      await button('Redo').click(); assert.equal((await state()).drawFeatures.length, 1);
    }, async context => {
      await context.addInitScript(({ key, malformed }) => localStorage.setItem(key, malformed), { key, malformed });
    });
  }

  await scenario('mobile-storage-and-media', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' }, async ({ page, button, tools }) => {
    const handle = page.getByTitle('Drag to move');
    const css = await handle.evaluate(el => ({ opacity: getComputedStyle(el).opacity, width: getComputedStyle(el).width }));
    assert.equal(css.opacity, '1'); assert.equal(css.width, '28px');
    await tools.getByRole('button', { name: 'Expand panel' }).tap();
    assert.equal(await page.getByTitle('Custom color', { exact: true }).evaluate(el => getComputedStyle(el).animationName), 'none');
    await button('Pin').tap(); await tools.getByRole('button', { name: 'Collapse panel' }).tap(); await page.touchscreen.tap(175, 600);
    await expect(page.getByRole('alert')).toBeVisible(); await expect(page.getByRole('alert')).toContainText('could not be saved');
    await page.getByRole('button', { name: 'Toggle tools', exact: true }).tap();
    await expect(page.getByRole('alert')).toBeVisible();
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('seraphim-experiment-drawing-history-v2:fixture-a')).drawFeatures.length), 0);
  }, async context => {
    await context.addInitScript(() => {
      localStorage.setItem('seraphim-experiment-drawing-history-v2:fixture-a', JSON.stringify({ version: 2, drawFeatures: [],
        textAnnotations: [{ id: 'test-text', lngLat: [0, 0], text: 'Restored text', initialZoom: 3 }] }));
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function(key, value) {
        if (key.startsWith('seraphim-experiment-drawing-history-v2:')) throw new DOMException('Quota', 'QuotaExceededError');
        return original.call(this, key, value);
      };
    });
  });

  await scenario('drawing-story-ownership', desktop, async ({ page, button }) => {
    const owns = page.getByLabel('Drawing owns map pointer'); const picks = page.getByLabel('Fixture story picks');
    for (const mode of ['Pin', 'Text', 'Area', 'Ruler', 'Select', 'Rect', 'Circle', 'Sketch', 'Eraser']) {
      await button(mode).click(); await expect(owns).toHaveText('true'); await page.mouse.click(720, 500);
      await expect(picks).toHaveText('0');
      if (mode === 'Text') { const text = page.getByTitle('Edit the text annotation'); await text.fill('Ownership text'); await text.press('Enter'); }
      if (mode === 'Eraser') await button('Undo').click();
      else await page.keyboard.press('Escape');
    }
    await page.getByRole('button', { name: 'Toggle tools', exact: true }).click(); await expect(owns).toHaveText('false');
    // The text marker overlaps the synthetic story; its own pointer stream must stay protected.
    const handle = page.getByTitle('Drag to move'); const bounds = await handle.boundingBox();
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2); await page.mouse.down(); await expect(owns).toHaveText('true');
    await page.mouse.up(); await expect(owns).toHaveText('false'); await expect(picks).toHaveText('0');
    await page.getByRole('button', { name: 'Toggle tools', exact: true }).click();
    await page.getByRole('button', { name: 'Switch account', exact: true }).click(); await expect(owns).toHaveText('false');
    await page.mouse.click(720, 500); await expect(picks).toHaveText('1');
    await button('Pin').click(); await page.mouse.click(300, 320); await expect(owns).toHaveText('true');
    await page.getByRole('button', { name: 'Toggle drawing mount', exact: true }).click(); await expect(owns).toHaveText('false');
    await page.mouse.click(720, 500); await expect(picks).toHaveText('2');
    await page.getByRole('button', { name: 'Toggle drawing mount', exact: true }).click(); await expect(owns).toHaveText('false');
  });
}
