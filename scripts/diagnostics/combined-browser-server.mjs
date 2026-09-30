/** Real HomeContent/map/replay/drawing, synthetic providers, local resources only. */
import { createServer } from 'vite';
import { resolve } from 'node:path';
const root = resolve('scripts/fixtures/combined-browser');
const replayRoot = resolve('scripts/fixtures/replay-browser');
const services = resolve(root, 'services.tsx');
let regionStage = 0;
const regionRow = index => ({ id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`, title: `Synthetic live region event ${index}`,
    source: 'Fixture', sourceType: 'rss', url: `https://example.invalid/region-${index}`, publishedAt: '2026-09-29T18:00:00Z',
    latitude: 32, longitude: 14, sourcesCount: 1, storyCount: 1 });
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
    plugins: [{ name: 'local-fixture-map-resources', transform(code, id) {
        if (id.split('?')[0] === resolve('src/features/browser-geofence/useBrowserAlerts.ts')) {
            const replacement = code.replace(/from\s*(['"])\.\/delivery\1/, `from ${JSON.stringify(resolve(root, 'delivery.ts'))}`);
            if (replacement === code) throw new Error('Could not install the synthetic notification adapter.');
            return replacement;
        }
        if (id.split('?')[0] === resolve('src/components/map/NewsMap.tsx')) return code.replace('https://api.maptiler.com/resources/logo.svg', '/fixture-provider-logo.svg');
        return undefined;
    }, configureServer(server) {
        server.middlewares.use((request, response, next) => {
            const url = new URL(request.url ?? '/', 'http://127.0.0.1:4176');
            const json = body => { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(body)); };
            if (url.pathname === '/fixture-provider-logo.svg') { response.setHeader('Content-Type', 'image/svg+xml'); response.end('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>'); return; }
            if (url.pathname === '/fixture-region-advance' && request.method === 'POST') { regionStage = Math.min(2, regionStage + 1); json({ regionStage }); return; }
            if (url.pathname === '/api/analyst/access') { json({ userId: 'fixture-account', tier: 'analyst' }); return; }
            if (url.pathname.startsWith('/api/news/10000000-0000-4000-8000-')) {
                const id = url.pathname.split('/').at(-1), index = Number(id.slice(-12)) - 1;
                const event = { id, title: `Current fixture detail ${index}`, description: 'Synthetic current exact event observation.',
                    source: 'Fixture', sourceType: 'rss', url: `https://example.invalid/event-${index}`, publishedAt: new Date(Date.now() - 3_600_000).toISOString(), latitude: 32, longitude: 14 };
                json({ event, sources: [], totalSources: 0, timelineRestricted: false }); return;
            }
            if (url.pathname === '/api/news' && url.searchParams.get('force_raw') === 'true') {
                json({ items: Array.from({ length: regionStage + 1 }, (_, index) => regionRow(index + 1)), lastUpdated: '2026-09-30T12:00:00Z',
                    meta: { clustered: false, scope: 'viewport', view: 'sidebar', sort: url.searchParams.get('sort'), isCapped: false, stale: false, appliedLimit: Number(url.searchParams.get('limit')) } }); return;
            }
            if (url.pathname.startsWith('/api/news/00000000-0000-4000-8000-')) {
                const row = regionRow(Number(url.pathname.slice(-12)));
                json({ event: row, sources: [{ url: row.url }], totalSources: 1, timelineRestricted: false }); return;
            }
            if (url.pathname.startsWith('/api/')) { response.statusCode = 503; json({ error: 'No provider available in this isolated fixture.' }); return; }
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
