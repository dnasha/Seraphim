/** Native Chromium storage recovery; synthetic auth/details and blocked outbound requests. */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const { chromium } = await import(process.env.ANALYST_PLAYWRIGHT_MODULE || 'playwright-core');
const base = 'http://127.0.0.1:4179';
const output = resolve(process.env.ANALYST_QA_OUTPUT || '/tmp/analyst-recovery-qa');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const summary = [];
async function boot(page, owner) {
  await page.goto(base); await page.waitForFunction(() => Boolean(window.analystQA));
  await page.evaluate(owner => window.analystQA.setAccount(owner, 'analyst'), owner);
  await page.getByRole('button', { name: /^Add to evidence selection: Fixture event 1/ }).waitFor();
  await page.evaluate(async () => {
    window.recoveryDB = await import('/@fs/workspace/Seraphim/src/lib/analyst/database.ts');
    window.recoveryFixtures = await import('/@fs/workspace/Seraphim/scripts/tests/fixtures/analyst.ts');
  });
}
async function seed(page, owner) {
  return page.evaluate(async owner => {
    const store = await window.recoveryDB.openStore(localStorage, indexedDB, owner, new AbortController().signal);
    for (let i = 0; i < 7; i++) await window.recoveryDB.mutateStore(indexedDB, owner, store.resetId,
      { type: 'add-packet', packet: { ...window.recoveryFixtures.fixturePacket(), id: window.recoveryFixtures.analystId(100 + i) } }, new AbortController().signal);
    return store.resetId;
  }, owner);
}
async function select(page) {
  await page.getByRole('button', { name: /^Add to evidence selection: Fixture event 1/ }).click();
  await page.getByRole('button', { name: /^Evidence workspace/ }).click();
}
async function note(page, owner, generation, value) {
  await page.evaluate(async ({ owner, generation, value }) => window.recoveryDB.mutateStore(indexedDB, owner, generation,
    { type: 'set-note', id: window.recoveryFixtures.analystId(2), previous: '', note: value }, new AbortController().signal), { owner, generation, value });
}
async function packetId(page) { return page.getByRole('combobox').inputValue(); }
async function assertRetained(page, id) {
  assert.equal(await packetId(page), id);
  assert.equal(await page.getByRole('button', { name: 'Discard unsaved packet' }).count(), 1);
  assert.equal(await page.getByRole('heading', { name: 'Selection 1/20' }).count(), 1);
}
try {
  for (const [name, viewport] of [['desktop', { width: 1280, height: 720 }], ['mobile', { width: 390, height: 844 }]]) {
    const context = await browser.newContext({ viewport, acceptDownloads: true }); const errors = [];
    await context.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
    const b = await context.newPage(); b.on('pageerror', e => errors.push(e.message));
    const startupOwner = `recovery-startup-${name}`;
    await boot(b, startupOwner); const startupGeneration = await seed(b, startupOwner);
    const a = await context.newPage(); a.on('pageerror', e => errors.push(e.message));
    // Controlled startup API unavailability, followed by restoration of Chromium's native factory.
    await a.addInitScript(() => {
      const native = window.indexedDB;
      Object.defineProperty(window, 'indexedDB', { configurable: true, value: undefined });
      window.restoreStorage = () => Object.defineProperty(window, 'indexedDB', { configurable: true, value: native });
    });
    await boot(a, startupOwner); await select(a);
    await a.getByRole('button', { name: 'Capture selected events', exact: true }).click();
    await a.getByRole('button', { name: 'Discard unsaved packet' }).waitFor(); const startupPacket = await packetId(a);
    // Failed explicit retries must preserve the same capture and selection.
    await a.getByRole('button', { name: 'Retry local saving' }).click();
    await a.getByRole('alert').filter({ hasText: 'IndexedDB' }).waitFor(); await assertRetained(a, startupPacket);
    await a.getByRole('button', { name: 'Retry local saving' }).scrollIntoViewIfNeeded();
    await a.screenshot({ path: resolve(output, `${name}-startup-unavailable.png`) });
    await a.evaluate(() => { window.restoreStorage(); window.dispatchEvent(new Event('focus')); });
    await a.getByRole('heading', { name: 'Copied packets 7/8 saved' }).waitFor();
    await assertRetained(a, startupPacket);
    assert.equal(await a.getByRole('button', { name: 'Retry local saving' }).count(), 0);
    assert.equal(await a.getByRole('alert').count(), 0);
    await a.getByRole('button', { name: 'Retry saving packet' }).scrollIntoViewIfNeeded();
    await a.screenshot({ path: resolve(output, `${name}-startup-retained.png`) });
    await a.getByRole('button', { name: 'Retry saving packet' }).click();
    await a.getByRole('heading', { name: 'Copied packets 8/8 saved' }).waitFor();
    assert.equal(await a.getByRole('button', { name: 'Discard unsaved packet' }).count(), 0);
    assert.equal(await a.evaluate(async owner => (await window.recoveryDB.readStore(indexedDB, owner)).packets[0].id, startupOwner), startupPacket);
    // Actual reset still clears local work and rejects a stale writer.
    await b.evaluate(owner => window.recoveryDB.resetStore(localStorage, indexedDB, owner, new AbortController().signal), startupOwner);
    await a.getByRole('heading', { name: 'Copied packets 0/8 saved' }).waitFor();
    assert.equal(await a.getByRole('heading', { name: 'Selection 0/20' }).count(), 1);
    const stale = await b.evaluate(async ({ owner, generation }) => {
      try { await window.recoveryDB.mutateStore(indexedDB, owner, generation, { type: 'add-packet', packet: window.recoveryFixtures.fixturePacket() }, new AbortController().signal); return 'unexpected success'; }
      catch (e) { return e.message; }
    }, { owner: startupOwner, generation: startupGeneration }); assert.match(stale, /workspace was reset/);
    await a.close();

    const transientOwner = `recovery-read-${name}`;
    await b.evaluate(owner => window.analystQA.setAccount(owner, 'analyst'), transientOwner);
    const generation = await seed(b, transientOwner);
    const c = await context.newPage(); c.on('pageerror', e => errors.push(e.message)); await boot(c, transientOwner); await select(c);
    await c.getByRole('heading', { name: 'Copied packets 7/8 saved' }).waitFor();
    await c.evaluate(() => {
      window.nativeTransaction = IDBDatabase.prototype.transaction;
      IDBDatabase.prototype.transaction = function (...args) {
        if (args[1] === 'readonly') throw new DOMException('Temporary native read failure', 'UnknownError');
        return window.nativeTransaction.apply(this, args);
      };
      window.dispatchEvent(new Event('focus'));
    });
    await c.getByRole('alert').filter({ hasText: 'Temporary native read failure' }).waitFor();
    await c.getByRole('button', { name: 'Capture selected events', exact: true }).click();
    await c.getByRole('button', { name: 'Discard unsaved packet' }).waitFor(); const retainedPacket = await packetId(c);
    await c.evaluate(() => { IDBDatabase.prototype.transaction = window.nativeTransaction; window.dispatchEvent(new Event('focus')); });
    await c.waitForFunction(() => !document.querySelector('dialog')?.textContent.includes('Local saving is unavailable.'));
    await assertRetained(c, retainedPacket);
    assert.equal(await c.getByRole('alert').count(), 0);
    await c.getByRole('button', { name: 'Retry saving packet' }).scrollIntoViewIfNeeded();
    // Repeat the same outage with retained work, then recover from the other tab's update alone.
    await c.evaluate(() => {
      IDBDatabase.prototype.transaction = function (...args) {
        if (args[1] === 'readonly') throw new DOMException('Temporary native read failure', 'UnknownError');
        return window.nativeTransaction.apply(this, args);
      };
      window.dispatchEvent(new Event('focus'));
    });
    await c.getByRole('alert').filter({ hasText: 'Temporary native read failure' }).waitFor();
    await assertRetained(c, retainedPacket);
    await c.evaluate(() => { IDBDatabase.prototype.transaction = window.nativeTransaction; });
    // Native storage/BroadcastChannel notification from another tab restores write capability.
    await note(b, transientOwner, generation, 'cross-tab recovery note');
    await c.waitForFunction(() => !document.querySelector('dialog')?.textContent.includes('Local saving is unavailable.'));
    await assertRetained(c, retainedPacket);
    assert.equal(await c.getByRole('alert').count(), 0);
    await c.screenshot({ path: resolve(output, `${name}-read-retained.png`) });
    await c.getByRole('button', { name: 'Retry saving packet' }).click();
    await c.getByRole('heading', { name: 'Copied packets 8/8 saved' }).waitFor();
    const saved = await c.evaluate(owner => window.recoveryDB.readStore(indexedDB, owner), transientOwner);
    assert.equal(saved.packets[0].id, retainedPacket); assert.equal(saved.notes['11111111-1111-4111-8111-000000000002'], 'cross-tab recovery note');
    const downloading = c.waitForEvent('download'); await c.getByRole('button', { name: 'Download JSON', exact: true }).click();
    const jsonPath = resolve(output, `${name}-recovered.json`); await (await downloading).saveAs(jsonPath);
    const exported = JSON.parse(await readFile(jsonPath, 'utf8'));
    assert.equal(exported.notesIncluded, false); assert.equal('privateNotes' in exported, false);
    // A different account remains isolated after both recovery paths.
    await c.evaluate(() => window.analystQA.setAccount('isolated-account', 'analyst'));
    await c.getByRole('button', { name: /^Add to evidence selection: Fixture event 1/ }).waitFor();
    await c.getByRole('button', { name: /^Evidence workspace/ }).click();
    await c.getByRole('heading', { name: 'Copied packets 0/8 saved' }).waitFor();
    assert.equal(await c.getByRole('button', { name: 'Download JSON', exact: true }).count(), 0);
    assert.deepEqual(errors, []);
    summary.push({ name, startupFocusRecovery: 'passed', sameGenerationFocusRecovery: 'passed', sameGenerationCrossTabRecovery: 'passed', retrySavedEighthPacket: 'passed', resetAndIsolation: 'passed', errors });
    await context.close();
  }
  await writeFile(resolve(output, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify({ passed: summary, output }, null, 2));
} finally { await browser.close(); }
