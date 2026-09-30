import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import '@/app/globals.css';
import MapDrawTools from '@/components/map/MapDrawTools';
import type { UserTier } from '@/lib/entitlements';

const blankStyle = (dark = false): maplibregl.StyleSpecification => ({ version: 8, sources: {},
  layers: [{ id: 'fixture-background', type: 'background', paint: { 'background-color': dark ? '#131827' : '#e6e8ed' } }] });

function Fixture() {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(true);
  const [owner, setOwner] = useState('fixture-a');
  const [tier, setTier] = useState<UserTier>('analyst');
  const [dark, setDark] = useState(false);
  const [renderedCount, setRenderedCount] = useState(0);
  const [mapError, setMapError] = useState<string | null>(null);
  useEffect(() => {
    maplibregl.setWorkerUrl(`/maplibre/${maplibregl.getVersion()}/maplibre-gl-worker.mjs`);
    const map = new maplibregl.Map({ container: container.current!, style: blankStyle(), center: [0, 0], zoom: 3 });
    mapRef.current = map;
    map.on('style.load', () => setReady(true));
    map.on('error', event => setMapError(event.error.message));
    map.on('idle', () => {
      const layers = map.getStyle().layers?.filter(layer => layer.id.startsWith('experiment-drawing-history-')).map(layer => layer.id) ?? [];
      setRenderedCount(layers.length ? map.queryRenderedFeatures(undefined, { layers }).length : 0);
    });
    return () => { map.remove(); mapRef.current = null; };
  }, []);
  return <main style={{ height: '100dvh', width: '100vw', position: 'relative' }}>
    <div ref={container} style={{ position: 'absolute', inset: 0 }} />
    <div style={{ position: 'absolute', bottom: 8, left: 8, zIndex: 2200, display: 'flex', gap: 8, flexWrap: 'wrap', maxWidth: '95vw' }}>
      <button onClick={() => setOpen(value => !value)}>Toggle tools</button>
      <button onClick={() => { setReady(false); mapRef.current?.setStyle(blankStyle(!dark), { diff: false }); setDark(!dark); }}>Reload style</button>
      <button onClick={() => setOwner(value => value === 'fixture-a' ? 'fixture-b' : 'fixture-a')}>Switch account</button>
      <button onClick={() => setTier(value => value === 'guest' ? 'analyst' : 'guest')}>Toggle guest</button>
      <input aria-label="Outside editor" placeholder="Outside editor" />
      <output aria-label="Fixture account">{owner} / {tier}</output>
      <output aria-label="Rendered drawings">{renderedCount}</output>
      {mapError && <output data-fixture-error role="alert">{mapError}</output>}
    </div>
    <MapDrawTools mapRef={mapRef} mapReady={ready} isOpen={open} userTier={tier} ownerId={tier === 'guest' ? null : owner} onClose={() => setOpen(false)} />
  </main>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
