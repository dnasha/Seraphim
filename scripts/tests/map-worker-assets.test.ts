import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { expect, it } from 'vitest';

const require = createRequire(import.meta.url);

it('ships the matching worker and every relative module it imports', () => {
  execFileSync(process.execPath, ['scripts/build/prepare-map-worker.mjs']);
  const { version } = require('maplibre-gl/package.json') as { version: string };
  const source = join(dirname(require.resolve('maplibre-gl/package.json')), 'dist');
  const destination = join(process.cwd(), 'public', 'maplibre', version);
  const pending = ['maplibre-gl-worker.mjs'];
  const checked = new Set<string>();

  while (pending.length) {
    const file = pending.pop()!;
    if (checked.has(file)) continue;
    checked.add(file);
    const published = readFileSync(join(destination, file), 'utf8');
    expect(published).toBe(readFileSync(join(source, file), 'utf8'));
    for (const match of published.matchAll(/from\s*["']\.\/([^"']+)["']/g)) {
      pending.push(match[1]);
    }
  }
  expect(checked.has('maplibre-gl-shared.mjs')).toBe(true);
});
