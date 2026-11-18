import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('../../', import.meta.url));
const { version } = require('maplibre-gl/package.json');
const source = dirname(require.resolve('maplibre-gl/package.json'));
const destination = join(root, 'public', 'maplibre', version);

// Serve the self-contained worker from the same origin. Keep its version in
// the URL so a cached worker cannot outlive its matching MapLibre bundle.
const worker = 'maplibre-gl-worker.mjs';
mkdirSync(destination, { recursive: true });
copyFileSync(join(source, 'dist', worker), join(destination, worker));
