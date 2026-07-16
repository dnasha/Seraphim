import 'server-only';

import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { getRateLimitKeys, getTrustedClientIp } from '@/lib/security/clientIdentity';

const configured = process.env.NODE_ENV !== 'test' && Boolean(
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN,
);

const limiter = configured
  ? new Ratelimit({
      redis: Redis.fromEnv(),
      limiter: Ratelimit.slidingWindow(12, '1 m'),
      analytics: false,
      prefix: '@upstash/ratelimit/seraphim-sensitive',
    })
  : null;

export function hasValidSameOrigin(request: Request, expectedOrigin: string) {
  const origin = request.headers.get('origin');
  if (!origin) return process.env.NODE_ENV === 'test';
  try {
    return new URL(origin).origin === new URL(expectedOrigin).origin;
  } catch {
    return false;
  }
}

export async function checkSensitiveRateLimit(request: Request, userId: string) {
  if (!limiter) {
    return process.env.NODE_ENV === 'test'
      ? { allowed: true as const, retryAfterSeconds: 0 }
      : { allowed: false as const, retryAfterSeconds: 60 };
  }
  const ip = getTrustedClientIp(request.headers);
  if (!ip) return { allowed: false as const, retryAfterSeconds: 60 };
  try {
    const results = await Promise.all(
      getRateLimitKeys(ip, userId).map((key) => limiter.limit(key)),
    );
    const denied = results.filter((result) => !result.success);
    const retryAfterSeconds = denied.length === 0
      ? 0
      : Math.max(1, ...denied.map((result) => Math.ceil((result.reset - Date.now()) / 1_000)));
    return { allowed: denied.length === 0, retryAfterSeconds };
  } catch {
    return { allowed: false as const, retryAfterSeconds: 60 };
  }
}
