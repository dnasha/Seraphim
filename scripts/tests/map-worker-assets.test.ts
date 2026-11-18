import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { expect, it } from 'vitest';

const require = createRequire(import.meta.url);

it('ships the matching self-contained MapLibre worker', () => {
  execFileSync(process.execPath, ['scripts/build/prepare-map-worker.mjs']);
  const { version } = require('maplibre-gl/package.json') as { version: string };
  const source = join(dirname(require.resolve('maplibre-gl/package.json')), 'dist');
  const destination = join(process.cwd(), 'public', 'maplibre', version);
  const worker = 'maplibre-gl-worker.mjs';
  const published = readFileSync(join(destination, worker), 'utf8');

  expect(published).toBe(readFileSync(join(source, worker), 'utf8'));
  expect(published).not.toMatch(/\b(?:from|import)\s*(?:\(\s*)?["']\.\.?\//);
});
