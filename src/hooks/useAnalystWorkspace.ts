'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { hasFeature, type UserTier } from '@/lib/entitlements';
import type { NewsItem } from '@/lib/core/types';
import { toggleSelection } from '@/lib/analyst/selection';
import { emptyStore, loadStore, WorkspaceResetError, type StoreMutation } from '@/lib/analyst/storage';
import { mutateStore, openStore, readStore, resetStore, subscribeStore } from '@/lib/analyst/database';
import { captureEvidence, checkEvidenceAccess, EvidenceAccessError } from '@/lib/analyst/capture';
import { exportCopy, serializeBrief, serializeCsv, serializeJson } from '@/lib/analyst/serializers';
import { MAX_NOTE_LENGTH, type AnalystStore, type AnalystSelection, type EvidencePacket, type EvidenceScope } from '@/lib/analyst/types';

interface WorkspaceState {
  key: string;
  authorized: boolean;
  writable: boolean;
  storageInitialized: boolean;
  store: AnalystStore;
  selections: AnalystSelection[];
  busy: boolean;
  progress: number;
  error: string | null;
  unsaved: EvidencePacket | null;
}
export function useAnalystWorkspace(ownerId: string | null, tier: UserTier, ready: boolean) {
  const allowed = Boolean(ownerId && ready && hasFeature(tier, 'evidenceExport'));
  const key = `${ownerId ?? ''}:${tier}:${ready}`;
  const [state, setState] = useState<WorkspaceState>(() => ({ key: '', authorized: false, writable: true, storageInitialized: false, store: emptyStore(''), selections: [], busy: false, progress: 0, error: null, unsaved: null }));
  const [accessVersion, setAccessVersion] = useState(0);
  const [deniedKey, setDeniedKey] = useState<string | null>(null);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const current = useRef({ key, ownerId, allowed });
  useEffect(() => { current.current = { key, ownerId, allowed }; }, [key, ownerId, allowed]);
  const active = useRef<AbortController | null>(null);
  const writes = useRef(new AbortController());
  const drafts = useRef(new Map<string, { note: string; token: symbol }>());
  const stateRef = useRef(state);
  // Event and async updates share an immediate snapshot, including queued note edits.
  const update = useCallback((fn: (previous: WorkspaceState) => WorkspaceState) => {
    const next = fn(stateRef.current);
    stateRef.current = next;
    setState(next);
  }, []);
  const withDrafts = useCallback((store: AnalystStore) => {
    const notes = { ...store.notes };
    for (const [id, draft] of drafts.current) {
      if (draft.note) notes[id] = draft.note; else delete notes[id];
    }
    return { ...store, notes };
  }, []);
  const valid = allowed && deniedKey !== key && state.key === key && state.authorized;
  const visible = valid ? state : { ...state, store: emptyStore(ownerId ?? ''), selections: [], unsaved: null, busy: false, progress: 0, error: null };

  const reconcile = useCallback(async () => {
    if (!current.current.ownerId || stateRef.current.key !== current.current.key) return;
    const owner = current.current.ownerId;
    const expectedKey = current.current.key;
    const signal = writes.current.signal;
    if (!stateRef.current.authorized || !current.current.allowed) return;
    try {
      const store = stateRef.current.storageInitialized
        ? await readStore(window.indexedDB, owner, signal)
        : await openStore(window.localStorage, window.indexedDB, owner, signal);
      signal.throwIfAborted();
      if (current.current.key !== expectedKey || !stateRef.current.authorized || !current.current.allowed) return;
      // The first observed generation attaches storage, rather than proving a reset.
      if (stateRef.current.storageInitialized && store.resetId !== stateRef.current.store.resetId) {
        active.current?.abort(); active.current = null;
        writes.current.abort(); writes.current = new AbortController(); drafts.current.clear();
        update(s => ({ ...s, store, storageInitialized: Boolean(store.resetId), writable: Boolean(store.resetId), selections: [], unsaved: null, busy: false, error: null }));
      } else {
        update(s => ({ ...s, store: withDrafts(store), storageInitialized: Boolean(store.resetId), writable: Boolean(store.resetId), error: s.writable ? s.error : null }));
      }
    } catch (e) {
      // A malformed ordinary update must not destroy the tab's completed work.
      if (current.current.key !== expectedKey || signal.aborted) return;
      update(s => ({ ...s, writable: false, error: e instanceof Error ? e.message : 'Could not read local storage.' }));
    }
  }, [update, withDrafts]);
  useEffect(() => {
    active.current?.abort(); active.current = null;
    writes.current.abort(); writes.current = new AbortController(); drafts.current.clear();
    const controller = new AbortController();
    const writeSignal = writes.current.signal;
    const reset: WorkspaceState = { key, authorized: false, writable: true, storageInitialized: false, store: emptyStore(ownerId ?? ''), selections: [], busy: false, progress: 0, error: null, unsaved: null };
    async function initialize() {
      let next = reset;
      if (allowed && ownerId) {
        try {
          await checkEvidenceAccess(ownerId, controller.signal);
          next = { ...next, authorized: true };
          try {
            next.store = await openStore(window.localStorage, window.indexedDB, ownerId, AbortSignal.any([controller.signal, writeSignal]));
            next.storageInitialized = true;
          }
          catch (e) {
            next = { ...next, writable: false, error: e instanceof Error ? e.message : 'Could not read local storage.' };
            // Unavailable IndexedDB may still read validated legacy packets for export.
            try { next.store = loadStore(window.localStorage, ownerId); } catch { /* Keep invalid data untouched. */ }
          }
        } catch (e) {
          if (!controller.signal.aborted) next.error = e instanceof Error ? e.message : 'Could not verify access.';
        }
      }
      if (!controller.signal.aborted) update(() => next);
    }
    void initialize();
    const onFocus = () => {
      if (!allowed || !ownerId) return;
      void checkEvidenceAccess(ownerId, controller.signal).then(() => { void reconcile(); }).catch(e => {
        if (controller.signal.aborted) return;
        active.current?.abort(); active.current = null; writes.current.abort(); drafts.current.clear();
        update(s => ({ ...s, authorized: false, store: emptyStore(ownerId), selections: [], unsaved: null, busy: false, error: e instanceof Error ? e.message : 'Could not recheck access.' }));
      });
    };
    window.addEventListener('focus', onFocus);
    return () => { controller.abort(); writes.current.abort(); active.current?.abort(); active.current = null; window.removeEventListener('focus', onFocus); };
  }, [key, ownerId, allowed, accessVersion, update, reconcile]);

  useEffect(() => {
    if (!ownerId) return;
    return subscribeStore(ownerId, () => { void reconcile(); });
  }, [ownerId, reconcile]);

  const guard = useCallback((expectedKey: string, signal?: AbortSignal) => {
    if (current.current.key !== expectedKey || !current.current.allowed || !current.current.ownerId || !stateRef.current.authorized || signal?.aborted) throw new DOMException('Workspace changed or canceled.', 'AbortError');
  }, []);
  const fail = useCallback((error: unknown, expectedKey: string) => {
    if (current.current.key !== expectedKey) return;
    if (error instanceof EvidenceAccessError) {
      setDeniedKey(expectedKey); setOpenKey(null); writes.current.abort(); drafts.current.clear();
      update(s => ({ ...s, authorized: false, store: emptyStore(current.current.ownerId ?? ''), selections: [], unsaved: null, busy: false, error: error.message }));
    } else if (error instanceof WorkspaceResetError) {
      void reconcile();
    } else if (!(error instanceof DOMException && error.name === 'AbortError')) {
      update(s => ({ ...s, error: error instanceof Error ? error.message : 'Evidence operation failed.' }));
    }
  }, [update, reconcile]);
  const toggle = useCallback((item: NewsItem) => {
    if (!valid || stateRef.current.busy) return;
    try {
      guard(key);
      update(s => {
        try { return { ...s, selections: toggleSelection(s.selections, item), error: null }; }
        catch (e) { return { ...s, error: e instanceof Error ? e.message : 'Could not select this event.' }; }
      });
    } catch (e) { fail(e, key); }
  }, [valid, guard, key, fail, update]);
  const retryStorage = async () => {
    if (!valid || !ownerId) return;
    const signal = writes.current.signal;
    try {
      await checkEvidenceAccess(ownerId, signal); guard(key, signal);
      await reconcile();
    } catch (e) { fail(e, key); }
  };
  const persist = useCallback(async (mutation: StoreMutation, resetId: string | undefined, operationSignal?: AbortSignal) => {
    guard(key);
    if (!stateRef.current.writable) throw new Error('Safe saving is unavailable. Retry local saving after browser storage recovers; completed captures can still be downloaded.');
    if (!resetId) throw new Error('This capture started before local saving recovered. Retry saving the packet to confirm saving it in the current workspace.');
    const signal = operationSignal ? AbortSignal.any([writes.current.signal, operationSignal]) : writes.current.signal;
    const saved = await mutateStore(window.indexedDB, ownerId!, resetId, mutation, signal, () => guard(key, signal));
    guard(key, signal);
    return saved;
  }, [key, ownerId, guard]);
  const capture = useCallback(async (scope: EvidenceScope) => {
    if (!valid || active.current || stateRef.current.busy || !ownerId || stateRef.current.unsaved) return;
    const resetId = stateRef.current.storageInitialized ? stateRef.current.store.resetId : undefined;
    const controller = new AbortController(); active.current = controller;
    update(s => ({ ...s, busy: true, progress: 0, error: null }));
    try {
      const packet = await captureEvidence({ ownerId, selections: stateRef.current.selections, scope, signal: controller.signal,
        onProgress: progress => { if (current.current.key === key && !controller.signal.aborted) update(s => ({ ...s, progress })); } });
      guard(key, controller.signal);
      update(s => ({ ...s, unsaved: packet }));
      const saved = await persist({ type: 'add-packet', packet }, resetId, controller.signal);
      update(s => ({ ...s, store: withDrafts(saved), unsaved: null }));
    } catch (e) { fail(e, key); }
    finally {
      controller.abort();
      if (active.current === controller) { active.current = null; if (current.current.key === key) update(s => ({ ...s, busy: false })); }
    }
  }, [valid, key, ownerId, guard, persist, fail, update, withDrafts]);
  const cancel = () => { active.current?.abort(); active.current = null; update(s => ({ ...s, busy: false })); };
  const deleteLocalData = async () => {
    active.current?.abort(); active.current = null;
    writes.current.abort(); writes.current = new AbortController(); drafts.current.clear();
    if (!ownerId) return;
    const signal = writes.current.signal;
    update(s => ({ ...s, busy: true }));
    try {
      const store = await resetStore(window.localStorage, window.indexedDB, ownerId, signal, () => {
        if (current.current.key !== key || signal.aborted) throw new DOMException('Account changed.', 'AbortError');
      });
      if (current.current.key === key && !signal.aborted) update(s => ({ ...s, store, storageInitialized: true, writable: true, selections: [], unsaved: null, error: null, busy: false }));
    } catch (e) { if (current.current.key === key) update(s => ({ ...s, busy: false, error: e instanceof Error ? e.message : 'Could not delete browser data.' })); }
  };
  const setNote = async (id: string, note: string) => {
    if (!valid || stateRef.current.busy) return;
    const previous = stateRef.current.store.notes[id] ?? '';
    const token = Symbol();
    try {
      if (note.length > MAX_NOTE_LENGTH) throw new Error(`Notes are limited to ${MAX_NOTE_LENGTH} characters.`);
      drafts.current.set(id, { note, token });
      update(s => ({ ...s, store: withDrafts(s.store) }));
      const saved = await persist({ type: 'set-note', id, note, previous }, stateRef.current.store.resetId);
      if (drafts.current.get(id)?.token === token) drafts.current.delete(id);
      update(s => ({ ...s, store: withDrafts(saved) }));
    } catch (e) {
      if (current.current.key !== key) return;
      if (drafts.current.get(id)?.token === token) drafts.current.delete(id);
      await reconcile(); fail(e, key);
    }
  };
  const deletePacket = async (id: string) => {
    if (!valid || stateRef.current.busy) return;
    try { const saved = await persist({ type: 'delete-packet', id }, stateRef.current.store.resetId); update(s => ({ ...s, store: withDrafts(saved) })); }
    catch (e) { fail(e, key); }
  };
  const saveUnsaved = async () => {
    if (!valid || active.current || stateRef.current.busy || !stateRef.current.unsaved) return;
    const packet = stateRef.current.unsaved;
    const controller = new AbortController(); active.current = controller;
    update(s => ({ ...s, busy: true }));
    try {
      if (!stateRef.current.writable) await retryStorage();
      guard(key, controller.signal);
      if (stateRef.current.unsaved !== packet) return;
      const saved = await persist({ type: 'add-packet', packet }, stateRef.current.store.resetId, controller.signal);
      update(s => ({ ...s, store: withDrafts(saved), unsaved: null, error: null }));
    }
    catch (e) { fail(e, key); }
    finally { if (active.current === controller) { active.current = null; if (current.current.key === key) update(s => ({ ...s, busy: false })); } }
  };
  const exportPacket = async (packet: EvidencePacket, format: 'json' | 'csv' | 'html', includeNotes: boolean): Promise<string | null> => {
    if (!valid || active.current || stateRef.current.busy || !ownerId) return null;
    const controller = new AbortController(); active.current = controller;
    update(s => ({ ...s, busy: true, error: null }));
    try {
      const copy = exportCopy(packet, stateRef.current.store.notes, includeNotes);
      await checkEvidenceAccess(ownerId, controller.signal); guard(key, controller.signal);
      return format === 'json' ? serializeJson(copy) : format === 'csv' ? serializeCsv(copy) : serializeBrief(copy);
    } catch (e) { fail(e, key); return null; }
    finally { if (active.current === controller) { active.current = null; if (current.current.key === key) update(s => ({ ...s, busy: false })); } }
  };
  return {
    allowed: valid, open: openKey === key, setOpen: (open: boolean) => setOpenKey(open ? key : null),
    resetId: valid ? visible.store.resetId : null,
    storageUnavailable: valid && !visible.writable, retryStorage,
    selections: visible.selections, packets: visible.store.packets, notes: visible.store.notes,
    busy: visible.busy, progress: visible.progress, error: state.key === key ? state.error : null, unsaved: visible.unsaved,
    toggle, capture, cancel, setNote, deletePacket, deleteLocalData, saveUnsaved, exportPacket,
    discardUnsaved: () => { if (valid && !visible.busy) update(s => ({ ...s, unsaved: null })); },
    clearSelection: () => { if (!visible.busy) update(s => ({ ...s, selections: [] })); },
    removeSelection: (id: string) => { if (!visible.busy) update(s => ({ ...s, selections: s.selections.filter(e => e.id !== id) })); },
    retryAccess: () => { setDeniedKey(null); setAccessVersion(v => v + 1); setOpenKey(key); },
  };
}
export type AnalystWorkspace = ReturnType<typeof useAnalystWorkspace>;
