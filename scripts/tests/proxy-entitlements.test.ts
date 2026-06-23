import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  resolveEntitlements: vi.fn(),
  rateLimit: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock('@/lib/server/entitlements', () => ({ resolveRequestEntitlements: mocks.resolveEntitlements }));
vi.mock('@upstash/redis', () => ({ Redis: { fromEnv: vi.fn(() => ({})) } }));
vi.mock('@upstash/ratelimit', () => ({
  Ratelimit: class {
    static slidingWindow = vi.fn(() => ({}));
    limit = mocks.rateLimit;
  },
}));

import { GET } from '@/app/api/proxy/[...path]/route';

describe('premium proxy entitlements', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveEntitlements.mockResolvedValue({ tier: 'free', entitlements: {} });
  });

  it('rejects Analyst tracking layers for Free users before upstream work', async () => {
    const response = await GET(
      new Request('https://seraphim.example/api/proxy/flights?lat=10&lng=20') as never,
      { params: Promise.resolve({ path: ['flights'] }) },
    );
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ code: 'feature_required', requiredTier: 'analyst' });
  });

  it('rejects Pro environmental layers for Free users', async () => {
    const response = await GET(
      new Request('https://seraphim.example/api/proxy/wildfires') as never,
      { params: Promise.resolve({ path: ['wildfires'] }) },
    );
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ requiredTier: 'pro' });
  });
});
