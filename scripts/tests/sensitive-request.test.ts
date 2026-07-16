import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ limit: vi.fn() }));

vi.mock('@upstash/redis', () => ({ Redis: { fromEnv: vi.fn(() => ({})) } }));
vi.mock('@upstash/ratelimit', () => ({
  Ratelimit: class {
    static slidingWindow = vi.fn(() => ({}));
    limit = mocks.limit;
  },
}));

describe('sensitive request rate limiting', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('fails closed in production when Upstash is not configured', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '');
    const { checkSensitiveRateLimit } = await import('@/lib/security/sensitiveRequest');

    const result = await checkSensitiveRateLimit(new Request('https://seraphim.example', {
      headers: { 'x-vercel-forwarded-for': '198.51.100.40' },
    }), 'user-1');

    expect(result).toEqual({ allowed: false, retryAfterSeconds: 60 });
    expect(mocks.limit).not.toHaveBeenCalled();
  });

  it('fails closed on transient Redis errors', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://redis.example');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'token');
    mocks.limit.mockRejectedValue(new Error('unavailable'));
    const { checkSensitiveRateLimit } = await import('@/lib/security/sensitiveRequest');

    const result = await checkSensitiveRateLimit(new Request('https://seraphim.example', {
      headers: { 'x-vercel-forwarded-for': '198.51.100.41' },
    }), 'user-2');

    expect(result).toEqual({ allowed: false, retryAfterSeconds: 60 });
    expect(mocks.limit).toHaveBeenCalled();
  });
});
