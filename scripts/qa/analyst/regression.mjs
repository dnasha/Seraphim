/** Synthetic-only desktop/mobile and real cross-tab IndexedDB regressions. */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const { chromium } = await import(process.env.ANALYST_PLAYWRIGHT_MODULE || 'playwright-core');
const base = 'http://127.0.0.1:4179';
const output = resolve(process.env.ANALYST_QA_OUTPUT || '/tmp/analyst-repair-qa');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const id = i => `11111111-1111-4111-8111-${String(i).padStart(12, '0')}`;
const summary = [];
try {
  for (const [name, viewport] of [['desktop', { width: 1280, height: 720 }], ['mobile', { width: 390, height: 844 }]]) {
    const context = await browser.newContext({ viewport, acceptDownloads: true });
    const errors = [];
    // Fixtures and downloaded briefs must never contact publishers or real services.
    await context.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
    const a = await context.newPage(); const b = await context.newPage();
    for (const page of [a, b]) page.on('pageerror', error => errors.push(error.message));
    const owner = `repair-${name}`;
    const key = `seraphim:experiment:analyst-evidence:v1:${owner}`;
    async function boot(page) {
      await page.goto(base);
      await page.waitForFunction(() => Boolean(window.analystQA));
      await page.evaluate(owner => window.analystQA.setAccount(owner, 'analyst'), owner);
      await page.getByRole('button', { name: /^Add to evidence selection: Fixture event 1/ }).waitFor();
    }
    await Promise.all([boot(a), boot(b)]);
    const stored = () => a.evaluate(owner => window.qaDatabase.readStore(indexedDB, owner), owner);
    // Both tabs deliberately retain an observed generation, then enqueue competing intents.
    for (const page of [a, b]) await page.evaluate(async key => {
      window.qaStorage = await import('/@fs/workspace/Seraphim/src/lib/analyst/storage.ts');
      window.qaDatabase = await import('/@fs/workspace/Seraphim/src/lib/analyst/database.ts');
      window.qaFixtures = await import('/@fs/workspace/Seraphim/scripts/tests/fixtures/analyst.ts');
      window.qaObserved = await window.qaDatabase.openStore(localStorage, indexedDB, key.split(':').at(-1), new AbortController().signal);
    }, key);
    const saveA = a.evaluate(async owner => window.qaDatabase.mutateStore(indexedDB, owner, window.qaObserved.resetId,
      { type: 'add-packet', packet: window.qaFixtures.fixturePacket() }, new AbortController().signal), owner);
    const saveB = b.evaluate(async owner => window.qaDatabase.mutateStore(indexedDB, owner, window.qaObserved.resetId,
      { type: 'set-note', id: window.qaFixtures.analystId(2), previous: '', note: 'other tab' }, new AbortController().signal), owner);
    await Promise.all([saveA, saveB]);
    for (const page of [a, b]) await page.waitForFunction(async owner => { const s=await window.qaDatabase.readStore(indexedDB, owner); return s.packets.length===1 && s.notes['11111111-1111-4111-8111-000000000002']==='other tab'; }, owner);
    assert.equal((await stored()).packets.length, 1); assert.equal((await stored()).notes[id(2)], 'other tab');
    // A real active map pin must survive modal shortcuts, including native Escape.
    if (name === 'mobile') await a.getByRole('button', { name: 'Map', exact: true }).click();
    await a.getByRole('button', { name: 'Select aggregate map pin', exact: true }).click();
    if (name === 'mobile') await a.getByRole('button', { name: 'Stories', exact: true }).click();
    // Seed the quota in B; A receives a real native storage event, retaining its selection.
    await a.getByRole('button', { name: /^Add to evidence selection: Fixture event 1/ }).click();
    await a.getByRole('button', { name: /^Evidence workspace/ }).click();
    await b.evaluate(owner => new Promise((resolve, reject) => {
      const request = indexedDB.open(window.qaDatabase.DATABASE_NAME, 1);
      request.onsuccess = () => {
        const db = request.result; const tx = db.transaction('workspaces', 'readwrite'); const store = tx.objectStore('workspaces');
        const key = window.qaStorage.storageKey(owner); const read = store.get(key);
        read.onsuccess = () => store.put({ ...read.result, packets: Array.from({ length: 8 }, (_, i) => ({ ...window.qaFixtures.fixturePacket(), id: window.qaFixtures.analystId(100 + i) })) }, key);
        tx.oncomplete = () => { db.close(); localStorage.setItem(window.qaDatabase.CHANGE_KEY, JSON.stringify({ key, revision: crypto.randomUUID() })); resolve(); };
        tx.onabort = () => reject(tx.error);
      };
      request.onerror = () => reject(request.error);
    }), owner);
    await a.getByRole('heading', { name: 'Copied packets 8/8 saved' }).waitFor();
    await b.getByRole('button', { name: /^Add to evidence selection: Fixture event 2/ }).click();
    await b.getByRole('button', { name: /^Evidence workspace/ }).click();
    // This ordinary note save occurs while A's detail transport is pending.
    await a.getByRole('button', { name: 'Capture selected events', exact: true }).click();
    await b.getByRole('textbox', { name: /^Private note/ }).fill('during capture');
    await a.getByRole('button', { name: 'Discard unsaved packet' }).waitFor();
    assert.equal(await a.getByRole('combobox').locator('option').count(), 9);
    await b.getByRole('textbox', { name: /^Private note/ }).fill('after completed capture');
    await a.waitForFunction(async owner => (await window.qaDatabase.readStore(indexedDB, owner)).notes['11111111-1111-4111-8111-000000000002'] === 'after completed capture', owner);
    assert.equal(await a.getByRole('combobox').locator('option').count(), 9);
    assert.match(await a.getByRole('heading', { name: /^Selection/ }).innerText(), /1\/20/);
    // Exact native keyboard regression from a button and the packet selection.
    const before = await a.evaluate(() => ({ urls: window.analystQA.urlWrites.length, prefs: window.analystQA.preferenceWrites.length,
      scope: document.querySelector('dialog details pre').textContent }));
    for (const target of [a.getByRole('button', { name: 'Close evidence workspace' }), a.getByRole('combobox')]) {
      await target.focus();
      for (const key of ['t', 'c', 'm', '/', 'f']) await a.keyboard.press(key);
    }
    assert.deepEqual(await a.evaluate(() => ({ urls: window.analystQA.urlWrites.length, prefs: window.analystQA.preferenceWrites.length,
      scope: document.querySelector('dialog details pre').textContent })), before);
    const pinBefore = await a.locator('[data-testid=qa-map-selection]').textContent();
    await a.getByRole('button', { name: 'Close evidence workspace' }).focus();
    await a.keyboard.press('Escape');
    assert.equal(await a.locator('dialog').evaluate(dialog => dialog.open), false);
    assert.equal(await a.locator('[data-testid=qa-map-selection]').textContent(), pinBefore);
    await a.getByRole('button', { name: /^Evidence workspace/ }).click();
    await a.getByRole('textbox', { name: /^Private note/ }).fill('');
    await a.getByRole('textbox', { name: /^Private note/ }).pressSequentially('PRIVATE tcm note');
    await a.waitForFunction(async owner => (await window.qaDatabase.readStore(indexedDB, owner)).notes['11111111-1111-4111-8111-000000000001'] === 'PRIVATE tcm note', owner);
    await a.getByRole('button', { name: 'Close evidence workspace' }).focus(); await a.keyboard.press('Tab');
    assert.equal(await a.evaluate(() => document.querySelector('dialog').contains(document.activeElement)), true);
    await a.getByRole('combobox').selectOption({ index: 0 });
    // A pending export remains alive through an ordinary update in B.
    await a.evaluate(() => {
      window.qaFetch = window.fetch; let once = true;
      window.fetch = (url, options) => {
        if (once && String(url).includes('/analyst/access')) {
          once = false; return new Promise(resolve => { window.qaExportRelease = () => resolve(Response.json({ userId: window.analystQA.getOwner(), tier: 'analyst' })); });
        }
        return window.qaFetch(url, options);
      };
    });
    const downloading = a.waitForEvent('download');
    await a.getByRole('button', { name: 'Download JSON', exact: true }).click();
    await a.waitForFunction(() => Boolean(window.qaExportRelease));
    await b.getByRole('textbox', { name: /^Private note/ }).fill('during export');
    await a.evaluate(() => window.qaExportRelease());
    const download = await downloading; const jsonPath = resolve(output, `${name}-default.json`); await download.saveAs(jsonPath);
    const packet = JSON.parse(await readFile(jsonPath, 'utf8'));
    assert.equal(packet.notesIncluded, false); assert.equal('privateNotes' in packet, false);
    assert.equal(packet.packet.entries[0].selection.representative, true);
    await a.evaluate(() => { window.fetch = window.qaFetch; window.analystQA.updateLive(); });
    await a.getByRole('checkbox').check();
    const noteDownload = a.waitForEvent('download'); await a.getByRole('button', { name: 'Download JSON', exact: true }).click();
    const includedPath = resolve(output, `${name}-notes.json`); await (await noteDownload).saveAs(includedPath);
    const included = JSON.parse(await readFile(includedPath, 'utf8'));
    assert.equal(included.privateNotes[id(1)], 'PRIVATE tcm note'); assert.deepEqual(included.packet, packet.packet);
    await a.getByRole('checkbox').uncheck();
    const briefDownload = a.waitForEvent('download'); await a.getByRole('button', { name: 'Download printable brief', exact: true }).click();
    const briefPath = resolve(output, `${name}-brief.html`); await (await briefDownload).saveAs(briefPath);
    const brief = await readFile(briefPath, 'utf8'); assert.equal(brief.includes('PRIVATE tcm note'), false); assert.equal(brief.includes('<script'), false);
    const printPage = await context.newPage(); await printPage.setContent(brief);
    await printPage.pdf({ path: resolve(output, `${name}-brief.pdf`) }); await printPage.close();
    await a.getByRole('button', { name: 'Print / save PDF', exact: true }).click();
    await a.locator('iframe[title="Printable evidence brief"]').waitFor({ state: 'attached' });
    assert.equal(await a.locator('iframe').getAttribute('sandbox'), 'allow-same-origin allow-modals');
    assert.equal(await a.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await a.screenshot({ path: resolve(output, `${name}-workspace.png`) });
    // Explicit reset must cancel a pending capture and remove saved and unsaved content.
    await a.getByRole('button', { name: 'Discard unsaved packet' }).click();
    await a.evaluate(() => {
      window.qaFetch = window.fetch;
      window.fetch = (url, options) => String(url).startsWith('/api/news/') ? new Promise((_resolve, reject) => {
        window.qaDetailSignal = options.signal;
        options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
      }) : window.qaFetch(url, options);
    });
    await a.getByRole('button', { name: 'Capture selected events', exact: true }).click();
    await a.waitForFunction(() => Boolean(window.qaDetailSignal));
    await b.getByRole('button', { name: 'Delete all local evidence data…', exact: true }).click();
    await b.getByRole('button', { name: 'Delete local workspace', exact: true }).click();
    await a.getByRole('heading', { name: 'Copied packets 0/8 saved' }).waitFor();
    assert.equal(await a.evaluate(() => window.qaDetailSignal.aborted), true);
    assert.equal(await a.getByRole('button', { name: 'Discard unsaved packet' }).count(), 0);
    assert.equal((await stored()).packets.length, 0); assert.deepEqual((await stored()).notes, {});
    await a.waitForFunction(() => document.querySelectorAll('iframe').length === 0);
    // A stale tab cannot restore deleted content even before processing a storage event.
    const rejected = await b.evaluate(async owner => {
      try { await window.qaDatabase.mutateStore(indexedDB, owner, window.qaObserved.resetId, { type: 'add-packet', packet: window.qaFixtures.fixturePacket() }, new AbortController().signal); return false; }
      catch (error) { return { message: error.message }; }
    }, owner);
    assert.match(rejected.message, /workspace was reset/);
    assert.equal((await stored()).packets.length, 0);
    await a.evaluate(() => { window.fetch = window.qaFetch; window.analystQA.setAccount('different-owner', 'pro'); });
    await a.waitForFunction(() => document.querySelectorAll('iframe').length === 0);
    assert.equal(await a.getByRole('button', { name: 'Download JSON', exact: true }).count(), 0);
    assert.deepEqual(errors, []);
    summary.push({ name, concurrentIntents: 'passed', retainedWork: 'passed', keyboard: 'passed', reset: 'passed', privateExports: 'passed', errors });
    await context.close();
  }
  await writeFile(resolve(output, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify({ passed: summary, output }, null, 2));
} finally { await browser.close(); }
