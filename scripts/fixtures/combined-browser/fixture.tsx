import React from 'react';
import { createRoot } from 'react-dom/client';
import * as maplibregl from 'maplibre-gl';
import { HomeContent } from '@/components/layout/HomeContent';
import { MAP_STYLES } from '@/components/map/MapConstants';
import { calls, changeFixture, fixtureRows, useFixture } from './services';
import '@/app/globals.css';
import './fixture.css';

declare global { interface Window { __combinedMap: maplibregl.Map; __combinedCalls: typeof calls; __combinedMoves: number; __combinedChangeFixture: typeof changeFixture; } }
for (const style of ['standard', 'dark']) Object.assign(MAP_STYLES[style], { isPmtiles: false, isMapTiler: true, url: `/fixture-style/${style}.json` });
const originalOn = maplibregl.Map.prototype.on;
Object.defineProperty(maplibregl.Map.prototype, 'on', { value: function(this: maplibregl.Map, ...args: unknown[]) {
    if (window.__combinedMap !== this) {
        window.__combinedMap = this;
        Reflect.apply(originalOn, this, ['movestart', () => { window.__combinedMoves++; }]);
    }
    return Reflect.apply(originalOn, this, args);
} });
window.__combinedCalls = calls;
window.__combinedChangeFixture = changeFixture;
window.__combinedMoves = 0;

function FixtureControls() {
    const value = useFixture();
    return <details className="fixture-switches"><summary title="Open synthetic provider controls">Synthetic fixture services</summary>
        <button title="Simulate a live feed loading/error and cap change" onClick={() => changeFixture({ loading: !value.loading, capped: !value.capped, error: value.error ? null : 'Synthetic live update failure' })}>Live status change</button>
        <button title="Replace live reporting timestamps and locations" onClick={() => changeFixture({ rows: fixtureRows.map(row => ({ ...row, longitude: 80, publishedAt: new Date().toISOString() })) })}>Inject late response</button>
        <button title="Add one synthetic event to the independently checked region feed" onClick={() => { void fetch('/fixture-region-advance', { method: 'POST' }); }}>Advance regional feed</button>
        <button title="Switch application theme" onClick={() => { const theme = value.theme === 'light' ? 'dark' : 'light'; document.documentElement.dataset.theme = theme; changeFixture({ theme }); }}>Theme</button>
        <button title="Switch to a new free fixture account" onClick={() => changeFixture({ owner: 'fixture-other', tier: 'free', rows: [], loading: false, error: null })}>Switch to free account</button>
        <button title="Switch to a guest fixture" onClick={() => changeFixture({ tier: 'guest', rows: [] })}>Use guest fixture</button>
        <button title="Restore the entitled synthetic dataset" onClick={() => changeFixture({ tier: 'analyst', owner: 'fixture-account', rows: fixtureRows, loading: false, capped: true, error: null })}>Restore Analyst fixture</button>
    </details>;
}
createRoot(document.getElementById('root')!).render(<><HomeContent /><FixtureControls /></>);
