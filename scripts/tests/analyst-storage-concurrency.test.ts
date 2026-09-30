import { describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { mutateStore, openStore, readStore, resetStore } from '@/lib/analyst/database';
import { analystId, fixturePacket } from './fixtures/analyst';
import { emptyStore, saveStore, storageKey, WorkspaceResetError } from '@/lib/analyst/storage';

function setup() {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
  const db = new IDBFactory();
  const signal = new AbortController().signal;
  return { storage, db, signal };
}
describe('account-scoped IndexedDB transactions', () => {
  it('preserves concurrent packet, packet and unrelated note additions from stale tabs', async () => {
    const { storage, db, signal } = setup();
    const a = await openStore(storage, db, 'owner', signal);
    const b = await openStore(storage, db, 'owner', signal);
    await Promise.all([
      mutateStore(db, 'owner', a.resetId, { type: 'add-packet', packet: fixturePacket() }, signal),
      mutateStore(db, 'owner', b.resetId, { type: 'set-note', id: analystId(), previous: '', note: 'note A' }, signal),
      mutateStore(db, 'owner', b.resetId, { type: 'add-packet', packet: { ...fixturePacket(), id: analystId(101) } }, signal),
      mutateStore(db, 'owner', a.resetId, { type: 'set-note', id: analystId(2), previous: '', note: 'note B' }, signal),
    ]);
    const result = (await readStore(db, 'owner'));
    expect(result.packets.map(p => p.id).sort()).toEqual([analystId(100), analystId(101)]);
    expect(result.notes).toEqual({ [analystId()]: 'note A', [analystId(2)]: 'note B' });
    expect((await readStore(db, 'other'))).toEqual(emptyStore('other'));
  });
  it('rejects conflicting edits of the same note without overwriting the first edit', async () => {
    const { storage, db, signal } = setup(); const initial = await openStore(storage, db, 'owner', signal);
    const results = await Promise.allSettled(['A', 'B'].map(note => mutateStore(db, 'owner', initial.resetId, { type: 'set-note', id: analystId(), previous: '', note }, signal)));
    expect(results[0].status).toBe('fulfilled'); expect(results[1]).toMatchObject({ status: 'rejected', reason: expect.objectContaining({ message: expect.stringContaining('another tab') }) });
    expect((await readStore(db, 'owner')).notes[analystId()]).toBe('A');
  });
  it('does not resurrect a deleted packet when a stale tab saves a note', async () => {
    const { storage, db, signal } = setup();
    saveStore(storage, { ...emptyStore('owner'), packets: [fixturePacket()] });
    const old = await openStore(storage, db, 'owner', signal);
    await Promise.all([
      mutateStore(db, 'owner', old.resetId, { type: 'delete-packet', id: fixturePacket().id }, signal),
      mutateStore(db, 'owner', old.resetId, { type: 'set-note', id: analystId(), previous: '', note: 'retained' }, signal),
    ]);
    expect((await readStore(db, 'owner')).packets).toEqual([]);
    expect((await readStore(db, 'owner')).notes[analystId()]).toBe('retained');
  });
  it('rejects stale packet and note writes queued after reset, and permits deliberate new work', async () => {
    const { storage, db, signal } = setup(); const old = await openStore(storage, db, 'owner', signal);
    const reset = resetStore(storage, db, 'owner', signal);
    const stale = Promise.allSettled([
      mutateStore(db, 'owner', old.resetId, { type: 'add-packet', packet: fixturePacket() }, signal),
      mutateStore(db, 'owner', old.resetId, { type: 'set-note', id: analystId(), previous: '', note: 'old secret' }, signal),
    ]);
    const fresh = await reset;
    for (const result of await stale) expect(result).toMatchObject({ status: 'rejected', reason: expect.any(WorkspaceResetError) });
    expect((await readStore(db, 'owner'))).toEqual(fresh);
    await mutateStore(db, 'owner', fresh.resetId, { type: 'set-note', id: analystId(), previous: '', note: 'new deliberate note' }, signal);
    expect((await readStore(db, 'owner')).notes[analystId()]).toBe('new deliberate note');
  });
  it('enforces quotas against the latest store instead of evicting a competing save', async () => {
    const { storage, db, signal } = setup();
    saveStore(storage, { ...emptyStore('owner'), packets: Array.from({ length: 7 }, (_, i) => ({ ...fixturePacket(), id: analystId(100 + i) })) });
    const initial = await openStore(storage, db, 'owner', signal);
    const results = await Promise.allSettled([107, 108].map(i => mutateStore(db, 'owner', initial.resetId, { type: 'add-packet', packet: { ...fixturePacket(), id: analystId(i) } }, signal)));
    expect(results.map(r => r.status)).toEqual(['fulfilled', 'rejected']);
    expect((await readStore(db, 'owner')).packets).toHaveLength(8);
    expect(results[1]).toMatchObject({ reason: expect.objectContaining({ message: expect.stringContaining('not saved') }) });
  });
  it('fails closed without IndexedDB, on corrupt legacy data, or after cancellation before commit', async () => {
    const { storage, db, signal } = setup();
    await expect(openStore(storage, undefined, 'owner', signal)).rejects.toThrow('IndexedDB');
    storage.setItem(storageKey('owner'), '{corrupt');
    await expect(openStore(storage, db, 'owner', signal)).rejects.toThrow('invalid');
    expect(storage.getItem(storageKey('owner'))).toBe('{corrupt');
    const reset = await resetStore(storage, db, 'owner', signal);
    const controller = new AbortController();
    const pending = mutateStore(db, 'owner', reset.resetId, { type: 'add-packet', packet: fixturePacket() }, controller.signal, () => controller.abort());
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect((await readStore(db, 'owner')).packets).toEqual([]);
  });
});

it('migrates validated legacy data once and never imports stale legacy content after a reset', async () => {
  const { storage, db, signal } = setup();
  saveStore(storage, { ...emptyStore('owner'), packets: [fixturePacket()], notes: { [analystId()]: 'legacy private note' } });
  const migrated = await openStore(storage, db, 'owner', signal);
  expect(migrated.packets).toHaveLength(1); expect(migrated.notes[analystId()]).toBe('legacy private note');
  expect(storage.getItem(storageKey('owner'))).toBeNull();
  await resetStore(storage, db, 'owner', signal);
  saveStore(storage, { ...emptyStore('owner'), packets: [fixturePacket()], notes: { [analystId()]: 'stale legacy write' } });
  const reopened = await openStore(storage, db, 'owner', signal);
  expect(reopened.packets).toEqual([]); expect(reopened.notes).toEqual({});
  expect(storage.getItem(storageKey('owner'))).toBeNull();
});
it('rechecks account permission inside the transaction and leaves stored content unchanged when rejected', async () => {
  const { storage, db, signal } = setup(); const original = await openStore(storage, db, 'owner', signal);
  let checks = 0;
  await expect(mutateStore(db, 'owner', original.resetId, { type: 'add-packet', packet: fixturePacket() }, signal, () => { if (++checks === 2) throw new DOMException('Account changed.', 'AbortError'); })).rejects.toMatchObject({ name: 'AbortError' });
  expect(checks).toBe(2);
  expect(await readStore(db, 'owner')).toEqual(original);
});
