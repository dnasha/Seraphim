import { MAX_PACKETS, MAX_STORAGE_BYTES, type AnalystStore, type EvidencePacket } from './types';
import { copyStore } from './schema';

export const storageKey = (ownerId: string) => `seraphim:experiment:analyst-evidence:v1:${encodeURIComponent(ownerId)}`;
export const emptyStore = (ownerId: string): AnalystStore => ({ version: 1, ownerId, packets: [], notes: {} });
export type LocalStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export function loadStore(storage: LocalStorage, ownerId: string): AnalystStore {
  const value = storage.getItem(storageKey(ownerId));
  if (value === null) return emptyStore(ownerId);
  if (value.length * 2 > MAX_STORAGE_BYTES) throw new Error('Local workspace exceeds its size limit. Delete local data to reset it.');
  try { return copyStore(JSON.parse(value), ownerId); }
  catch { throw new Error('Local workspace is invalid or from an unsupported version. Delete local data to reset it.'); }
}
export function saveStore(storage: LocalStorage, store: AnalystStore): AnalystStore {
  const valid = copyStore(store, store.ownerId);
  const value = JSON.stringify(valid);
  if (value.length * 2 > MAX_STORAGE_BYTES) throw new Error('Local storage limit reached (2 MB). Delete packets or notes to make room.');
  try { storage.setItem(storageKey(store.ownerId), value); }
  catch { throw new Error('Could not save locally. Browser storage is unavailable or full. Download the packet or delete local data.'); }
  return valid;
}

export class WorkspaceResetError extends Error {}
export type StoreMutation =
  | { type: 'add-packet'; packet: EvidencePacket }
  | { type: 'delete-packet'; id: string }
  | { type: 'set-note'; id: string; note: string; previous: string };

/** Apply a bounded intent within an IndexedDB read/write transaction. */
export function applyStoreMutation(store: AnalystStore, resetId: string | undefined, mutation: StoreMutation): AnalystStore {
  if (!resetId || store.resetId !== resetId) throw new WorkspaceResetError('The local workspace was reset. Pending changes were not saved.');
  if (mutation.type === 'add-packet') {
    if (store.packets.some(p => p.id === mutation.packet.id)) throw new Error('This packet is already saved.');
    if (store.packets.length >= MAX_PACKETS) throw new Error(`Packet captured but not saved: delete a saved packet to make room (limit ${MAX_PACKETS}).`);
    return { ...store, packets: [mutation.packet, ...store.packets] };
  }
  if (mutation.type === 'delete-packet') return { ...store, packets: store.packets.filter(p => p.id !== mutation.id) };
  if ((store.notes[mutation.id] ?? '') !== mutation.previous) throw new Error('This note changed in another tab. Your edit was not saved; review the current note and try again.');
  const notes = { ...store.notes };
  if (mutation.note) notes[mutation.id] = mutation.note; else delete notes[mutation.id];
  return { ...store, notes };
}
