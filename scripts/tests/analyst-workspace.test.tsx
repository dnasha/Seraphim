// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useAnalystWorkspace } from '@/hooks/useAnalystWorkspace';
import AnalystWorkspace, { EvidenceSelectionControl } from '@/components/analyst/AnalystWorkspace';
import { saveStore, storageKey, emptyStore } from '@/lib/analyst/storage';
import { analystEvent, analystId, analystScope, detailBody, fixturePacket } from './fixtures/analyst';
import type { UserTier } from '@/lib/entitlements';
import { IDBDatabase, IDBFactory } from 'fake-indexeddb';
import { CHANGE_KEY, DATABASE_NAME, mutateStore, openStore, readStore, resetStore } from '@/lib/analyst/database';

let account = 'owner';
let status = 200;
let fakeFetch: ReturnType<typeof vi.fn>;
beforeEach(() => {
  localStorage.clear(); account = 'owner'; status = 200;
  vi.stubGlobal('indexedDB', new IDBFactory());
  fakeFetch = vi.fn(async (input: string) => input.includes('/access') ? Response.json({ userId: account, tier: 'analyst' }, { status }) : Response.json(detailBody()));
  vi.stubGlobal('fetch', fakeFetch);
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const stored = (owner = 'owner') => readStore(indexedDB, owner);
const boot = async () => {
  const hook = renderHook(({ owner, tier, ready }) => useAnalystWorkspace(owner, tier, ready), { initialProps: { owner: 'owner' as string | null, tier: 'analyst' as UserTier, ready: true } });
  await waitFor(() => expect(hook.result.current.allowed).toBe(true));
  return hook;
};

it('keeps selection independent, persists notes locally, and never changes immutable captured data', async () => {
  const hook = await boot();
  act(() => hook.result.current.toggle(analystEvent()));
  await act(async () => { await hook.result.current.setNote(analystId(), 'private original note'); });
  await act(async () => { await hook.result.current.capture(analystScope); });
  const packet = hook.result.current.packets[0];
  expect(packet.entries[0].event?.title).toBe('Fixture event 1');
  await act(async () => { await hook.result.current.setNote(analystId(), 'changed note'); });
  let exported: string | null = null;
  await act(async () => { exported = await hook.result.current.exportPacket(packet, 'json', false); });
  expect(exported).not.toContain('changed note');
  await act(async () => { exported = await hook.result.current.exportPacket(packet, 'json', true); });
  expect(exported).toContain('changed note');
  expect(packet).not.toHaveProperty('privateNotes');
  expect((await stored()).notes[analystId()]).toBe('changed note');
  expect(fakeFetch.mock.calls.filter(([url]) => url.includes('/api/news'))).toHaveLength(1);
});
it('clears private UI and cancels capture on account change even when an old request resolves later', async () => {
  saveStore(localStorage, { ...emptyStore('owner'), packets: [fixturePacket()], notes: { [analystId()]: 'owner-only secret' } });
  const hook = await boot();
  act(() => { hook.result.current.setOpen(true); hook.result.current.toggle(analystEvent()); });
  let resolveDetail: (response: Response) => void = () => {};
  let capturedSignal: AbortSignal | undefined;
  fakeFetch.mockImplementation(async (url: string, options: RequestInit) => {
    if (url.includes('access')) return Response.json({ userId: account, tier: 'analyst' });
    capturedSignal = options.signal as AbortSignal;
    return new Promise<Response>(resolve => { resolveDetail = resolve; });
  });
  let capture: Promise<void> = Promise.resolve();
  act(() => { capture = hook.result.current.capture(analystScope); });
  await waitFor(() => expect(capturedSignal).toBeDefined());
  account = 'other'; hook.rerender({ owner: 'other', tier: 'analyst', ready: true });
  expect(hook.result.current.packets).toEqual([]); expect(hook.result.current.notes).toEqual({});
  expect(hook.result.current.selections).toEqual([]); expect(hook.result.current.open).toBe(false);
  expect(capturedSignal!.aborted).toBe(true);
  await act(async () => { resolveDetail(Response.json(detailBody())); await capture; });
  await waitFor(() => expect(hook.result.current.allowed).toBe(true));
  expect(hook.result.current.packets).toEqual([]); expect((await stored('other')).packets).toEqual([]);
  expect((await stored()).notes[analystId()]).toBe('owner-only secret');
});
it.each(['guest', 'free', 'pro'] as UserTier[])('blocks private packet reads and exports on transition to %s', async tier => {
  saveStore(localStorage, { ...emptyStore('owner'), packets: [fixturePacket()] });
  const hook = await boot(); const packet = hook.result.current.packets[0];
  hook.rerender({ owner: tier === 'guest' ? null : 'owner', tier, ready: true });
  expect(hook.result.current.allowed).toBe(false); expect(hook.result.current.packets).toEqual([]);
  expect(await hook.result.current.exportPacket(packet, 'json', true)).toBeNull();
});
it('denies export after server-side access revocation and clears notes and packet UI', async () => {
  saveStore(localStorage, { ...emptyStore('owner'), packets: [fixturePacket()], notes: { [analystId()]: 'private' } });
  const hook = await boot(); const packet = hook.result.current.packets[0]; status = 403;
  let value: string | null = 'pending';
  await act(async () => { value = await hook.result.current.exportPacket(packet, 'html', true); });
  expect(value).toBeNull(); expect(hook.result.current.allowed).toBe(false);
  expect(hook.result.current.notes).toEqual({}); expect(hook.result.current.packets).toEqual([]);
  expect(hook.result.current.error).toContain('access changed');
});
it('rechecks on window focus and clears UI when access cannot be verified', async () => {
  const hook = await boot(); act(() => hook.result.current.toggle(analystEvent()));
  status = 503;
  await act(async () => { window.dispatchEvent(new Event('focus')); });
  expect(hook.result.current.allowed).toBe(false); expect(hook.result.current.selections).toEqual([]);
});
it('responds to cross-tab reset and supports deleting local data after a downgrade', async () => {
  saveStore(localStorage, { ...emptyStore('owner'), packets: [fixturePacket()], notes: { [analystId()]: 'private' } });
  const hook = await boot();
  await act(async () => { await resetStore(localStorage, indexedDB, 'owner', new AbortController().signal); });
  await waitFor(() => expect(hook.result.current.packets).toEqual([]));
  expect(hook.result.current.packets).toEqual([]); expect(hook.result.current.notes).toEqual({});
  await mutateStore(indexedDB, 'owner', (await stored()).resetId, { type: 'add-packet', packet: fixturePacket() }, new AbortController().signal);
  hook.rerender({ owner: 'owner', tier: 'free', ready: true });
  await act(async () => { await hook.result.current.deleteLocalData(); });
  expect((await stored()).packets).toEqual([]);
});
it('retains a completed capture for export after a storage failure and prevents overwriting corrupt data', async () => {
  localStorage.setItem(storageKey('owner'), '{corrupt');
  const hook = await boot();
  expect(hook.result.current.error).toContain('invalid');
  act(() => hook.result.current.toggle(analystEvent()));
  await act(async () => { await hook.result.current.capture(analystScope); });
  expect(hook.result.current.unsaved?.entries[0].status).toBe('captured');
  expect(hook.result.current.error).toContain('Safe saving');
  expect(localStorage.getItem(storageKey('owner'))).toBe('{corrupt');
  let text: string | null = null;
  await act(async () => { text = await hook.result.current.exportPacket(hook.result.current.unsaved!, 'json', false); });
  expect(text).toContain('Fixture event 1');
  await act(async () => { await hook.result.current.deleteLocalData(); });
  expect(hook.result.current.unsaved).toBeNull();
});
it('cancels export during an account transition without returning private content', async () => {
  saveStore(localStorage, { ...emptyStore('owner'), packets: [fixturePacket()] });
  const hook = await boot(); const packet = hook.result.current.packets[0];
  let resolveCheck: (response: Response) => void = () => {};
  fakeFetch.mockImplementation(() => new Promise<Response>(resolve => { resolveCheck = resolve; }));
  let exportResult: Promise<string | null> = Promise.resolve('pending');
  act(() => { exportResult = hook.result.current.exportPacket(packet, 'json', false); });
  hook.rerender({ owner: null, tier: 'guest', ready: true });
  await act(async () => { resolveCheck(Response.json({ userId: 'owner', tier: 'analyst' })); });
  expect(await exportResult).toBeNull();
});
it('requires explicit note inclusion preview and exposes partial errors and packet deletion', async () => {
  const withError = JSON.parse(JSON.stringify(fixturePacket()));
  withError.entries.push({ selection: { id: analystId(2), title: 'Missing fixture', selectedAt: '2026-09-30', representative: true, representedStoryCount: 4 }, status: 'error', error: 'Event no longer available (404).', requestStartedAt: '2026-09-30', responseReceivedAt: '2026-09-30' });
  saveStore(localStorage, { ...emptyStore('owner'), packets: [withError], notes: { [analystId()]: 'private inclusion text' } });
  function Harness() {
    const w = useAnalystWorkspace('owner', 'analyst', true);
    return <><button onClick={() => w.setOpen(true)}>Open</button><AnalystWorkspace workspace={w} scope={analystScope} signedIn /></>;
  }
  render(<Harness />); fireEvent.click(screen.getByRole('button', { name: 'Open' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Download JSON' })).toBeTruthy());
  expect(screen.getByText(/Capture error:.*404/)).toBeTruthy();
  expect(screen.queryByText('private inclusion text')).toBeNull();
  fireEvent.click(screen.getByRole('checkbox', { name: 'Include private notes in this export' }));
  expect(screen.getByText('Private-note inclusion preview')).toBeTruthy(); expect(screen.getByText('private inclusion text')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Delete this packet' }));
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Download JSON' })).toBeNull());
  expect(screen.queryByRole('button', { name: 'Download JSON' })).toBeNull();
  expect((await stored()).notes[analystId()]).toBe('private inclusion text');
});
it('makes the evidence toggle keyboard accessible with an explicit aggregate representative label', () => {
  const click = vi.fn();
  render(<EvidenceSelectionControl title="Fixture" selected={false} representative onToggle={click} />);
  const button = screen.getByRole('button', { name: 'Add to evidence selection: Fixture' });
  expect(button.textContent).toContain('representative'); fireEvent.click(button); expect(click).toHaveBeenCalledOnce();
});

it('reports unresolved IDs and selection quotas in the UI without throwing during render', async () => {
  const hook = await boot();
  act(() => hook.result.current.toggle({ ...analystEvent(), id: 'cluster-z4-unresolved' }));
  expect(hook.result.current.error).toContain('no resolvable');
  expect(hook.result.current.selections).toEqual([]);
  for (let index = 1; index <= 20; index++) act(() => hook.result.current.toggle(analystEvent(index)));
  act(() => hook.result.current.toggle(analystEvent(21)));
  expect(hook.result.current.error).toContain('20');
  expect(hook.result.current.selections).toHaveLength(20);
});

it('keeps an unsaved capture at the packet quota until explicitly saved or discarded', async () => {
  const packets = Array.from({ length: 8 }, (_, index) => ({ ...fixturePacket(), id: analystId(100 + index) }));
  saveStore(localStorage, { ...emptyStore('owner'), packets });
  const hook = await boot();
  act(() => hook.result.current.toggle(analystEvent()));
  await act(async () => { await hook.result.current.capture(analystScope); });
  expect(hook.result.current.packets).toHaveLength(8);
  const unsaved = hook.result.current.unsaved;
  expect(unsaved).not.toBeNull(); expect(hook.result.current.error).toContain('not saved');
  await act(async () => { await hook.result.current.capture(analystScope); });
  expect(hook.result.current.unsaved).toBe(unsaved);
  await act(async () => { await hook.result.current.deletePacket(analystId(100)); });
  await act(async () => { await hook.result.current.saveUnsaved(); });
  expect(hook.result.current.unsaved).toBeNull(); expect(hook.result.current.packets).toHaveLength(8);
  expect(hook.result.current.packets[0].id).toBe(unsaved!.id);
});
it('allows a new capture after cancellation while a stale transport is still unresolved', async () => {
  const hook = await boot(); act(() => hook.result.current.toggle(analystEvent()));
  let resolveOld: (response: Response) => void = () => {};
  fakeFetch.mockImplementationOnce(async () => Response.json({ userId: account, tier: 'analyst' }))
    .mockImplementationOnce(() => new Promise<Response>(resolve => { resolveOld = resolve; }));
  let oldCapture: Promise<void> = Promise.resolve();
  act(() => { oldCapture = hook.result.current.capture(analystScope); });
  await waitFor(() => expect(fakeFetch).toHaveBeenCalledTimes(3));
  act(() => hook.result.current.cancel());
  await act(async () => { await hook.result.current.capture(analystScope); });
  expect(hook.result.current.packets).toHaveLength(1);
  await act(async () => { resolveOld(Response.json(detailBody())); await oldCapture; });
  expect(hook.result.current.packets).toHaveLength(1); expect(hook.result.current.busy).toBe(false);
});

it('reconciles ordinary cross-tab changes without losing selection or a completed unsaved packet', async () => {
  const packets = Array.from({ length: 8 }, (_, i) => ({ ...fixturePacket(), id: analystId(100 + i) }));
  saveStore(localStorage, { ...emptyStore('owner'), packets });
  const hook = await boot(); act(() => hook.result.current.toggle(analystEvent()));
  await act(async () => { await hook.result.current.capture(analystScope); });
  const unsaved = hook.result.current.unsaved;
  await act(async () => { await mutateStore(indexedDB, 'owner', (await stored()).resetId, { type: 'set-note', id: analystId(2), note: 'other tab note', previous: '' }, new AbortController().signal); });
  await waitFor(() => expect(hook.result.current.notes[analystId(2)]).toBe('other tab note'));
  expect(hook.result.current.unsaved).toBe(unsaved);
  expect(hook.result.current.selections).toHaveLength(1);
  expect(hook.result.current.notes[analystId(2)]).toBe('other tab note');
  expect(hook.result.current.error).toContain('not saved');
});
it('preserves pending capture during an ordinary storage update but cancels it on an explicit reset', async () => {
  const hook = await boot(); act(() => hook.result.current.toggle(analystEvent()));
  let detailSignal: AbortSignal | undefined;
  let resolveDetail: (response: Response) => void = () => {};
  fakeFetch.mockImplementation(async (url: string, options: RequestInit) => {
    if (url.includes('access')) return Response.json({ userId: 'owner', tier: 'analyst' });
    detailSignal = options.signal as AbortSignal;
    return new Promise<Response>(resolve => { resolveDetail = resolve; });
  });
  let pending: Promise<void> = Promise.resolve();
  act(() => { pending = hook.result.current.capture(analystScope); });
  await waitFor(() => expect(detailSignal).toBeDefined());
  await act(async () => { await mutateStore(indexedDB, 'owner', (await stored()).resetId, { type: 'set-note', id: analystId(2), note: 'cross-tab write', previous: '' }, new AbortController().signal); });
  await waitFor(() => expect(hook.result.current.notes[analystId(2)]).toBe('cross-tab write'));
  expect(detailSignal!.aborted).toBe(false); expect(hook.result.current.busy).toBe(true);
  await act(async () => { resolveDetail(Response.json(detailBody())); await pending; });
  expect(hook.result.current.packets).toHaveLength(1); expect(hook.result.current.notes[analystId(2)]).toBe('cross-tab write');
  act(() => { pending = hook.result.current.capture(analystScope); });
  await waitFor(() => expect(hook.result.current.busy).toBe(true));
  await act(async () => { await hook.result.current.deleteLocalData(); resolveDetail(Response.json(detailBody())); await pending; });
  expect(detailSignal!.aborted).toBe(true); expect(hook.result.current.packets).toEqual([]);
  expect(hook.result.current.selections).toEqual([]); expect(hook.result.current.unsaved).toBeNull();
});
it('keeps rapid note edits and rejects a conflicting same-note write from a stale tab', async () => {
  const a = await boot(); const b = await boot();
  await act(async () => {
    await Promise.all([a.result.current.setNote(analystId(), 'first'), b.result.current.setNote(analystId(), 'conflicting')]);
  });
  expect((await stored()).notes[analystId()]).toBe('first');
  expect(b.result.current.error).toContain('not saved'); expect(b.result.current.notes[analystId()]).toBe('first');
  await act(async () => {
    await Promise.all([a.result.current.setNote(analystId(), 'f'), a.result.current.setNote(analystId(), 'fi'), a.result.current.setNote(analystId(), 'final')]);
  });
  expect(a.result.current.notes[analystId()]).toBe('final');
  expect((await stored()).notes[analystId()]).toBe('final');
});
it('keeps capture/export usable without IndexedDB, with an explicit save error and no unsafe write fallback', async () => {
  vi.stubGlobal('indexedDB', undefined);
  const hook = await boot();
  expect(hook.result.current.error).toContain('IndexedDB');
  act(() => hook.result.current.toggle(analystEvent()));
  await act(async () => { await hook.result.current.capture(analystScope); });
  expect(hook.result.current.unsaved).not.toBeNull(); expect(localStorage.getItem(storageKey('owner'))).toBeNull();
  let output: string | null = null;
  await act(async () => { output = await hook.result.current.exportPacket(hook.result.current.unsaved!, 'csv', false); });
  expect(output).toContain('Fixture event 1');
});
it('contains dashboard key events on buttons and packet selection while keeping textarea input editable', async () => {
  saveStore(localStorage, { ...emptyStore('owner'), packets: [fixturePacket()] });
  function Harness() { const w = useAnalystWorkspace('owner', 'analyst', true); return <><button onClick={() => w.setOpen(true)}>Open</button><AnalystWorkspace workspace={w} scope={analystScope} signedIn currentItem={analystEvent()} /></>; }
  const background = vi.fn(); window.addEventListener('keydown', background);
  render(<Harness />); fireEvent.click(screen.getByRole('button', { name: 'Open' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Download JSON' })).toBeTruthy());
  for (const target of [screen.getByRole('button', { name: 'Close evidence workspace' }), screen.getByRole('combobox')]) {
    for (const key of ['t', 'c', 'm', '/', 'Escape']) fireEvent.keyDown(target, { key });
  }
  expect(background).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Toggle active event in evidence selection' }));
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'tcm typed normally' } });
  await waitFor(async () => expect((await stored()).notes[analystId()]).toBe('tcm typed normally'));
  window.removeEventListener('keydown', background);
});

it('downloads all formats, resets note opt-in on packet switch and removes print resources on downgrade', async () => {
  saveStore(localStorage, { ...emptyStore('owner'), packets: [fixturePacket(), { ...fixturePacket(), id: analystId(101) }], notes: { [analystId()]: 'private preview' } });
  const blobs: Blob[] = [];
  const revoke = vi.fn();
  const OriginalURL = URL;
  vi.stubGlobal('URL', class extends OriginalURL {
    static createObjectURL(blob: Blob) { blobs.push(blob); return `blob:fixture-${blobs.length}`; }
    static revokeObjectURL = revoke;
  });
  const clicked = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  function Harness({ tier }: { tier: UserTier }) { const w = useAnalystWorkspace('owner', tier, true); return <><button onClick={() => w.setOpen(true)}>Open</button><AnalystWorkspace workspace={w} scope={analystScope} signedIn /></>; }
  const view = render(<Harness tier="analyst" />); fireEvent.click(screen.getByRole('button', { name: 'Open' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Download JSON' })).toBeTruthy());
  fireEvent.click(screen.getByRole('checkbox'));
  expect(screen.getByText('private preview')).toBeTruthy();
  fireEvent.change(screen.getByRole('combobox'), { target: { value: analystId(101) } });
  expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false);
  for (const name of ['Download JSON', 'Download CSV', 'Download printable brief']) {
    fireEvent.click(screen.getByRole('button', { name }));
    await waitFor(() => expect(screen.getByRole('button', { name }).hasAttribute('disabled')).toBe(false));
  }
  expect(blobs.map(blob => blob.type)).toEqual(['application/json', 'text/csv;charset=utf-8', 'text/html;charset=utf-8']);
  expect(blobs.every(blob => blob.size > 0)).toBe(true); expect(clicked).toHaveBeenCalledTimes(3);
  let printCalls = 0;
  const originalAppend = document.body.appendChild.bind(document.body);
  const append = vi.spyOn(document.body, 'appendChild').mockImplementation(node => {
    const appended = originalAppend(node);
    if (node instanceof HTMLIFrameElement) {
      vi.spyOn(node.contentWindow!, 'focus').mockImplementation(() => {});
      vi.spyOn(node.contentWindow!, 'print').mockImplementation(() => { printCalls++; });
    }
    return appended;
  });
  fireEvent.click(screen.getByRole('button', { name: 'Print / save PDF' }));
  await waitFor(() => expect(document.querySelector('iframe')).toBeTruthy());
  const frame = document.querySelector('iframe')!;
  expect(frame.getAttribute('sandbox')).toBe('allow-same-origin allow-modals');
  expect(frame.srcdoc).not.toContain('private preview');
  fireEvent.load(frame); expect(printCalls).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole('button', { name: 'Delete all local evidence data…' }));
  fireEvent.click(screen.getByRole('button', { name: 'Delete local workspace' }));
  await waitFor(() => expect(document.querySelector('iframe')).toBeNull());
  view.rerender(<Harness tier="pro" />);
  expect(document.querySelector('iframe')).toBeNull();
  expect(revoke).toHaveBeenCalledTimes(3);
  clicked.mockRestore(); append.mockRestore();
});
it('reports malformed cross-tab data without discarding an unsaved packet or selection', async () => {
  const hook = await boot(); act(() => hook.result.current.toggle(analystEvent()));
  // Force a save quota failure with eight existing packets, retaining the ninth.
  const current = await stored();
  for (let i = 100; i < 108; i++) await mutateStore(indexedDB, 'owner', current.resetId, { type: 'add-packet', packet: { ...fixturePacket(), id: analystId(i) } }, new AbortController().signal);
  await act(async () => { await hook.result.current.capture(analystScope); });
  const unsaved = hook.result.current.unsaved;
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onsuccess = () => { const tx = request.result.transaction('workspaces', 'readwrite'); tx.objectStore('workspaces').put({ invalid: true }, storageKey('owner')); tx.oncomplete = () => { request.result.close(); resolve(); }; };
    request.onerror = () => reject(request.error);
  });
  act(() => window.dispatchEvent(new CustomEvent(CHANGE_KEY, { detail: storageKey('owner') })));
  await waitFor(() => expect(hook.result.current.error).toContain('Invalid'));
  expect(hook.result.current.unsaved).toBe(unsaved); expect(hook.result.current.selections).toHaveLength(1);
  expect(hook.result.current.error).toContain('Invalid');
});

it('attaches the first recovered generation without losing an unsaved capture, then honors later resets', async () => {
  const factory = indexedDB;
  const packets = Array.from({ length: 7 }, (_, i) => ({ ...fixturePacket(), id: analystId(100 + i) }));
  saveStore(localStorage, { ...emptyStore('owner'), packets });
  const original = await openStore(localStorage, factory, 'owner', new AbortController().signal);
  vi.stubGlobal('indexedDB', undefined);
  const hook = await boot(); act(() => hook.result.current.toggle(analystEvent()));
  await act(async () => { await hook.result.current.capture(analystScope); });
  const unsaved = hook.result.current.unsaved;
  expect(unsaved).not.toBeNull(); expect(hook.result.current.storageUnavailable).toBe(true);
  vi.stubGlobal('indexedDB', factory);
  await act(async () => { window.dispatchEvent(new Event('focus')); });
  await waitFor(() => expect(hook.result.current.packets).toHaveLength(7));
  expect(hook.result.current.unsaved).toBe(unsaved); expect(hook.result.current.selections).toHaveLength(1);
  expect(hook.result.current.storageUnavailable).toBe(false);
  expect(hook.result.current.resetId).toBe(original.resetId);
  await act(async () => { await hook.result.current.saveUnsaved(); });
  expect((await stored()).packets).toHaveLength(8); expect(hook.result.current.unsaved).toBeNull();
  await act(async () => { await resetStore(localStorage, factory, 'owner', new AbortController().signal); });
  await waitFor(() => expect(hook.result.current.selections).toEqual([]));
  await expect(mutateStore(factory, 'owner', original.resetId, { type: 'add-packet', packet: unsaved! }, new AbortController().signal)).rejects.toThrow('workspace was reset');
  expect((await stored()).packets).toEqual([]);
});

it('recovers from a read failure through a same-generation cross-tab update and saves the retained eighth packet', async () => {
  const packets = Array.from({ length: 7 }, (_, i) => ({ ...fixturePacket(), id: analystId(100 + i) }));
  saveStore(localStorage, { ...emptyStore('owner'), packets });
  const hook = await boot(); const generation = hook.result.current.resetId!;
  act(() => hook.result.current.toggle(analystEvent()));
  const nativeTransaction = IDBDatabase.prototype.transaction;
  const outage = vi.spyOn(IDBDatabase.prototype, 'transaction').mockImplementation(function (this: IDBDatabase, ...args) {
    if (args[1] === 'readonly') throw new DOMException('Temporary read outage', 'UnknownError');
    return nativeTransaction.apply(this, args);
  });
  await act(async () => { window.dispatchEvent(new Event('focus')); });
  await waitFor(() => expect(hook.result.current.storageUnavailable).toBe(true));
  await act(async () => { await hook.result.current.capture(analystScope); });
  const unsaved = hook.result.current.unsaved;
  expect(unsaved).not.toBeNull(); expect(hook.result.current.error).toContain('Safe saving');
  outage.mockRestore();
  await act(async () => { await mutateStore(indexedDB, 'owner', generation, { type: 'set-note', id: analystId(2), previous: '', note: 'native recovery notification' }, new AbortController().signal); });
  await waitFor(() => expect(hook.result.current.storageUnavailable).toBe(false));
  expect(hook.result.current.notes[analystId(2)]).toBe('native recovery notification');
  expect(hook.result.current.unsaved).toBe(unsaved); expect(hook.result.current.selections).toHaveLength(1);
  expect(hook.result.current.error).toBeNull();
  await act(async () => { await hook.result.current.saveUnsaved(); });
  expect((await stored()).packets).toHaveLength(8); expect((await stored()).packets[0].id).toBe(unsaved!.id);
  expect(hook.result.current.unsaved).toBeNull();
});

it('retains pending capture during first attachment and requires a deliberate save into the new generation', async () => {
  const factory = indexedDB;
  vi.stubGlobal('indexedDB', undefined);
  const hook = await boot(); act(() => hook.result.current.toggle(analystEvent()));
  let resolveDetail: (response: Response) => void = () => {};
  let signal: AbortSignal | undefined;
  fakeFetch.mockImplementation(async (url: string, options: RequestInit) => {
    if (url.includes('/access')) return Response.json({ userId: 'owner', tier: 'analyst' });
    signal = options.signal as AbortSignal;
    return new Promise<Response>(resolve => { resolveDetail = resolve; });
  });
  let pending: Promise<void> = Promise.resolve();
  act(() => { pending = hook.result.current.capture(analystScope); });
  await waitFor(() => expect(signal).toBeDefined());
  vi.stubGlobal('indexedDB', factory);
  await act(async () => { await hook.result.current.retryStorage(); });
  expect(hook.result.current.busy).toBe(true); expect(signal!.aborted).toBe(false);
  await act(async () => { resolveDetail(Response.json(detailBody())); await pending; });
  expect(hook.result.current.unsaved).not.toBeNull(); expect((await stored()).packets).toEqual([]);
  expect(hook.result.current.error).toContain('started before local saving recovered');
  await act(async () => { await hook.result.current.saveUnsaved(); });
  expect((await stored()).packets).toHaveLength(1);
});

it('offers non-destructive UI retries and migrates legacy storage once it becomes available', async () => {
  const factory = indexedDB;
  saveStore(localStorage, { ...emptyStore('owner'), packets: [fixturePacket()], notes: { [analystId()]: 'private legacy note' } });
  vi.stubGlobal('indexedDB', undefined);
  function Harness() {
    const w = useAnalystWorkspace('owner', 'analyst', true);
    return <><button onClick={() => w.setOpen(true)}>Open</button><AnalystWorkspace workspace={w} scope={analystScope} currentItem={analystEvent()} signedIn /></>;
  }
  render(<Harness />); fireEvent.click(screen.getByRole('button', { name: 'Open' }));
  await screen.findByRole('button', { name: 'Retry local saving' });
  fireEvent.click(screen.getByRole('button', { name: 'Toggle active event in evidence selection' }));
  fireEvent.click(screen.getByRole('button', { name: 'Capture selected events' }));
  await screen.findByRole('button', { name: 'Discard unsaved packet' });
  // Failed retries retain the packet and never fall back to a whole-envelope write.
  fireEvent.click(screen.getByRole('button', { name: 'Retry local saving' }));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('IndexedDB'));
  expect(screen.getByRole('button', { name: 'Discard unsaved packet' })).toBeTruthy();
  vi.stubGlobal('indexedDB', factory);
  fireEvent.click(screen.getByRole('button', { name: 'Retry saving packet' }));
  await waitFor(async () => expect((await stored()).packets).toHaveLength(2));
  expect(screen.queryByRole('button', { name: 'Discard unsaved packet' })).toBeNull();
  expect(screen.getByRole('heading', { name: 'Selection 1/20' })).toBeTruthy();
  expect(localStorage.getItem(storageKey('owner'))).toBeNull();
  expect((await stored()).notes[analystId()]).toBe('private legacy note');
  expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false);
});

it('rechecks access on storage retry and clears retained work when access is revoked', async () => {
  vi.stubGlobal('indexedDB', undefined);
  const hook = await boot(); act(() => hook.result.current.toggle(analystEvent()));
  await act(async () => { await hook.result.current.capture(analystScope); });
  expect(hook.result.current.unsaved).not.toBeNull(); status = 403;
  await act(async () => { await hook.result.current.saveUnsaved(); });
  expect(hook.result.current.allowed).toBe(false); expect(hook.result.current.unsaved).toBeNull();
  expect(hook.result.current.selections).toEqual([]);
});

it('initializes a fresh generation after an externally deleted database envelope without reviving stale work', async () => {
  const hook = await boot(); const previousGeneration = hook.result.current.resetId!;
  act(() => hook.result.current.toggle(analystEvent()));
  await act(async () => { await hook.result.current.capture(analystScope); });
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onsuccess = () => {
      const db = request.result; const tx = db.transaction('workspaces', 'readwrite');
      tx.objectStore('workspaces').delete(storageKey('owner'));
      tx.oncomplete = () => { db.close(); resolve(); }; tx.onabort = () => reject(tx.error);
    };
    request.onerror = () => reject(request.error);
  });
  act(() => window.dispatchEvent(new CustomEvent(CHANGE_KEY, { detail: storageKey('owner') })));
  await waitFor(() => expect(hook.result.current.selections).toEqual([]));
  expect(hook.result.current.storageUnavailable).toBe(true); expect(hook.result.current.packets).toEqual([]);
  await act(async () => { await hook.result.current.retryStorage(); });
  expect(hook.result.current.storageUnavailable).toBe(false); expect(hook.result.current.resetId).not.toBe(previousGeneration);
  await expect(mutateStore(indexedDB, 'owner', previousGeneration, { type: 'add-packet', packet: fixturePacket() }, new AbortController().signal)).rejects.toThrow('workspace was reset');
  expect((await stored()).packets).toEqual([]);
  act(() => hook.result.current.toggle(analystEvent()));
  await act(async () => { await hook.result.current.capture(analystScope); });
  expect((await stored()).packets).toHaveLength(1);
});
