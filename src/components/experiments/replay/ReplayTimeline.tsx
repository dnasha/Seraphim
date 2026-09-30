'use client';

import { useState, useSyncExternalStore } from 'react';
import { canUseTimeRange, hasFeature, type UserTier } from '@/lib/entitlements';
import { compareReplayWindows, replayTime, replayLocalInput, replayInputTimestamp, validReplayWindow, type ReplayWindow } from '@/lib/experiments/replay';
import type { useReplay } from './useReplay';
import styles from './ReplayTimeline.module.css';

type Replay = ReturnType<typeof useReplay>;
const motionQuery = '(prefers-reduced-motion: reduce)';
const subscribeMotion = (listener: () => void) => {
    const media = window.matchMedia?.(motionQuery);
    media?.addEventListener('change', listener);
    return () => media?.removeEventListener('change', listener);
};
const motionSnapshot = () => window.matchMedia?.(motionQuery).matches ?? false;

function WindowEditor({ name, value, bounds, onSave }: { name: 'A' | 'B'; value: ReplayWindow; bounds: ReplayWindow; onSave: (window: ReplayWindow) => void }) {
    const [start, setStart] = useState(() => replayLocalInput(value.start));
    const [end, setEnd] = useState(() => replayLocalInput(value.end));
    const [error, setError] = useState('');
    return <form className={styles.editor} onSubmit={event => {
        event.preventDefault();
        const next = { start: replayInputTimestamp(start, value.start) ?? NaN, end: replayInputTimestamp(end, value.end) ?? NaN };
        if (!validReplayWindow(next, bounds)) { setError('Choose valid, increasing local dates inside the captured coverage.'); return; }
        setError('');
        onSave(next);
    }}>
        <label>Window {name} start (local time)<input title="Choose the local start time inside captured coverage" type="datetime-local" step="any" value={start} onChange={event => setStart(event.target.value)} required /></label>
        <label>Window {name} end (local time)<input title="Choose the local end time inside captured coverage" type="datetime-local" step="any" value={end} onChange={event => setEnd(event.target.value)} required /></label>
        <button type="submit" title="Apply these comparison bounds without changing the live query">Apply {name}</button>
        {error && <p role="alert">{error}</p>}
    </form>;
}

function ReplayControls({ replay, tier }: { replay: Replay; tier: UserTier }) {
    const state = replay.state!;
    const { snapshot, cursor, playing, a, b } = state;
    const reducedMotion = useSyncExternalStore(subscribeMotion, motionSnapshot, () => false);
    const comparison = compareReplayWindows(snapshot, a, b);
    return <>
        <div className={styles.controls}>
            <button type="button" onClick={replay.togglePlayback} disabled={reducedMotion} title={reducedMotion ? 'Automatic playback is off for reduced motion; use the slider or Step forward.' : 'Advance the frozen dataset locally'}>{playing ? 'Pause' : 'Play'}</button>
            <button type="button" title="Advance the reporting cursor one frame" onClick={() => replay.scrub(Math.min(snapshot.bounds.end, cursor + (snapshot.bounds.end - snapshot.bounds.start) / 60))}>Step forward</button>
            <label className={styles.slider}>Reporting cursor
                <input title="Scrub available reporting timestamps in the frozen view" type="range" min={snapshot.bounds.start} max={snapshot.bounds.end} step={Math.max(1, Math.floor((snapshot.bounds.end - snapshot.bounds.start) / 1440))} value={cursor} onChange={event => replay.scrub(Number(event.target.value))} aria-valuetext={replayTime(cursor)} />
            </label>
            <label className={styles.duration}>Display window
                <select title="Choose a local display window inside captured coverage" value={state.duration ?? 'all'} onChange={event => replay.setDuration(event.target.value === 'all' ? null : Number(event.target.value))}>
                    <option value="all">All through cursor</option>
                    <option value="3600000">Previous hour</option>
                    <option value="21600000">Previous 6 hours</option>
                    <option value="86400000">Previous 24 hours</option>
                </select>
            </label>
        </div>
        <p className={styles.range}><time dateTime={new Date(cursor).toISOString()}>{replayTime(cursor)}</time> · {replay.mapItems.length} represented rows in frame</p>
        {reducedMotion && <p>Reduced motion: scrub or step manually.</p>}
        {replay.outside && <p role="status" className={styles.warning}>Selected event is outside this replay window or has no dated evidence in this snapshot. Its URL selection is preserved; sidebar details use current metadata.</p>}
        <details className={styles.details}>
            <summary>Compare two reporting windows</summary>
            <div className={styles.comparison}>
                <div><strong>A</strong><p>{replayTime(a.start)} → {replayTime(a.end)}</p><button type="button" title="Capture the displayed bounds for comparison" disabled={!replay.window || !validReplayWindow(replay.window, snapshot.bounds)} onClick={() => replay.window && replay.setComparison('a', replay.window)}>Use displayed window as A</button></div>
                <div><strong>B</strong><p>{replayTime(b.start)} → {replayTime(b.end)}</p><button type="button" title="Capture the displayed bounds for comparison" disabled={!replay.window || !validReplayWindow(replay.window, snapshot.bounds)} onClick={() => replay.window && replay.setComparison('b', replay.window)}>Use displayed window as B</button></div>
            </div>
            <table><caption>Available dated evidence in the captured rows</caption><thead><tr><th scope="col">Measure</th><th scope="col">A</th><th scope="col">B</th></tr></thead><tbody>
                <tr><th scope="row">Represented event dates</th><td>{comparison.a.events}</td><td>{comparison.b.events}</td></tr>
                <tr><th scope="row">Rows with reporting activity</th><td>{comparison.a.active}</td><td>{comparison.b.active}</td></tr>
                <tr><th scope="row">Distinct dated activity points</th><td>{comparison.a.points}</td><td>{comparison.b.points}</td></tr>
            </tbody></table>
            <p>{comparison.newRepresented} new represented event dates in B relative to A; {comparison.reportingOverlap} rows with activity in both windows.</p>
            <p>Counts cover loaded representatives and available timestamps, not every story or publisher. Missing activity does not mean an event was resolved or deleted. Windows include their start and exclude their end, except the coverage endpoint.</p>
            {canUseTimeRange(tier, 'custom') && <details><summary>Edit comparison bounds (local time)</summary>
                <WindowEditor key={`a:${a.start}:${a.end}`} name="A" value={a} bounds={snapshot.bounds} onSave={next => replay.setComparison('a', next)} />
                <WindowEditor key={`b:${b.start}:${b.end}`} name="B" value={b} bounds={snapshot.bounds} onSave={next => replay.setComparison('b', next)} />
            </details>}
        </details>
        <details className={styles.details}>
            <summary>Reconstruction and coverage</summary>
            <p>Coverage: {replayTime(snapshot.bounds.start)} → {replayTime(snapshot.bounds.end)} ({snapshot.timeRange}). Captured {replayTime(snapshot.capturedAt)}{snapshot.feedUpdatedAt ? `; feed timestamp ${snapshot.feedUpdatedAt}` : ''}.</p>
            <p>Titles, coordinates, source totals, ranks, and merge membership are current metadata as captured. Selected story details may load current metadata. This does not simulate earlier titles, locations, or merge states. Event dates may have moved after merges.</p>
            <p>Replay uses the loaded filters and viewport as captured. Live filters and map scope continue separately; refresh the snapshot to capture the currently loaded view. Cached data may be stale. Source timelines are only included when already loaded.</p>
            <p>{snapshot.excludedDates} invalid or future report dates ignored; {snapshot.excludedRows} rows without dated evidence in coverage excluded. The snapshot stays in memory and clears when the account or tier changes, or when you return live.</p>
        </details>
    </>;
}

export default function ReplayTimeline({ replay, tier, resolving }: { replay: Replay; tier: UserTier; resolving: boolean }) {
    const permitted = !resolving && hasFeature(tier, 'fullTimeline');
    return <section className={styles.panel} aria-label="Reporting replay" data-active={Boolean(replay.state)}>
        <div className={styles.heading}>
            <div><strong>{replay.state ? 'Reconstructed reporting timeline' : 'Reporting replay'}</strong><span>{replay.state ? 'Frozen loaded view · current metadata' : 'Experiment · reconstruct the loaded view'}</span></div>
            {replay.state ? <div className={styles.actions}>
                <button type="button" disabled={!replay.canCapture} onClick={replay.capture} title="Replace the snapshot with the currently loaded view">Refresh snapshot</button>
                <button type="button" title="Discard the snapshot and show the current live view" onClick={replay.returnLive}>Return live</button>
            </div> : <button type="button" disabled={!permitted || !replay.canCapture} onClick={replay.capture} title={permitted ? 'Freeze the currently loaded view without changing your live filters' : 'Reporting replay requires Pro or higher'}>{permitted ? 'Freeze loaded view' : 'Replay · Pro'}</button>}
        </div>
        {replay.state && <div className={styles.body}>
            {replay.state.snapshot.isCapped && <p className={styles.warning}>Capped coverage{replay.state.snapshot.appliedLimit ? ` (limit ${replay.state.snapshot.appliedLimit})` : ''}: replay and comparisons may omit represented events and reporting activity.</p>}
            {replay.state.snapshot.clustered && <p className={styles.warning}>Spatial cluster representatives are shown; hidden cluster members have no individual replay history here.</p>}
            {!replay.state.snapshot.entries.length && <p role="status">No dated activity in this loaded view. Return live to adjust coverage, then freeze again.</p>}
            <ReplayControls key={replay.state.snapshot.capturedAt} replay={replay} tier={tier} />
        </div>}
    </section>;
}
