import 'server-only';

type FixedWindowEntry = {
  count: number;
  resetAt: number;
};

export type LocalRateLimitResult = {
  success: boolean;
  retryAfterSeconds: number;
  counts: number[];
};

export type LocalFixedWindowLimiter = {
  check(keys: readonly string[], now?: number): LocalRateLimitResult;
  clear(): void;
  size(): number;
};

export function createLocalFixedWindowLimiter({
  limit,
  windowMs,
  maxEntries = 5_000,
}: {
  limit: number;
  windowMs: number;
  maxEntries?: number;
}): LocalFixedWindowLimiter {
  const entries = new Map<string, FixedWindowEntry>();
  let lastCleanup = 0;

  function cleanup(now: number) {
    if (now - lastCleanup >= windowMs || entries.size > maxEntries) {
      for (const [key, entry] of entries) {
        if (entry.resetAt <= now) entries.delete(key);
      }
      lastCleanup = now;
    }
    while (entries.size > maxEntries) {
      const oldest = entries.keys().next().value as string | undefined;
      if (!oldest) break;
      entries.delete(oldest);
    }
  }

  return {
    check(keys, now = Date.now()) {
      cleanup(now);
      const uniqueKeys = [...new Set(keys)];
      let retryAfterMs = 0;
      const counts = uniqueKeys.map((key) => {
        const current = entries.get(key);
        const entry = !current || current.resetAt <= now
          ? { count: 1, resetAt: now + windowMs }
          : { count: current.count + 1, resetAt: current.resetAt };
        entries.delete(key);
        entries.set(key, entry);
        if (entry.count > limit) {
          retryAfterMs = Math.max(retryAfterMs, entry.resetAt - now);
        }
        return entry.count;
      });
      cleanup(now);
      return {
        success: retryAfterMs === 0,
        retryAfterSeconds: retryAfterMs > 0 ? Math.max(1, Math.ceil(retryAfterMs / 1_000)) : 0,
        counts,
      };
    },
    clear() {
      entries.clear();
      lastCleanup = 0;
    },
    size() {
      return entries.size;
    },
  };
}

export function createThrottledDiagnostic(
  report: () => void,
  intervalMs = 60_000,
) {
  let lastReportAt = 0;
  return (now = Date.now()) => {
    if (now - lastReportAt < intervalMs) return;
    lastReportAt = now;
    report();
  };
}
