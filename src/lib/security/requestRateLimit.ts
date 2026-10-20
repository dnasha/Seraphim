import 'server-only';

import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { createLocalFixedWindowLimiter, createThrottledDiagnostic } from './localRateLimit';

export function createRequestRateLimiter(options: {
  prefix: string;
  limit: number;
  localLimit: number;
  localWindowMs?: number;
}) {
  const local = createLocalFixedWindowLimiter({
    limit: options.localLimit,
    windowMs: options.localWindowMs ?? 10_000,
  });
  const configured = Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
  const distributed = configured ? new Ratelimit({
    redis: Redis.fromEnv(),
    limiter: Ratelimit.slidingWindow(options.limit, '1 m'),
    analytics: true,
    prefix: options.prefix,
  }) : null;
  const reportUnavailable = createThrottledDiagnostic(() => {
    console.error(`[${options.prefix}] Distributed rate limiter unavailable; local ceiling remains active.`);
  });

  return {
    async check(keys: string[], now = Date.now()) {
      const result = local.check(keys, now);
      if (!result.success) return { allowed: false, retryAfterSeconds: result.retryAfterSeconds };
      if (distributed) {
        try {
          // Count every admitted request, including entitlement denials. Network
          // and verified-user checks are separate so neither is counted twice.
          const results = await Promise.all(keys.map(key => distributed.limit(key)));
          const denied = results.filter(value => !value.success);
          if (denied.length) return {
            allowed: false,
            retryAfterSeconds: Math.max(1, ...denied.map(value => Math.ceil((value.reset - now) / 1000) || 1)),
          };
        } catch {
          reportUnavailable(now);
        }
      } else {
        reportUnavailable(now);
      }
      return { allowed: true, retryAfterSeconds: 0 };
    },
  };
}
