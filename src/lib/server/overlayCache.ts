import 'server-only';

export interface OverlayCacheStore {
  get<T = unknown>(key: string): Promise<T | null>;
  set(key: string, value: unknown, options: { ex: number }): Promise<unknown>;
}

interface CacheEntry<T> {
  data: T;
  freshUntil: number;
  staleUntil: number;
}

interface OverlayCacheOptions<T> {
  key: string;
  freshForMs: number;
  staleForMs: number;
  load: () => Promise<T>;
  store?: OverlayCacheStore | null;
  now?: () => number;
  maxSharedBytes?: number;
}

const memoryCache = new Map<string, CacheEntry<unknown>>();
const inFlightLoads = new Map<string, Promise<unknown>>();
const MAX_MEMORY_ENTRIES = 250;

function pruneMemoryCache(now: number) {
  for (const [key, entry] of memoryCache) {
    if (entry.staleUntil <= now) memoryCache.delete(key);
  }
  while (memoryCache.size > MAX_MEMORY_ENTRIES) {
    memoryCache.delete(memoryCache.keys().next().value!);
  }
}

function isCacheEntry<T>(value: unknown): value is CacheEntry<T> {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Partial<CacheEntry<T>>;
  return typeof entry.freshUntil === 'number' &&
    typeof entry.staleUntil === 'number' &&
    'data' in entry;
}

async function readSharedEntry<T>(
  key: string,
  store: OverlayCacheStore | null | undefined,
): Promise<CacheEntry<T> | null> {
  if (!store) return null;
  try {
    const value = await store.get<CacheEntry<T>>(key);
    return isCacheEntry<T>(value) ? value : null;
  } catch {
    return null;
  }
}

async function writeSharedEntry<T>(
  key: string,
  entry: CacheEntry<T>,
  staleForMs: number,
  maxSharedBytes: number,
  store: OverlayCacheStore | null | undefined,
) {
  if (!store) return;
  try {
    if (JSON.stringify(entry).length > maxSharedBytes) return;
    await store.set(key, entry, { ex: Math.max(1, Math.ceil(staleForMs / 1000)) });
  } catch {
    // The per-instance cache still provides a safe fallback when Redis is down.
  }
}

/**
 * Reads authorized provider data from a short shared cache and coalesces loads
 * within a server instance. Authorization must happen before this helper is
 * called; it deliberately knows nothing about users or entitlements.
 */
export async function getCachedOverlayData<T>({
  key,
  freshForMs,
  staleForMs,
  load,
  store,
  now = Date.now,
  maxSharedBytes = 512 * 1024,
}: OverlayCacheOptions<T>): Promise<T> {
  const startedAt = now();
  pruneMemoryCache(startedAt);
  let entry = memoryCache.get(key) as CacheEntry<T> | undefined;
  if (entry && entry.staleUntil <= startedAt) {
    memoryCache.delete(key);
    entry = undefined;
  }
  if (entry && entry.freshUntil > startedAt) return entry.data;

  const shared = await readSharedEntry<T>(key, store);
  if (shared && shared.staleUntil > startedAt) {
    entry = shared;
    memoryCache.set(key, shared);
    pruneMemoryCache(startedAt);
    if (shared.freshUntil > startedAt) return shared.data;
  }

  const existing = inFlightLoads.get(key) as Promise<T> | undefined;
  if (existing) {
    try {
      return await existing;
    } catch (error) {
      if (entry && entry.staleUntil > now()) return entry.data;
      throw error;
    }
  }

  const request = (async () => {
    const data = await load();
    const loadedAt = now();
    const next: CacheEntry<T> = {
      data,
      freshUntil: loadedAt + freshForMs,
      staleUntil: loadedAt + staleForMs,
    };
    memoryCache.set(key, next);
    pruneMemoryCache(loadedAt);
    await writeSharedEntry(key, next, staleForMs, maxSharedBytes, store);
    return data;
  })();

  inFlightLoads.set(key, request);
  try {
    return await request;
  } catch (error) {
    if (entry && entry.staleUntil > now()) return entry.data;
    throw error;
  } finally {
    inFlightLoads.delete(key);
  }
}

export function clearOverlayCacheForTests() {
  memoryCache.clear();
  inFlightLoads.clear();
}
