'use client';

import React, { useEffect, useRef, useState } from 'react';
import type { AnalystWorkspace as Workspace } from '@/hooks/useAnalystWorkspace';
import { MAX_SELECTION, MAX_PACKETS, MAX_NOTE_LENGTH, type EvidencePacket, type EvidenceScope } from '@/lib/analyst/types';
import { safeExternalHttpUrl } from '@/lib/security/externalUrl';
import styles from './AnalystWorkspace.module.css';

export function EvidenceSelectionControl({ title, selected, representative, disabled, onToggle }: {
  title: string; selected: boolean; representative: boolean; disabled?: boolean; onToggle: () => void;
}) {
  return <button type="button" className={styles.selectionButton} aria-pressed={selected} disabled={disabled} onClick={onToggle}
    aria-label={`${selected ? 'Remove from' : 'Add to'} evidence selection: ${title}`}
    title={representative ? 'Select only the individual representative of this aggregate' : 'Select this event for an evidence packet'}>
    <span aria-hidden="true">{selected ? '✓' : '+'}</span> {selected ? 'In evidence selection' : representative ? 'Add representative to evidence' : 'Add to evidence'}
  </button>;
}

export function AnalystWorkspaceButton({ workspace }: { workspace: Workspace }) {
  return <button type="button" className={styles.launchButton} onClick={() => workspace.setOpen(true)}
    title="Open the local analyst evidence workspace">Evidence workspace <span>{workspace.selections.length}/{MAX_SELECTION}</span></button>;
}

export default function AnalystWorkspace({ workspace: w, scope, currentItem, signedIn }: {
  workspace: Workspace; scope: EvidenceScope; currentItem?: import('@/lib/core/types').NewsItem; signedIn: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const [packetId, setPacketId] = useState<string | null>(null);
  const [notesPacketId, setNotesPacketId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const printCleanup = useRef<(() => void) | null>(null);
  const resources = useRef<Set<() => void>>(new Set());
  useEffect(() => {
    if (w.open && dialog.current && !dialog.current.open) {
      returnFocus.current = document.activeElement as HTMLElement;
      dialog.current.showModal();
    } else if (!w.open && dialog.current?.open) {
      dialog.current.close();
      returnFocus.current?.focus();
    }
  }, [w.open]);
  useEffect(() => () => { resources.current.forEach(cleanup => cleanup()); resources.current.clear(); }, []);
  useEffect(() => {
    resources.current.forEach(cleanup => cleanup()); resources.current.clear();
  }, [w.allowed, w.resetId]);
  const packets = w.unsaved ? [w.unsaved, ...w.packets] : w.packets;
  const packet = packets.find(p => p.id === packetId) ?? packets[0];
  const includeNotes = Boolean(packet && notesPacketId === packet.id);
  const setIncludeNotes = (included: boolean) => setNotesPacketId(included && packet ? packet.id : null);
  const notesPreview = packet?.entries.filter(e => w.notes[e.selection.id]) ?? [];

  async function download(format: 'json' | 'csv' | 'html', selected: EvidencePacket) {
    const content = await w.exportPacket(selected, format, includeNotes);
    if (content === null) return;
    const type = format === 'json' ? 'application/json' : format === 'csv' ? 'text/csv;charset=utf-8' : 'text/html;charset=utf-8';
    const url = URL.createObjectURL(new Blob([content], { type }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `seraphim-evidence-${selected.id}.${format}`;
    document.body.appendChild(link); link.click(); link.remove();
    const cleanup = () => { clearTimeout(timer); URL.revokeObjectURL(url); resources.current.delete(cleanup); };
    resources.current.add(cleanup);
    const timer = setTimeout(cleanup, 1000);
  }
  async function print(selected: EvidencePacket) {
    const content = await w.exportPacket(selected, 'html', includeNotes);
    if (content === null) return;
    printCleanup.current?.();
    const frame = document.createElement('iframe');
    frame.title = 'Printable evidence brief';
    frame.style.cssText = 'position:fixed;width:1px;height:1px;left:-10000px;border:0';
    frame.setAttribute('sandbox', 'allow-same-origin allow-modals');
    const cleanup = () => { clearTimeout(timer); frame.remove(); resources.current.delete(cleanup); if (printCleanup.current === cleanup) printCleanup.current = null; };
    printCleanup.current = cleanup;
    resources.current.add(cleanup);
    frame.onload = () => { frame.contentWindow?.focus(); frame.contentWindow?.print(); };
    frame.srcdoc = content;
    document.body.appendChild(frame);
    const timer = setTimeout(cleanup, 60_000);
  }

  return <dialog ref={dialog} className={styles.dialog} aria-labelledby="analyst-workspace-title"
    onCancel={event => { event.preventDefault(); w.setOpen(false); }}
    onKeyDown={event => { event.stopPropagation(); }}>
    <header className={styles.header}><div><p className={styles.eyebrow}>Analyst experiment · local to this browser</p><h1 id="analyst-workspace-title">Evidence workspace</h1></div>
      <button type="button" title="Close the evidence workspace" onClick={() => w.setOpen(false)} autoFocus aria-label="Close evidence workspace">Close</button></header>
    <div className={styles.content}>
      <p>Select events separately from the active map pin. Capture copies the server-authorized details at response time. It is an observation packet, not an authenticated archive.</p>
      {scope.reportingReplay && <p>Reporting replay is active. Capture copies current exact event details, not historical state at the cursor. The displayed replay window is recorded with the packet; later playback cannot change that copy.</p>}
      {w.error && <p role="alert" className={styles.error}>{w.error}</p>}
      {w.storageUnavailable && <p>Local saving is unavailable. Your selection and completed capture stay here while you retry. <button type="button" disabled={w.busy} title="Recheck access and retry local storage without clearing your work" onClick={w.retryStorage}>Retry local saving</button></p>}
      {!w.allowed ? <section className={styles.section}><h2>Analyst or Angel access required</h2><p>Sign in with an eligible account to select, capture, and export evidence. Access is checked again for each capture and export.</p>
        {signedIn && <button type="button" title="Verify current account evidence access again" onClick={w.retryAccess}>Recheck access</button>}</section> : <>
      <section className={styles.section}><div className={styles.row}><h2>Selection <small>{w.selections.length}/{MAX_SELECTION}</small></h2>
        <button type="button" disabled={w.busy || !w.selections.length} title="Remove all events from the evidence selection" onClick={w.clearSelection}>Clear selection</button></div>
        {currentItem && <button type="button" disabled={w.busy} title="Add or remove the active map event from the evidence selection" onClick={() => w.toggle(currentItem)}>Toggle active event in evidence selection</button>}
        {!w.selections.length && <p>Use “Add to evidence” on story cards, or add the active map event here. Up to 20 distinct events per capture.</p>}
        <ul className={styles.selectionList}>{w.selections.map(item => <li key={item.id}><div><strong>{item.title}</strong>
          {item.representative && <p>Aggregate representative of {item.representedStoryCount} stories. Only this individual event will be fetched.</p>}
          <label className={styles.noteLabel}>Private note for {item.title}<textarea title="Private local note; excluded from exports by default" value={w.notes[item.id] ?? ''} maxLength={MAX_NOTE_LENGTH} disabled={w.busy}
            placeholder="Local note. Excluded from every export by default." onChange={e => w.setNote(item.id, e.target.value)} /></label></div>
          <button type="button" disabled={w.busy} title="Remove this event from the evidence selection" onClick={() => w.removeSelection(item.id)} aria-label={`Remove selected event: ${item.title}`}>Remove</button></li>)}</ul>
        <p className={styles.muted}>Notes and packets stay in this browser under this account. They are never synced. Deleting a packet preserves its private notes; clear an individual note above or delete the local workspace.</p>
        <details><summary>Dashboard scope at capture</summary><pre>{JSON.stringify(scope, null, 2)}</pre><p>Selections can persist across filter changes. Exact details may be outside this list window. Aggregate rows do not identify every member. Dashboard feed freshness is not reported.</p></details>
        <div className={styles.row}><button type="button" className={styles.primary} disabled={w.busy || !w.selections.length || Boolean(w.unsaved) || scope.feedStatus === 'loading'} title="Copy details for the selected events into an immutable packet" onClick={() => w.capture(scope)}>Capture selected events</button>
          {w.busy && <><span role="status">Working · {w.progress}/{w.selections.length} details</span><button type="button" title="Cancel the current capture or export" onClick={w.cancel}>Cancel</button></>}</div>
      </section>
      <section className={styles.section}><h2>Copied packets <small>{w.packets.length}/{MAX_PACKETS} saved</small></h2>
        {!packets.length ? <p>A capture will appear here, including any partial errors. Later feed updates and note edits cannot alter the captured packet.</p> : <>
        <label>Packet <select title="Choose a copied evidence packet" value={packet?.id ?? ''} onChange={e => { setPacketId(e.target.value); setIncludeNotes(false); }}>{packets.map(p => <option key={p.id} value={p.id}>{new Date(p.captureStartedAt).toLocaleString()} · {p.entries.filter(e => e.status === 'captured').length}/{p.entries.length} captured{p.id === w.unsaved?.id ? ' · unsaved' : ''}</option>)}</select></label>
        {packet && <><p>Capture {packet.captureStartedAt} → {packet.captureEndedAt}. Access checked {packet.checkedAt}.</p>
          {packet.id === w.unsaved?.id ? <div className={styles.row}><button type="button" disabled={w.busy} title="Retry local saving and deliberately save this completed capture in the current workspace" onClick={w.saveUnsaved}>Retry saving packet</button><button type="button" disabled={w.busy} title="Discard only this unsaved capture" onClick={w.discardUnsaved}>Discard unsaved packet</button><p>Save or discard this unsaved packet before capturing again.</p></div> : <button type="button" disabled={w.busy} title="Delete this local packet; private notes are preserved" onClick={() => { w.deletePacket(packet.id); setIncludeNotes(false); }}>Delete this packet</button>}
          <ul className={styles.entries}>{packet.entries.map(entry => { const sourceUrl = safeExternalHttpUrl(entry.event?.url); return <li key={entry.selection.id}>
            <strong>{entry.event?.title ?? entry.selection.title}</strong><p>{entry.status === 'error' ? `Capture error: ${entry.error}` : `${entry.restrictions?.returnedSources} sources copied · ${entry.restrictions?.timelineRestricted ? 'restricted timeline' : 'server-authorized timeline'}${entry.restrictions?.sourcesTruncated ? ' · locally truncated at 200 sources' : ''}`}</p>
            <p className={styles.muted}>Response {entry.responseReceivedAt} · Published {entry.event?.publishedAt ?? 'not captured'}</p>
            {sourceUrl && <a title="Open the original reporting in a new tab" href={sourceUrl.href} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">Original reporting</a>}
          </li>; })}</ul>
          <label className={styles.checkbox}><input title="Preview and explicitly include private notes in this export" type="checkbox" checked={includeNotes} disabled={w.busy} onChange={e => setIncludeNotes(e.target.checked)} />Include private notes in this export</label>
          {includeNotes && <div className={styles.notePreview} role="note"><h3>Private-note inclusion preview</h3><p>These current note copies will leave this browser in the download or printed brief. They are separate from the immutable packet.</p>
            {notesPreview.length ? notesPreview.map(entry => <div key={entry.selection.id}><strong>{entry.selection.title}</strong><p>{w.notes[entry.selection.id]}</p></div>) : <p>No notes for this packet.</p>}</div>}
          <div className={styles.exports}><button type="button" disabled={w.busy} title="Download structured JSON with attribution" onClick={() => download('json', packet)}>Download JSON</button><button type="button" disabled={w.busy} title="Download event and source CSV rows" onClick={() => download('csv', packet)}>Download CSV</button><button type="button" disabled={w.busy} title="Download a self-contained printable HTML brief" onClick={() => download('html', packet)}>Download printable brief</button><button type="button" disabled={w.busy} title="Print a self-contained brief or save it as PDF" onClick={() => print(packet)}>Print / save PDF</button></div>
          <p className={styles.muted}>JSON preserves structured attribution. CSV has packet, event, source, error, and optional note rows. Unsafe links are omitted in the printable brief. Each export rechecks account access.</p></>}
        </>}
      </section></>}
      {signedIn && <section className={styles.section}><h2>Local data</h2><p>Storage is bounded to 8 packets and 2 MB per account. Browser data is unencrypted; use a trusted device. Downloaded files must be deleted separately.</p>
        {deleting ? <div className={styles.row}><span>Delete all packets and private notes for this account in this browser?</span><button type="button" title="Permanently delete this account’s local packets and private notes" onClick={() => { w.deleteLocalData(); setDeleting(false); setIncludeNotes(false); }}>Delete local workspace</button><button type="button" title="Keep the local workspace data" onClick={() => setDeleting(false)}>Keep data</button></div> : <button type="button" title="Review deletion of all account-scoped local evidence data" onClick={() => setDeleting(true)}>Delete all local evidence data…</button>}
      </section>}
    </div>
  </dialog>;
}
