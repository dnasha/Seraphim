/** Real HomeContent/map/replay/drawing, synthetic providers, local resources only. */
import { createServer } from 'vite';
import { resolve } from 'node:path';
const root = resolve('scripts/fixtures/combined-browser');
const replayRoot = resolve('scripts/fixtures/replay-browser');
const services = resolve(root, 'services.tsx');
const grid = [];
for (let lon = -180; lon <= 180; lon += 5) grid.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[lon, -85], [lon, 85]] } });
for (let lat = -80; lat <= 80; lat += 5) grid.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[-180, lat], [180, lat]] } });
const server = await createServer({
    configFile: false, root, publicDir: resolve('public'),
    server: { host: '127.0.0.1', port: 4176, strictPort: true, fs: { allow: [process.cwd()] } },
    esbuild: { jsx: 'automatic' }, define: { 'process.env': '{}' },
    resolve: { alias: [
        { find: 'next/dynamic', replacement: resolve(root, 'Dynamic.tsx') },
        ...Object.entries({ 'next/image': 'Image', 'next/link': 'Link', '@/components/auth/UserButton': 'Null', '@/components/auth/AuthModal': 'Null', '@/components/ui/PWAInstallPrompt': 'Null' }).map(([find, name]) => ({ find, replacement: resolve(replayRoot, `${name}.tsx`) })),
        ...['next/navigation', 'next-themes', '@/hooks/useAuth', '@/hooks/useUserTier', '@/hooks/useNewsData', '@/hooks/useSyncedPreferences'].map(find => ({ find, replacement: services })),
        { find: '@', replacement: resolve('src') },
    ] },
    plugins: [{ name: 'local-fixture-map-resources', configureServer(server) {
        server.middlewares.use((request, response, next) => {
            if (request.url?.startsWith('/fixture-fonts/')) { response.setHeader('Content-Type', 'application/octet-stream'); response.end(); return; }
            if (!request.url?.startsWith('/fixture-style/')) return next();
            const dark = request.url.includes('dark');
            response.setHeader('Content-Type', 'application/json');
            response.end(JSON.stringify({ version: 8, glyphs: 'http://127.0.0.1:4176/fixture-fonts/{fontstack}/{range}.pbf',
                sources: { grid: { type: 'geojson', data: { type: 'FeatureCollection', features: grid } } },
                layers: [{ id: 'background', type: 'background', paint: { 'background-color': dark ? '#17212f' : '#e5e9ee' } },
                    { id: 'grid', type: 'line', source: 'grid', paint: { 'line-color': dark ? '#334155' : '#c1c9d4', 'line-width': 0.5 } }],
            }));
        });
    } }],
});
await server.listen(); server.printUrls();
