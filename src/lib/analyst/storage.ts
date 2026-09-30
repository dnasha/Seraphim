import { MAX_STORAGE_BYTES, type AnalystStore } from './types';
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
