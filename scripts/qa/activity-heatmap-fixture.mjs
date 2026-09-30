import { copyFile, mkdir, rm, writeFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const page = resolve(root, 'src/app/heatmap-qa');
const publicFiles = ['standard', 'dark'].map(theme => resolve(root, `public/heatmap-qa-${theme}.json`));
if (process.argv.includes('--clean')) {
    await rm(page, { recursive: true, force: true });
    for (const file of publicFiles) await rm(file, { force: true });
} else {
    for (const path of [page, ...publicFiles]) {
        try { await access(path); throw new Error(`Refusing to overwrite ${path}; clean the QA fixture first.`); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    await mkdir(page);
    await copyFile(resolve(root, 'scripts/qa/activity-heatmap-page.tsx.fixture'), resolve(page, 'page.tsx'));
    const lines = [];
    for (let lon = -180; lon <= 180; lon += 5) lines.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[lon, -85], [lon, 85]] } });
    for (let lat = -80; lat <= 80; lat += 5) lines.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[-180, lat], [180, lat]] } });
    for (const [index, theme] of ['standard', 'dark'].entries()) {
        await writeFile(publicFiles[index], JSON.stringify({
            version: 8, glyphs: 'https://tiles.openstreetmap.us/fonts/{fontstack}/{range}.pbf',
            sources: { grid: { type: 'geojson', data: { type: 'FeatureCollection', features: lines } } },
            layers: [{ id: 'background', type: 'background', paint: { 'background-color': theme === 'dark' ? '#17212f' : '#e5e9ee' } },
                { id: 'grid', type: 'line', source: 'grid', paint: { 'line-color': theme === 'dark' ? '#334155' : '#c1c9d4', 'line-width': 0.5 } }],
        }));
    }
}
