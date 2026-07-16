import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearOverlayCacheForTests,
  getCachedOverlayData,
  type OverlayCacheStore,
} from '@/lib/server/overlayCache';

class MemoryStore implements OverlayCacheStore {
  values = new Map<string, unknown>();
  async get<T>(key: string) { return (this.values.get(key) as T | undefined) ?? null; }
  async set(key: string, value: unknown) { this.values.set(key, value); return 'OK'; }
}

describe('overlay provider cache', () => {
  beforeEach(() => clearOverlayCacheForTests());

  it('coalesces simultaneous provider loads', async () => {
    let release: ((value: { ok: boolean }) => void) | undefined;
    const load = vi.fn(() => new Promise<{ ok: boolean }>((resolve) => { release = resolve; }));
    const options = { key: 'iss', freshForMs: 10_000, staleForMs: 60_000, load };

    const first = getCachedOverlayData(options);
    const second = getCachedOverlayData(options);
    await Promise.resolve();
    await Promise.resolve();
    release?.({ ok: true });

    await expect(first).resolves.toEqual({ ok: true });
    await expect(second).resolves.toEqual({ ok: true });
    expect(load).toHaveBeenCalledOnce();
  });

  it('shares entries through the distributed store and serves stale data on failure', async () => {
    const store = new MemoryStore();
    let currentTime = 1_000;
    const firstLoad = vi.fn().mockResolvedValue({ position: 1 });
    await getCachedOverlayData({
      key: 'iss', freshForMs: 10, staleForMs: 100, load: firstLoad,
      store, now: () => currentTime,
    });

    clearOverlayCacheForTests();
    currentTime = 1_020;
    const failedRefresh = vi.fn().mockRejectedValue(new Error('provider down'));
    await expect(getCachedOverlayData({
      key: 'iss', freshForMs: 10, staleForMs: 100, load: failedRefresh,
      store, now: () => currentTime,
    })).resolves.toEqual({ position: 1 });
    expect(failedRefresh).toHaveBeenCalledOnce();
  });
});
