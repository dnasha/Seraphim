'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BBox } from '@/lib/core/types';
import { browserDelivery } from './delivery';
import { createAlertSession, permissionMessage } from './session';
import { viewportRegion } from './region';
import { emptyStore, lockKey, MAX_WATCHES, readStore, storageKey, validScope, writeStore, type AlertStore, type WatchScope } from './store';

export function useBrowserAlerts(account: string | null) {
  const [store, setStore] = useState<AlertStore>(emptyStore);
  const [message, setMessage] = useState('Browser notifications are off.');
  const [busy, setBusy] = useState(false);
  const [storageReady, setStorageReady] = useState(false);
  const adapter = useMemo(() => browserDelivery(), []);
  const sessionRef = useRef<ReturnType<typeof createAlertSession> | null>(null);
  const generation = useRef(0);

  useEffect(() => {
    const token = ++generation.current;
    let session: ReturnType<typeof createAlertSession> | null = null;
    let permissionStatus: PermissionStatus | undefined;
    let storage: Storage | null = null;
    const active = () => generation.current === token && navigator.onLine && document.visibilityState === 'visible';
    const update = (next: AlertStore, text: string) => {
      if (generation.current !== token) return;
      setStore(next); setMessage(text);
    };
    const reload = () => {
      if (!account) { setStorageReady(false); update(emptyStore(), 'Sign in to save account-scoped watches on this device.'); return false; }
      try {
        // The getter itself can throw SecurityError when site storage is blocked.
        storage = null;
        storage = window.localStorage;
        setStorageReady(true); setStore(readStore(storage, account));
        return true;
      } catch {
        setStorageReady(storage !== null); setStore(emptyStore());
        setMessage(storage ? 'Local alert data cannot be read. Delete local watches to recover.' : 'Local alert storage is unavailable. Allow site storage in browser settings, then reload.');
        return false;
      }
    };
    const onState = () => {
      if (!active()) {
        session?.cancel();
        setMessage(navigator.onLine ? 'Checks paused while hidden. They resume when visible; alerts may be delayed.' : 'Offline: checks paused. They resume after reconnecting; alerts may be delayed.');
      } else { reload(); void session?.tick(); }
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || (account && event.key === storageKey(account))) {
        session?.cancel(); reload(); void session?.tick();
      }
    };
    const readable = reload();
    if (readable) void adapter.inspect().then(state => {
      if (generation.current === token && account) setMessage(permissionMessage(state));
    });
    if (account && storage && navigator.locks) {
      session = createAlertSession(account, { storage, locks: navigator.locks, adapter, active, now: Date.now, update });
      sessionRef.current = session;
      void session.tick();
    }
    const timer = setInterval(() => { void session?.tick(); }, 30_000);
    document.addEventListener('visibilitychange', onState);
    window.addEventListener('online', onState);
    window.addEventListener('offline', onState);
    window.addEventListener('focus', onState);
    window.addEventListener('storage', onStorage);
    // Browsers vary in permission-query support; visibility/focus checks also detect revocation.
    if (navigator.permissions) void navigator.permissions.query({ name: 'notifications' }).then(status => {
      if (generation.current !== token) return;
      permissionStatus = status;
      status.addEventListener('change', onState);
    }).catch(() => {});
    return () => {
      generation.current = token + 1;
      session?.stop(); sessionRef.current = null;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onState);
      window.removeEventListener('online', onState);
      window.removeEventListener('offline', onState);
      window.removeEventListener('focus', onState);
      window.removeEventListener('storage', onStorage);
      permissionStatus?.removeEventListener('change', onState);
      void adapter.clear();
    };
  }, [account, adapter]);

  const mutate = useCallback(async (change: (store: AlertStore) => void, text: string) => {
    if (!account) return;
    const token = generation.current;
    sessionRef.current?.cancel(); setBusy(true);
    try {
      if (!navigator.locks) throw new Error('Web Locks are required to coordinate local watches across tabs.');
      await navigator.locks.request(lockKey(account), async () => {
        if (generation.current !== token) return;
        const next = readStore(localStorage, account);
        change(next); writeStore(localStorage, account, next);
        sessionRef.current?.recover();
        if (generation.current === token) { setStore(next); setMessage(text); }
      });
    } catch (error) {
      if (generation.current === token) setMessage(error instanceof Error ? error.message : 'Local alert storage failed.');
    } finally { if (generation.current === token) setBusy(false); }
    void sessionRef.current?.tick();
  }, [account]);

  const enable = async () => {
    if (!storageReady) { setMessage('Local alert storage is unavailable. Allow site storage in browser settings, then reload.'); return; }
    const token = generation.current;
    setBusy(true);
    const state = await adapter.requestPermission();
    if (token !== generation.current) return;
    setBusy(false); setMessage(permissionMessage(state));
    if (state === 'granted') await mutate(s => {
      if (!s.watches.length) throw new Error('Save a viewport watch before enabling.');
      s.enabled = true; s.failures = 0;
      s.watches = s.watches.map(w => w.enabled ? { ...w, checkpoint: null, state: 'baseline', failures: 0, nextCheckAt: 0 } : w);
    }, 'Enabled. The first complete check establishes a baseline; existing events will not alert.');
  };
  const save = (bbox: BBox | null, name: string, scope: WatchScope) => mutate(s => {
    if (s.watches.length >= MAX_WATCHES) throw new Error(`You can save up to ${MAX_WATCHES} watches.`);
    if (!bbox) throw new Error('Open the map and wait for its viewport before saving.');
    if (!validScope(scope)) throw new Error('Invalid saved filters.');
    s.watches.push({ region: viewportRegion(bbox, name, crypto.randomUUID(), Date.now()), scope,
      enabled: true, checkpoint: null, state: 'baseline', failures: 0, nextCheckAt: 0 });
    // Keep the shared nextCheckAt: adding a watch cannot increase scrape polling frequency.
  }, 'Watch saved on this device. The first complete check will establish its baseline.');
  const rename = (id: string, name: string) => mutate(s => {
    if (!name.trim() || name.length > 60) throw new Error('Use a name of 1–60 characters.');
    s.watches = s.watches.map(w => w.region.id === id ? { ...w, region: { ...w.region, name: name.trim() } } : w);
  }, 'Watch renamed. Alert checkpoints were kept.');
  const remove = (id: string) => mutate(s => {
    s.watches = s.watches.filter(w => w.region.id !== id);
    if (!s.watches.length) s.enabled = false;
  }, 'Watch deleted from this device.');
  const toggle = (id: string) => mutate(s => {
    s.watches = s.watches.map(w => w.region.id !== id ? w : { ...w, enabled: !w.enabled, checkpoint: null, state: w.enabled ? 'paused' : 'baseline', failures: 0, nextCheckAt: 0 });
  }, 'Watch changed. Resuming establishes a new baseline.');
  const pause = () => mutate(s => { s.enabled = false; }, 'Checks paused. Enable again to establish a fresh baseline.');
  const clear = async () => {
    if (!account) return;
    sessionRef.current?.cancel();
    const token = generation.current;
    try {
      if (!navigator.locks) throw new Error('Web Locks unavailable. Clear Seraphim site data in browser settings.');
      await navigator.locks.request(lockKey(account), () => {
        if (generation.current !== token) return;
        localStorage.removeItem(storageKey(account)); sessionRef.current?.recover(); setStore(emptyStore()); setMessage('Local watches and alert history deleted.');
      });
      if (generation.current === token) await adapter.clear();
    } catch { if (generation.current === token) setMessage('Deletion failed. Clear Seraphim site data in browser settings.'); }
  };
  return { store, message, busy, storageReady, enable, save, rename, remove, toggle, pause, clear };
}
