import 'server-only';

export type SingleFlight = {
  run<T>(key: string, load: () => Promise<T>): Promise<T>;
  clear(): void;
  size(): number;
};

/**
 * Coalesces identical in-flight work without retaining completed values.
 * When every slot is busy, new unique keys bypass coalescing so the map stays
 * bounded; callers should pair this with their normal rate limits.
 */
export function createSingleFlight(maxEntries: number): SingleFlight {
  const inflight = new Map<string, Promise<unknown>>();

  return {
    run<T>(key: string, load: () => Promise<T>): Promise<T> {
      const existing = inflight.get(key) as Promise<T> | undefined;
      if (existing) return existing;
      if (inflight.size >= maxEntries) return load();

      const promise = Promise.resolve().then(load);
      inflight.set(key, promise);
      void promise.finally(() => {
        if (inflight.get(key) === promise) inflight.delete(key);
      }).catch(() => undefined);
      return promise;
    },
    clear() {
      inflight.clear();
    },
    size() {
      return inflight.size;
    },
  };
}
