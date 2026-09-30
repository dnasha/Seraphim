import { copyStore } from './schema';
import { applyStoreMutation, emptyStore, loadStore, storageKey, type LocalStorage, type StoreMutation } from './storage';
import { MAX_STORAGE_BYTES, type AnalystStore } from './types';

export const DATABASE_NAME = 'seraphim-experiment-analyst-evidence-v1';
export const CHANGE_KEY = 'seraphim:experiment:analyst-evidence:v1:changed';
const databases = new WeakMap<IDBFactory, Promise<IDBDatabase>>();
function database(factory: IDBFactory | undefined): Promise<IDBDatabase> {
  if (!factory) return Promise.reject(new Error('Local saving requires browser IndexedDB. Download captures instead, or enable browser storage.'));
  const cached = databases.get(factory); if (cached) return cached;
  const opening = new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => { request.result.createObjectStore('workspaces'); };
    request.onerror = () => reject(new Error('Could not open local evidence storage.'));
    request.onblocked = () => reject(new Error('Local storage is blocked by another tab. Close older evidence tabs and retry.'));
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => { db.close(); databases.delete(factory); };
      resolve(db);
    };
  });
  databases.set(factory, opening);
  void opening.catch(() => databases.delete(factory));
  return opening;
}
function boundedStore(value: unknown, ownerId: string): AnalystStore {
  const valid = copyStore(value, ownerId);
  if (JSON.stringify(valid).length * 2 > MAX_STORAGE_BYTES) throw new Error('Local storage limit reached (2 MB). Delete packets or notes to make room.');
  return valid;
}
/** Notifications contain only an account key; all content comes from the database. */
function notify(ownerId: string) {
  if (typeof window === 'undefined') return;
  const key = storageKey(ownerId);
  try { window.localStorage.setItem(CHANGE_KEY, JSON.stringify({ key, revision: crypto.randomUUID() })); } catch { /* Broadcast and focus reconciliation remain available. */ }
  if (typeof window.BroadcastChannel === 'function') {
    try { const channel = new window.BroadcastChannel(CHANGE_KEY); channel.postMessage(key); channel.close(); } catch { /* Storage events and focus reconciliation remain available. */ }
  }
  window.dispatchEvent(new CustomEvent(CHANGE_KEY, { detail: key }));
}
export function subscribeStore(ownerId: string, changed: () => void): () => void {
  const key = storageKey(ownerId);
  const local = (event: Event) => { if ((event as CustomEvent).detail === key) changed(); };
  const storage = (event: StorageEvent) => {
    if (event.storageArea && event.storageArea !== window.localStorage) return;
    if (event.key === null) { changed(); return; }
    if (event.key !== CHANGE_KEY || !event.newValue) return;
    try { if (JSON.parse(event.newValue).key === key) changed(); } catch { /* Ignore unrelated/tampered notification metadata. */ }
  };
  let channel: BroadcastChannel | null = null;
  try { if (typeof window.BroadcastChannel === 'function') channel = new window.BroadcastChannel(CHANGE_KEY); } catch { /* Storage events and focus reconciliation remain available. */ }
  if (channel) channel.onmessage = event => { if (event.data === key) changed(); };
  window.addEventListener(CHANGE_KEY, local); window.addEventListener('storage', storage);
  return () => { channel?.close(); window.removeEventListener(CHANGE_KEY, local); window.removeEventListener('storage', storage); };
}
async function transaction(factory: IDBFactory | undefined, ownerId: string, mode: IDBTransactionMode, signal: AbortSignal,
  action: (raw: unknown) => AnalystStore, guard: () => void = () => {}): Promise<AnalystStore> {
  const db = await database(factory); signal.throwIfAborted(); guard();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('workspaces', mode);
    const objectStore = tx.objectStore('workspaces');
    let result: AnalystStore;
    let failure: unknown;
    const abort = () => { failure = signal.reason; try { tx.abort(); } catch { /* Already completed. */ } };
    signal.addEventListener('abort', abort, { once: true });
    tx.onabort = () => { signal.removeEventListener('abort', abort); reject(failure ?? new Error('Could not save local evidence data.')); };
    tx.onerror = () => { failure ??= new Error('Local evidence storage is unavailable or full.'); };
    tx.oncomplete = () => {
      signal.removeEventListener('abort', abort);
      if (mode === 'readwrite') notify(ownerId);
      resolve(result);
    };
    const request = objectStore.get(storageKey(ownerId));
    request.onsuccess = () => {
      try {
        signal.throwIfAborted(); guard();
        result = boundedStore(action(request.result), ownerId);
        if (mode === 'readwrite') objectStore.put(result, storageKey(ownerId));
      } catch (error) { failure = error; tx.abort(); }
    };
  });
}
export function readStore(factory: IDBFactory | undefined, ownerId: string, signal = new AbortController().signal): Promise<AnalystStore> {
  return transaction(factory, ownerId, 'readonly', signal, raw => raw === undefined ? emptyStore(ownerId) : boundedStore(raw, ownerId));
}
/** Migrate legacy localStorage only when this account has no database envelope. */
export async function openStore(legacy: LocalStorage, factory: IDBFactory | undefined, ownerId: string, signal: AbortSignal): Promise<AnalystStore> {
  const store = await transaction(factory, ownerId, 'readwrite', signal, raw => {
    const previous = raw === undefined ? loadStore(legacy, ownerId) : boundedStore(raw, ownerId);
    return previous.resetId ? previous : { ...previous, resetId: crypto.randomUUID() };
  });
  legacy.removeItem(storageKey(ownerId));
  return store;
}
/** Native read/write transactions serialize fresh reads and writes across tabs. */
export function mutateStore(factory: IDBFactory | undefined, ownerId: string, resetId: string | undefined,
  mutation: StoreMutation, signal: AbortSignal, guard: () => void = () => {}): Promise<AnalystStore> {
  return transaction(factory, ownerId, 'readwrite', signal, raw => applyStoreMutation(raw === undefined ? emptyStore(ownerId) : boundedStore(raw, ownerId), resetId, mutation), guard);
}
/** Empty generation marker prevents work queued before deletion from restoring data. */
export async function resetStore(legacy: LocalStorage, factory: IDBFactory | undefined, ownerId: string, signal: AbortSignal, guard: () => void = () => {}): Promise<AnalystStore> {
  const store = await transaction(factory, ownerId, 'readwrite', signal, () => ({ ...emptyStore(ownerId), resetId: crypto.randomUUID() }), guard);
  legacy.removeItem(storageKey(ownerId));
  return store;
}
