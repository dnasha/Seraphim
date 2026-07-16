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
  if (!limiter) return { allowed: true as const };
  const ip = getTrustedClientIp(request.headers);
  if (!ip) return { allowed: false as const };
  try {
    const results = await Promise.all(
      getRateLimitKeys(ip, userId).map((key) => limiter.limit(key)),
    );
    return { allowed: results.every((result) => result.success) };
  } catch {
    return { allowed: false as const };
  }
}
