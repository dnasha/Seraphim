import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('../../', import.meta.url));
const { version } = require('maplibre-gl/package.json');
const source = dirname(require.resolve('maplibre-gl/package.json'));
const destination = join(root, 'public', 'maplibre', version);

// MapLibre 6 workers are ES modules with a shared-module dependency. Serve both
// from the same origin, versioned together to prevent stale worker/main mismatches.
mkdirSync(destination, { recursive: true });
for (const file of ['maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs']) {
  copyFileSync(join(source, 'dist', file), join(destination, file));
}
