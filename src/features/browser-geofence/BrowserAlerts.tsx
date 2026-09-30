'use client';
import { useState } from 'react';
import { LuBell } from 'react-icons/lu';
import type { BBox } from '@/lib/core/types';
import { regionBounds } from './region';
import { MAX_WATCHES, type Watch, type WatchScope } from './store';
import { useBrowserAlerts } from './useBrowserAlerts';
import styles from './BrowserAlerts.module.css';

interface Props { account: string | null; bbox: BBox | null; scope: WatchScope }
function WatchRow({ watch, busy, rename, remove, toggle }: {
  watch: Watch; busy: boolean;
  rename(id: string, name: string): Promise<void>; remove(id: string): Promise<void>; toggle(id: string): Promise<void>;
}) {
  const [name, setName] = useState(watch.region.name);
  const bounds = regionBounds(watch.region);
  return <li className={styles.watch}>
    <form onSubmit={event => { event.preventDefault(); void rename(watch.region.id, name); }}>
      <label>Watch name<input title="Edit the locally saved watch name" aria-label={`Rename ${watch.region.name}`} value={name} maxLength={60} required onChange={e => setName(e.target.value)} /></label>
      <button title="Rename without resetting alert history" disabled={busy || name === watch.region.name} type="submit">Rename</button>
    </form>
    <p>{watch.enabled ? watch.state === 'baseline' ? 'Awaiting a complete baseline' : watch.state === 'incomplete' ? 'Incomplete or stale — checkpoint kept' : watch.state === 'error' ? 'Check failed — checkpoint kept' : 'Watching' : 'Paused'}</p>
    <details>
      <summary>Review saved scope</summary>
      <p>Live last 24 hours. {watch.scope.query ? `Search: ${watch.scope.query}. ` : ''}Sources: {watch.scope.sources.join(', ') || 'none'}. Categories: {watch.scope.categories.join(', ') || 'none'}. Credibility: {watch.scope.credibilityTiers.join(', ') || 'none'}. Minimum reports: {watch.scope.minVolume}.</p>
      <p>{bounds.map((b, i) => <span key={i}>{b.minLat.toFixed(2)}–{b.maxLat.toFixed(2)}° latitude, {b.minLng.toFixed(2)}–{b.maxLng.toFixed(2)}° longitude. </span>)}</p>
      <p>Saved {new Date(watch.region.createdAt).toLocaleString()}. Last complete check: {watch.checkpoint ? new Date(watch.checkpoint.checkedAt).toLocaleString() : 'pending'}. Reviewing keeps alert history.</p>
    </details>
    <div className={styles.actions}>
      <button title="Pause or resume this watch with a fresh baseline" type="button" disabled={busy} onClick={() => void toggle(watch.region.id)}>{watch.enabled ? 'Pause watch' : 'Resume watch'}</button>
      <button title="Delete this locally saved watch" type="button" disabled={busy} onClick={() => void remove(watch.region.id)} aria-label={`Delete ${watch.region.name}`}>Delete</button>
    </div>
  </li>;
}

/** Parent keys this component by account/tier so no previous account's private UI survives a switch. */
export default function BrowserAlerts({ account, bbox, scope }: Props) {
  const alerts = useBrowserAlerts(account);
  const [name, setName] = useState('Viewport watch');
  const [open, setOpen] = useState(false);
  return <aside className={styles.container} aria-label="Browser geofence experiment">
    <button title="Manage local browser geofence alerts" className={styles.launcher} type="button" aria-expanded={open} aria-controls="browser-alert-panel" onClick={() => setOpen(v => !v)}>
      <LuBell aria-hidden="true" /> <span>Watch alerts</span>{alerts.store.enabled && <span aria-label="Checks enabled">●</span>}
    </button>
    {open && <section id="browser-alert-panel" className={styles.panel} aria-label="Watch alerts">
      <div className={styles.heading}><h2>Checks while Seraphim is open</h2><button title="Close watch alerts" type="button" aria-label="Close watch alerts" onClick={() => setOpen(false)}>×</button></div>
      <p>Save up to {MAX_WATCHES} viewport watches on this device for this account. Each uses saved filters and the live last 24 hours, independently of the current map or time window.</p>
      <p>Checks run about every 5 minutes while visible and online. Hidden tabs, sleep, offline periods and failures delay checks; gaps of 24 hours establish a fresh baseline. Closing Seraphim stops checks. Closed-browser Web Push and email are not active.</p>
      <p>Notifications use generic text without watch names or event headlines. Clicking opens an event; burst notifications group up to 20 events and open the first. OS settings may suppress display.</p>
      <p className={styles.status} role="status">{alerts.message}</p>
      {account && <>
        <form className={styles.save} onSubmit={event => { event.preventDefault(); void alerts.save(bbox, name, scope); }}>
          <label>New watch name<input title="Name this viewport watch on this device" value={name} onChange={e => setName(e.target.value)} maxLength={60} required /></label>
          <button title="Save the current viewport and filter scope locally" type="submit" disabled={alerts.busy || alerts.store.watches.length >= MAX_WATCHES || !bbox}>Save current viewport + filters</button>
          <small>Zoom in to at most 60° per direction. First complete check records existing events without notifying. Narrow regions help avoid your plan’s result limit.</small>
        </form>
        <div className={styles.actions}>
          {alerts.store.enabled
            ? <button title="Stop all open-session checks" type="button" disabled={alerts.busy} onClick={() => void alerts.pause()}>Pause all checks</button>
            : <button title="Explicitly opt in to browser notifications" type="button" disabled={alerts.busy || !alerts.store.watches.some(w => w.enabled)} onClick={() => void alerts.enable()}>Enable browser notifications</button>}
          <button title="Delete all local watches and alert deduplication history" type="button" disabled={alerts.busy} onClick={() => void alerts.clear()}>Delete local watches and history</button>
        </div>
        <ul className={styles.list}>{alerts.store.watches.map(w => <WatchRow key={`${w.region.id}:${w.region.name}`} watch={w} busy={alerts.busy} rename={alerts.rename} remove={alerts.remove} toggle={alerts.toggle} />)}</ul>
      </>}
    </section>}
  </aside>;
}
