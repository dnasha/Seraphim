import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ limit: vi.fn(), resolve: vi.fn() }));
vi.mock('@/lib/server/entitlements', () => ({ resolveRequestEntitlements: mocks.resolve }));
vi.mock('@upstash/redis', () => ({ Redis: { fromEnv: () => ({}) } }));
vi.mock('@upstash/ratelimit', () => ({ Ratelimit: class {
  static slidingWindow = () => ({});
  limit = mocks.limit;
} }));
import { GET } from '@/app/api/map-style/[style]/route';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.limit.mockResolvedValue({ success: true });
  mocks.resolve.mockResolvedValue({ tier: 'guest', userId: null });
});
const request = () => new Request('https://seraphim.example/api/map-style/black', {
  headers: { 'x-vercel-forwarded-for': '198.51.100.239' },
});
const params = () => ({ params: Promise.resolve({ style: 'black' }) });

describe('map style request guards', () => {
  it('blocks abuse before Auth and entitlements', async () => {
    mocks.limit.mockResolvedValue({ success: false, reset: Date.now() + 60_000 });
    expect((await GET(request(), params())).status).toBe(429);
    expect(mocks.resolve).not.toHaveBeenCalled();
  });
  it('counts every entitlement denial in the shared limit', async () => {
    for (let count = 0; count < 3; count++) expect((await GET(request(), params())).status).toBe(403);
    expect(mocks.limit).toHaveBeenCalledTimes(3);
    expect(mocks.limit.mock.calls.every(([key]) => key === 'net:198.51.100.239')).toBe(true);
  });
});
