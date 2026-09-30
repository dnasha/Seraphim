// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useAnalystWorkspace } from '@/hooks/useAnalystWorkspace';
import AnalystWorkspace, { EvidenceSelectionControl } from '@/components/analyst/AnalystWorkspace';
import { saveStore, storageKey, emptyStore } from '@/lib/analyst/storage';
import { analystEvent, analystId, analystScope, detailBody, fixturePacket } from './fixtures/analyst';
import type { UserTier } from '@/lib/entitlements';

let account = 'owner';
let status = 200;
let fakeFetch: ReturnType<typeof vi.fn>;
beforeEach(() => {
  localStorage.clear(); account = 'owner'; status = 200;
  fakeFetch = vi.fn(async (input: string) => input.includes('/access') ? Response.json({ userId: account, tier: 'analyst' }, { status }) : Response.json(detailBody()));
  vi.stubGlobal('fetch', fakeFetch);
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const boot = async () => {
  const hook = renderHook(({ owner, tier, ready }) => useAnalystWorkspace(owner, tier, ready), { initialProps: { owner: 'owner' as string | null, tier: 'analyst' as UserTier, ready: true } });
  await waitFor(() => expect(hook.result.current.allowed).toBe(true));
  return hook;
};

it('keeps selection independent, persists notes locally, and never changes immutable captured data', async () => {
  const hook = await boot();
  act(() => hook.result.current.toggle(analystEvent()));
  act(() => hook.result.current.setNote(analystId(), 'private original note'));
  await act(async () => { await hook.result.current.capture(analystScope); });
  const packet = hook.result.current.packets[0];
  expect(packet.entries[0].event?.title).toBe('Fixture event 1');
  act(() => hook.result.current.setNote(analystId(), 'changed note'));
  let exported: string | null = null;
  await act(async () => { exported = await hook.result.current.exportPacket(packet, 'json', false); });
  expect(exported).not.toContain('changed note');
  await act(async () => { exported = await hook.result.current.exportPacket(packet, 'json', true); });
  expect(exported).toContain('changed note');
  expect(packet).not.toHaveProperty('privateNotes');
  expect(JSON.parse(localStorage.getItem(storageKey('owner'))!).notes[analystId()]).toBe('changed note');
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
  expect(hook.result.current.packets).toEqual([]); expect(localStorage.getItem(storageKey('other'))).toBeNull();
  expect(localStorage.getItem(storageKey('owner'))).toContain('owner-only secret');
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
it('responds to cross-tab deletion and supports deleting local data after a downgrade', async () => {
  saveStore(localStorage, { ...emptyStore('owner'), packets: [fixturePacket()], notes: { [analystId()]: 'private' } });
  const hook = await boot();
  localStorage.removeItem(storageKey('owner'));
  act(() => window.dispatchEvent(new StorageEvent('storage', { key: storageKey('owner'), newValue: null })));
  expect(hook.result.current.packets).toEqual([]); expect(hook.result.current.notes).toEqual({});
  saveStore(localStorage, { ...emptyStore('owner'), packets: [fixturePacket()] });
  hook.rerender({ owner: 'owner', tier: 'free', ready: true });
  act(() => hook.result.current.deleteLocalData());
  expect(localStorage.getItem(storageKey('owner'))).toBeNull();
});
it('retains a completed capture for export after a storage failure and prevents overwriting corrupt data', async () => {
  localStorage.setItem(storageKey('owner'), '{corrupt');
  const hook = await boot();
  expect(hook.result.current.error).toContain('invalid');
  act(() => hook.result.current.toggle(analystEvent()));
  await act(async () => { await hook.result.current.capture(analystScope); });
  expect(hook.result.current.unsaved?.entries[0].status).toBe('captured');
  expect(hook.result.current.error).toContain('Delete invalid');
  expect(localStorage.getItem(storageKey('owner'))).toBe('{corrupt');
  let text: string | null = null;
  await act(async () => { text = await hook.result.current.exportPacket(hook.result.current.unsaved!, 'json', false); });
  expect(text).toContain('Fixture event 1');
  act(() => hook.result.current.deleteLocalData());
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
  expect(screen.queryByRole('button', { name: 'Download JSON' })).toBeNull();
  expect(JSON.parse(localStorage.getItem(storageKey('owner'))!).notes[analystId()]).toBe('private inclusion text');
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
  act(() => hook.result.current.deletePacket(analystId(100)));
  act(() => hook.result.current.saveUnsaved());
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
