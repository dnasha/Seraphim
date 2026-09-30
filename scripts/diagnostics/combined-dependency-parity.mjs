/** Compare every installed Bun lock entry, including nested/scoped packages. */
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const lock = require('next/dist/compiled/json5').parse(await readFile('bun.lock', 'utf8'));
const manifest = JSON.parse(await readFile('package.json', 'utf8'));
const direct = Object.keys({ ...manifest.dependencies, ...manifest.devDependencies });
const criticalKeys = ['next', 'eslint-config-next', '@next/swc-linux-x64-gnu', 'maplibre-gl', 'terra-draw', 'fake-indexeddb', 'isomorphic-dompurify/jsdom', 'isomorphic-dompurify/jsdom/whatwg-mimetype'];
const entries = [];
for (const [key, value] of Object.entries(lock.packages)) {
    // An @scope/name is one path segment; slash-separated remaining names
    // represent successive nested node_modules directories in Bun's lock.
    const names = key.match(/@[^/]+\/[^/]+|[^/]+/g);
    const path = join(...names.flatMap(name => ['node_modules', name]), 'package.json');
    let actual = null;
    try { actual = JSON.parse(await readFile(path, 'utf8')).version.replace(/^v/, ''); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const expected = value[0].slice(value[0].lastIndexOf('@') + 1).replace(/^v/, '');
    entries.push({ key, expected, actual, installed: actual !== null, match: actual === expected });
}
const installed = entries.filter(entry => entry.installed);
const mismatches = installed.filter(entry => !entry.match);
const directMatched = direct.filter(key => entries.find(entry => entry.key === key)?.match).length;
const summary = { locked: entries.length, installed: installed.length, direct: direct.length, directMatched, mismatches,
    critical: criticalKeys.map(key => entries.find(entry => entry.key === key)) };
await mkdir('artifacts/combined-six', { recursive: true });
await writeFile('artifacts/combined-six/dependency-parity.json', JSON.stringify({ summary, entries }, null, 2));
console.log(JSON.stringify(summary, null, 2));
assert.equal(mismatches.length, 0, 'Installed packages must match their immutable lock entries');
assert.equal(directMatched, direct.length, 'Every direct dependency must be installed at its locked version');
assert(summary.critical.every(entry => entry?.match), 'Critical framework, map and test dependencies must match');
