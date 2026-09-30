import type { BrowserDeliveryAdapter, DeliveryState } from './delivery';
import { advanceWatch, fetchWatch, IncompleteCheck, reserveBatch } from './checks';
import { lockKey, POLL_MS, readStore, storageKey, writeStore, type AlertStore } from './store';

export interface SessionEnvironment {
  storage: Storage;
  locks: Pick<LockManager, 'request'>;
  adapter: BrowserDeliveryAdapter;
  fetcher?: typeof fetch;
  active(): boolean;
  now(): number;
  update(store: AlertStore, message: string): void;
}
export const permissionMessage = (state: DeliveryState): string => ({
  granted: 'Ready. Checks run while Seraphim is open.',
  default: 'Browser notifications are off. Enable only when you want to grant permission.',
  denied: 'Notifications are blocked. Change browser site settings, then enable again.',
  unsupported: 'This browser needs Notifications, service workers and Web Locks. On iOS, use an installed app.',
  insecure: 'Notifications require a secure HTTPS connection.',
  'missing-registration': 'No active service worker. Reload the installed app or production site, then enable again.',
  failed: 'Browser notification access failed. Enable again to retry.',
})[state];

/** One session, with an account-scoped Web Lock held through read/check/reserve/delivery. */
export function createAlertSession(account: string, env: SessionEnvironment) {
  let stopped = false;
  let current: AbortController | null = null;
  const cancel = () => { current?.abort(); };
  const tick = async () => {
    if (stopped || current || !env.active()) return;
    const controller = new AbortController();
    current = controller;
    const deadline = setTimeout(() => controller.abort(), 45_000);
    try {
      await env.locks.request(lockKey(account), { signal: controller.signal }, async () => {
        const alive = () => !stopped && !controller.signal.aborted && env.active();
        if (!alive()) return;
        const store = readStore(env.storage, account);
        if (!store.enabled || !store.watches.some(w => w.enabled)) return;
        const permission = await env.adapter.inspect();
        if (!alive()) return;
        if (permission !== 'granted') {
          store.enabled = false;
          writeStore(env.storage, account, store);
          env.update(store, permissionMessage(permission));
          return;
        }
        const now = env.now();
        if (now < store.nextCheckAt) {
          env.update(store, `Next check after ${new Date(store.nextCheckAt).toLocaleTimeString()}. Checks may be delayed while hidden or offline.`);
          return;
        }
        store.nextCheckAt = now + POLL_MS;
        writeStore(env.storage, account, store);
        const reservation = env.storage.getItem(storageKey(account));
        const candidates: string[] = [];
        let failed = false;
        let incomplete = false;
        for (let i = 0; i < store.watches.length; i++) {
          const watch = store.watches[i];
          if (!watch.enabled) continue;
          try {
            const ids = await fetchWatch(watch, controller.signal, env.fetcher);
            if (!alive()) return;
            const advanced = advanceWatch(watch, ids, env.now());
            store.watches[i] = advanced.watch;
            candidates.push(...advanced.candidates);
          } catch (error) {
            if (!alive()) return;
            failed = true;
            const partial = error instanceof IncompleteCheck;
            incomplete ||= partial;
            store.watches[i] = { ...watch, state: partial ? 'incomplete' : 'error' };
          }
        }
        if (!alive() || env.storage.getItem(storageKey(account)) !== reservation) return;
        store.failures = failed ? Math.min(store.failures + 1, 6) : 0;
        store.nextCheckAt = env.now() + Math.min(POLL_MS * 2 ** store.failures, 30 * 60_000);
        const batch = reserveBatch(store, candidates, env.now());
        // Durable reservation before attempting delivery provides at-most-once attempts across tabs/reloads.
        writeStore(env.storage, account, store);
        if (batch.length && alive()) {
          try { await env.adapter.deliver({ ids: batch }, controller.signal); }
          catch {
            if (!alive()) return;
            store.enabled = false;
            writeStore(env.storage, account, store);
            env.update(store, 'Delivery failed. Checks paused; enable again to retry. Existing events will form a new baseline.');
            return;
          }
        }
        if (alive()) env.update(store, failed
          ? (incomplete ? 'Some watches are incomplete or stale; their checkpoints were kept. Narrow the region or filters. Retrying with backoff.' : 'Some checks failed or filters are unavailable. Retrying with backoff, up to 30 minutes.')
          : `Checked ${new Date(env.now()).toLocaleTimeString()}. Up to one generic notification every 5 minutes.`);
      });
    } catch {
      if (!stopped && !controller.signal.aborted) {
        stopped = true;
        env.update({ version: 1, enabled: false, watches: [], delivered: [], lastDeliveryAt: 0, nextCheckAt: 0, failures: 0 },
        'Local alert storage or tab coordination failed. Checks stopped. Delete local watches to recover.');
      }
    } finally {
      clearTimeout(deadline);
      current = null;
    }
  };
  return { tick, cancel, recover() { stopped = false; }, stop() { stopped = true; cancel(); } };
}
