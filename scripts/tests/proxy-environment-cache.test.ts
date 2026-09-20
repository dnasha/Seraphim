import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  resolveEntitlements: vi.fn(),
  markHealthy: vi.fn(),
  markFailure: vi.fn(),
}));
vi.mock('@/lib/server/entitlements', () => ({ resolveRequestEntitlements: mocks.resolveEntitlements }));
vi.mock('@upstash/redis', () => ({ Redis: { fromEnv: vi.fn(() => ({})) } }));
vi.mock('@upstash/ratelimit', () => ({
  Ratelimit: class {
    static slidingWindow = vi.fn(() => ({}));
    limit = vi.fn().mockResolvedValue({ success: true });
  },
}));
vi.mock('@/lib/server/operations', () => ({
  recordIncident: vi.fn(), recordMetric: vi.fn(), recoverIncident: vi.fn(), serverDiagnostic: vi.fn(),
}));
vi.mock('@/lib/server/overlayHealth', () => ({
  createOverlayHealthRecorder: () => ({ markHealthy: mocks.markHealthy, markFailure: mocks.markFailure }),
}));

import { GET } from '@/app/api/proxy/[...path]/route';
import { clearOverlayCacheForTests } from '@/lib/server/overlayCache';

const feeds = [
  {
    service: 'wildfires',
    payload: 'latitude,longitude,brightness,scan,track,acq_date,acq_time,satellite,confidence,version,bright_t31,frp,daynight\n10,20,300,1,1,2026-09-20,1200,N,high,2,280,15,D',
    properties: { confidence: 'high', frp: 15 },
    failure: 'Failed to fetch active fires from FIRMS',
  },
  {
    service: 'eonet',
    payload: JSON.stringify({ type: 'FeatureCollection', features: [{
      type: 'Feature', geometry: { type: 'Point', coordinates: [20, 10] },
      properties: { categories: [{ id: 'wildfires' }] },
    }] }),
    properties: { category: 'wildfires' },
    failure: 'Failed to fetch active events from EONET',
  },
];

function call(service: string) {
  return GET(new Request(`https://seraphim.example/api/proxy/${service}`, {
    headers: { 'x-vercel-forwarded-for': '198.51.100.220' },
  }) as never, { params: Promise.resolve({ path: [service] }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-20T00:00:00Z'));
  clearOverlayCacheForTests();
  mocks.resolveEntitlements.mockResolvedValue({ tier: 'pro', entitlements: {}, userId: 'viewer-1' });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe.each(feeds)('$service provider cache', ({ service, payload, properties, failure }) => {
  it('coalesces concurrent loads and shares transformed data while rechecking every viewer', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => new Response(payload));
    vi.stubGlobal('fetch', fetchMock);

    const responses = await Promise.all([call(service), call(service)]);
    const body = await responses[0].json();
    expect(body.features[0]).toMatchObject({
      geometry: { coordinates: [20, 10] }, properties,
    });
    await expect(responses[1].json()).resolves.toEqual(body);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(mocks.markHealthy).toHaveBeenCalledExactlyOnceWith(service);
    for (const response of responses) expect(response.headers.get('cache-control')).toBe('private, no-store');

    mocks.resolveEntitlements.mockResolvedValueOnce({ tier: 'pro', entitlements: {}, userId: 'viewer-2' });
    await expect((await call(service)).json()).resolves.toEqual(body);
    mocks.resolveEntitlements.mockResolvedValueOnce({ tier: 'free', entitlements: {}, userId: 'viewer-3' });
    expect((await call(service)).status).toBe(403);
    expect(mocks.resolveEntitlements).toHaveBeenCalledTimes(4);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('refreshes after one minute and serves stale data only within the five-minute fallback', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => new Response(payload));
    vi.stubGlobal('fetch', fetchMock);
    const body = await (await call(service)).json();

    await vi.advanceTimersByTimeAsync(59_999);
    expect((await call(service)).status).toBe(200);
    expect(fetchMock).toHaveBeenCalledOnce();

    fetchMock.mockImplementation(async () => new Response(null, { status: 503 }));
    await vi.advanceTimersByTimeAsync(1);
    await expect((await call(service)).json()).resolves.toEqual(body);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(mocks.markFailure).toHaveBeenCalledWith(service, 'http_503');

    await vi.advanceTimersByTimeAsync(4 * 60_000);
    const expiredResponse = await call(service);
    expect(expiredResponse.status).toBe(503);
    await expect(expiredResponse.json()).resolves.toEqual({ error: failure });
  });

  it('preserves provider errors without caching them', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => new Response(null, { status: 429 }));
    vi.stubGlobal('fetch', fetchMock);
    const response = await call(service);
    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toEqual({ error: failure });
    expect(mocks.markFailure).toHaveBeenCalledWith(service, 'http_429');

    fetchMock.mockImplementation(async () => new Response(payload));
    expect((await call(service)).status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
