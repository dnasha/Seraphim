import type { BrowserDeliveryAdapter, DeliveryState } from './delivery';
import { advanceWatch, fetchWatch, IncompleteCheck, reserveBatch } from './checks';
import { emptyStore, lockKey, readStore, storageKey, writeStore, type AlertStore } from './store';
import { nextScrapeCheck, nextWatchCheck } from './schedule';

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

class CheckDeadline extends Error {}
// Bound even an adapter/fetch mock that ignores AbortSignal. Late results cannot
// change checkpoints: only the settled result is processed by the caller.
function abortable<T>(run: () => Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  let onAbort: (() => void) | undefined;
  return new Promise<T>((resolve, reject) => {
    onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    run().then(resolve, reject);
  }).finally(() => { if (onAbort) signal.removeEventListener('abort', onAbort); });
}

/** Account-scoped Web Lock covers read/check/reserve/delivery; cancellation is distinct from read timeout. */
export function createAlertSession(account: string, env: SessionEnvironment) {
  let stopped = false;
  let current: AbortController | null = null;
  const cancel = () => { current?.abort(); };
  const tick = async () => {
    if (stopped || current || !env.active()) return;
    const lifecycle = new AbortController();
    const reads = new AbortController();
    current = lifecycle;
    const cancelReads = () => reads.abort(lifecycle.signal.reason);
    lifecycle.signal.addEventListener('abort', cancelReads, { once: true });
    const deadline = setTimeout(() => reads.abort(new CheckDeadline('Read deadline exceeded')), 45_000);
    const alive = () => !stopped && !lifecycle.signal.aborted && env.active();
    let acquired = false;
    const failCoordination = () => {
      stopped = true;
      env.update(emptyStore(), 'Local alert storage or tab coordination failed. Checks stopped. Delete local watches to recover.');
    };
    try {
      await env.locks.request(lockKey(account), { signal: reads.signal }, async () => {
        acquired = true;
        if (!alive()) return;
        const store = readStore(env.storage, account);
        if (!store.enabled || !store.watches.some(w => w.enabled)) return;
        let permission: DeliveryState;
        try { permission = await abortable(() => env.adapter.inspect(), reads.signal); }
        catch { permission = 'failed'; }
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
        // Reserve the next scraper slot before starting any asynchronous reads.
        store.nextCheckAt = nextScrapeCheck(now);
        writeStore(env.storage, account, store);
        const reservation = env.storage.getItem(storageKey(account));
        const candidates: string[] = [];
        let failed = false;
        let incomplete = false;
        // At most three watches run concurrently. A slow first watch cannot starve
        // later watches; complete results survive the read deadline in any order.
        await Promise.all(store.watches.map(async (watch, i) => {
          if (!watch.enabled || now < watch.nextCheckAt) return;
          try {
            const ids = await abortable(() => fetchWatch(watch, reads.signal, env.fetcher), reads.signal);
            if (!alive()) return;
            const advanced = advanceWatch(watch, ids, env.now());
            store.watches[i] = { ...advanced.watch, failures: 0, nextCheckAt: nextScrapeCheck(env.now()) };
            candidates.push(...advanced.candidates);
          } catch (error) {
            if (!alive()) return;
            failed = true;
            const partial = error instanceof IncompleteCheck;
            incomplete ||= partial;
            const failures = Math.min(watch.failures + 1, 6);
            store.watches[i] = { ...watch, failures, nextCheckAt: nextWatchCheck(env.now(), failures), state: partial ? 'incomplete' : 'error' };
          }
        }));
        if (!alive() || env.storage.getItem(storageKey(account)) !== reservation) return;
        store.failures = Math.max(0, ...store.watches.map(w => w.failures));
        store.nextCheckAt = nextScrapeCheck(env.now());
        if (!store.watches.some(w => w.enabled)) store.enabled = false;
        const batch = reserveBatch(store, candidates, env.now());
        // At-most-once attempts across tabs/reloads, including failures and suppressed bursts.
        writeStore(env.storage, account, store);
        const written = env.storage.getItem(storageKey(account));
        if (batch.length && alive()) {
          const delivery = new AbortController();
          const cancelDelivery = () => delivery.abort(lifecycle.signal.reason);
          lifecycle.signal.addEventListener('abort', cancelDelivery, { once: true });
          const deliveryDeadline = setTimeout(() => delivery.abort(new Error('Delivery deadline exceeded')), 10_000);
          try { await abortable(() => env.adapter.deliver({ ids: batch }, delivery.signal), delivery.signal); }
          catch {
            if (!alive() || env.storage.getItem(storageKey(account)) !== written) return;
            store.enabled = false;
            writeStore(env.storage, account, store);
            env.update(store, 'Delivery failed. Checks paused; enable again to retry. Existing events will form a new baseline.');
            return;
          } finally {
            clearTimeout(deliveryDeadline);
            lifecycle.signal.removeEventListener('abort', cancelDelivery);
          }
        }
        if (alive()) env.update(store, store.watches.some(w => w.state === 'history-full')
          ? 'A watch reached its 3000-identity history limit and paused. Resume it to establish a fresh baseline.'
          : failed
            ? (incomplete ? 'Some watches are incomplete or stale; their checkpoints were kept. Narrow the region or filters. Retrying with per-watch backoff.' : 'Some checks failed, timed out, or filters are unavailable. Their checkpoints were kept; retries back off up to 30 minutes. Healthy watches keep checking.')
            : `Checked ${new Date(env.now()).toLocaleTimeString()}. Next scraper-aligned check after ${new Date(store.nextCheckAt).toLocaleTimeString()}.`);
      });
    } catch {
      if (alive() && !acquired && reads.signal.aborted) {
        try { env.update(readStore(env.storage, account), 'Another tab held the check lock past the deadline. Checks will retry while visible and online.'); }
        catch { failCoordination(); }
      } else if (alive()) {
        failCoordination();
      }
    } finally {
      clearTimeout(deadline);
      lifecycle.signal.removeEventListener('abort', cancelReads);
      current = null;
    }
  };
  return { tick, cancel, recover() { stopped = false; }, stop() { stopped = true; cancel(); } };
}
