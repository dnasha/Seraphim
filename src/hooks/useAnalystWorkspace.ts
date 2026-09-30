'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { hasFeature, type UserTier } from '@/lib/entitlements';
import type { NewsItem } from '@/lib/core/types';
import { toggleSelection } from '@/lib/analyst/selection';
import { emptyStore, loadStore, saveStore, storageKey } from '@/lib/analyst/storage';
import { captureEvidence, checkEvidenceAccess, EvidenceAccessError } from '@/lib/analyst/capture';
import { exportCopy, serializeBrief, serializeCsv, serializeJson } from '@/lib/analyst/serializers';
import { MAX_PACKETS, MAX_NOTE_LENGTH, type AnalystStore, type AnalystSelection, type EvidencePacket, type EvidenceScope } from '@/lib/analyst/types';

interface WorkspaceState {
  key: string;
  authorized: boolean;
  writable: boolean;
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
  const [state, setState] = useState<WorkspaceState>(() => ({ key: '', authorized: false, writable: true, store: emptyStore(''), selections: [], busy: false, progress: 0, error: null, unsaved: null }));
  const [accessVersion, setAccessVersion] = useState(0);
  const [deniedKey, setDeniedKey] = useState<string | null>(null);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const current = useRef({ key, ownerId, allowed });
  // Use only for event/async guards, never render private state through this ref.
  useEffect(() => { current.current = { key, ownerId, allowed }; }, [key, ownerId, allowed]);
  const active = useRef<AbortController | null>(null);
  const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; }, [state]);
  const valid = allowed && deniedKey !== key && state.key === key && state.authorized;
  const visible = valid ? state : { ...state, store: emptyStore(ownerId ?? ''), selections: [], unsaved: null, busy: false, progress: 0, error: null };

  useEffect(() => {
    active.current?.abort();
    active.current = null;
    const controller = new AbortController();
    const reset: WorkspaceState = { key, authorized: false, writable: true, store: emptyStore(ownerId ?? ''), selections: [], busy: false, progress: 0, error: null, unsaved: null };
    async function initialize() {
      let next = reset;
      if (allowed && ownerId) {
        try {
          await checkEvidenceAccess(ownerId, controller.signal);
          next = { ...next, authorized: true };
          try { next.store = loadStore(window.localStorage, ownerId); }
          catch (e) { next = { ...next, writable: false, error: e instanceof Error ? e.message : 'Could not read local storage.' }; }
        } catch (e) {
          if (!controller.signal.aborted) next.error = e instanceof Error ? e.message : 'Could not verify access.';
        }
      }
      if (!controller.signal.aborted) setState(next);
    }
    void initialize();
    const onFocus = () => {
      if (!allowed || !ownerId) return;
      void checkEvidenceAccess(ownerId, controller.signal).catch(e => {
        if (controller.signal.aborted) return;
        active.current?.abort();
        active.current = null;
        setState(s => ({ ...s, authorized: false, store: emptyStore(ownerId), selections: [], unsaved: null, busy: false, error: e instanceof Error ? e.message : 'Could not recheck access.' }));
      });
    };
    window.addEventListener('focus', onFocus);
    return () => { controller.abort(); active.current?.abort(); active.current = null; window.removeEventListener('focus', onFocus); };
  }, [key, ownerId, allowed, accessVersion]);

  useEffect(() => {
    if (!ownerId) return;
    const changed = (event: StorageEvent) => {
      if (event.key !== null && event.key !== storageKey(ownerId)) return;
      active.current?.abort();
      active.current = null;
      try {
        const store = stateRef.current.authorized && allowed ? loadStore(window.localStorage, ownerId) : emptyStore(ownerId);
        setState(s => ({ ...s, store, writable: true, selections: [], unsaved: null, busy: false, error: null }));
      } catch (e) {
        setState(s => ({ ...s, store: emptyStore(ownerId), writable: false, selections: [], unsaved: null, busy: false, error: String(e instanceof Error ? e.message : e) }));
      }
    };
    window.addEventListener('storage', changed);
    return () => window.removeEventListener('storage', changed);
  }, [ownerId, allowed]);

  const guard = useCallback((expectedKey: string, signal?: AbortSignal) => {
    if (current.current.key !== expectedKey || !current.current.allowed || !current.current.ownerId || signal?.aborted) throw new DOMException('Workspace changed or canceled.', 'AbortError');
  }, []);
  const fail = useCallback((error: unknown, expectedKey: string) => {
    if (current.current.key !== expectedKey) return;
    if (error instanceof EvidenceAccessError) {
      setDeniedKey(expectedKey);
      setOpenKey(null);
      setState(s => ({ ...s, authorized: false, store: emptyStore(current.current.ownerId ?? ''), selections: [], unsaved: null, busy: false, error: error.message }));
    } else if (!(error instanceof DOMException && error.name === 'AbortError')) {
      setState(s => ({ ...s, error: error instanceof Error ? error.message : 'Evidence operation failed.' }));
    }
  }, []);
  const toggle = useCallback((item: NewsItem) => {
    if (!valid || stateRef.current.busy) return;
    try {
      guard(key);
      setState(s => {
        try { return { ...s, selections: toggleSelection(s.selections, item), error: null }; }
        catch (e) { return { ...s, error: e instanceof Error ? e.message : 'Could not select this event.' }; }
      });
    }
    catch (e) { fail(e, key); }
  }, [valid, guard, key, fail]);
  const persist = useCallback((store: AnalystStore) => {
    guard(key);
    if (!stateRef.current.writable) throw new Error('Delete invalid local workspace data before saving new data.');
    const saved = saveStore(window.localStorage, store);
    setState(s => ({ ...s, store: saved, error: null }));
  }, [key, guard]);
  const capture = useCallback(async (scope: EvidenceScope) => {
    if (!valid || active.current || !ownerId || stateRef.current.unsaved) return;
    const controller = new AbortController();
    active.current = controller;
    setState(s => ({ ...s, busy: true, progress: 0, error: null }));
    try {
      const packet = await captureEvidence({ ownerId, selections: stateRef.current.selections, scope, signal: controller.signal,
        onProgress: progress => { if (current.current.key === key) setState(s => ({ ...s, progress })); } });
      guard(key, controller.signal);
      const store = stateRef.current.store;
      // Keep a completed packet available for export even if the local quota is full.
      setState(s => ({ ...s, unsaved: packet }));
      if (store.packets.length >= MAX_PACKETS) throw new Error(`Packet captured but not saved: delete a saved packet to make room (limit ${MAX_PACKETS}).`);
      persist({ ...store, packets: [packet, ...store.packets] });
      setState(s => ({ ...s, unsaved: null }));
    } catch (e) { fail(e, key); }
    finally {
      controller.abort();
      if (active.current === controller) {
        active.current = null;
        if (current.current.key === key) setState(s => ({ ...s, busy: false }));
      }
    }
  }, [valid, key, ownerId, guard, persist, fail]);
  const cancel = () => { active.current?.abort(); active.current = null; setState(s => ({ ...s, busy: false })); };
  const deleteLocalData = () => {
    active.current?.abort();
    active.current = null;
    if (!ownerId) return;
    try {
      window.localStorage.removeItem(storageKey(ownerId));
      setState(s => ({ ...s, store: emptyStore(ownerId), writable: true, selections: [], unsaved: null, error: null, busy: false }));
    } catch { setState(s => ({ ...s, error: 'Could not delete browser data. Check browser storage permissions.' })); }
  };
  const setNote = (id: string, note: string) => {
    if (!valid || visible.busy) return;
    try {
      if (note.length > MAX_NOTE_LENGTH) throw new Error(`Notes are limited to ${MAX_NOTE_LENGTH} characters.`);
      const store = stateRef.current.store;
      const notes = { ...store.notes };
      if (note) notes[id] = note; else delete notes[id];
      persist({ ...store, notes });
    } catch (e) { fail(e, key); }
  };
  const deletePacket = (id: string) => {
    if (!valid || visible.busy) return;
    try { persist({ ...stateRef.current.store, packets: stateRef.current.store.packets.filter(p => p.id !== id) }); }
    catch (e) { fail(e, key); }
  };
  const saveUnsaved = () => {
    if (!valid || !stateRef.current.unsaved) return;
    try { persist({ ...stateRef.current.store, packets: [stateRef.current.unsaved, ...stateRef.current.store.packets] }); setState(s => ({ ...s, unsaved: null })); }
    catch (e) { fail(e, key); }
  };
  const exportPacket = async (packet: EvidencePacket, format: 'json' | 'csv' | 'html', includeNotes: boolean): Promise<string | null> => {
    if (!valid || active.current || !ownerId) return null;
    const controller = new AbortController();
    active.current = controller;
    const copy = exportCopy(packet, stateRef.current.store.notes, includeNotes);
    setState(s => ({ ...s, busy: true, error: null }));
    try {
      await checkEvidenceAccess(ownerId, controller.signal);
      guard(key, controller.signal);
      return format === 'json' ? serializeJson(copy) : format === 'csv' ? serializeCsv(copy) : serializeBrief(copy);
    } catch (e) { fail(e, key); return null; }
    finally {
      if (active.current === controller) {
        active.current = null;
        if (current.current.key === key) setState(s => ({ ...s, busy: false }));
      }
    }
  };
  return {
    allowed: valid, open: openKey === key, setOpen: (open: boolean) => setOpenKey(open ? key : null),
    selections: visible.selections, packets: visible.store.packets, notes: visible.store.notes,
    busy: visible.busy, progress: visible.progress, error: state.key === key ? state.error : null, unsaved: visible.unsaved,
    toggle, capture, cancel, setNote, deletePacket, deleteLocalData, saveUnsaved, exportPacket,
    discardUnsaved: () => { if (valid && !visible.busy) setState(s => ({ ...s, unsaved: null })); },
    clearSelection: () => { if (!visible.busy) setState(s => ({ ...s, selections: [] })); },
    removeSelection: (id: string) => { if (!visible.busy) setState(s => ({ ...s, selections: s.selections.filter(e => e.id !== id) })); },
    retryAccess: () => { setDeniedKey(null); setAccessVersion(v => v + 1); setOpenKey(key); },
  };
}
export type AnalystWorkspace = ReturnType<typeof useAnalystWorkspace>;
