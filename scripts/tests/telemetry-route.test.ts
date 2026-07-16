import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  recordMetric: vi.fn(),
}));

vi.mock('@/lib/server/operations', () => ({ recordMetric: mocks.recordMetric }));
vi.mock('@/lib/security/sensitiveRequest', () => ({ hasValidSameOrigin: () => true }));
vi.mock('@/lib/security/payments', () => ({ getConfiguredSiteUrl: () => 'https://seraphim.example' }));
vi.mock('@/lib/security/clientIdentity', () => ({ getTrustedClientIp: () => '203.0.113.10' }));

import { POST } from '@/app/api/telemetry/route';

function request(body: unknown) {
  return new Request('https://seraphim.example/api/telemetry', {
    method: 'POST',
    headers: { origin: 'https://seraphim.example', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as never;
}

describe('POST /api/telemetry', () => {
  beforeEach(() => vi.clearAllMocks());

  it('records a bounded pricing funnel metric', async () => {
    const response = await POST(request({
      name: 'checkout_click',
      plan: 'analyst',
      interval: 'year',
      source: 'feature_gate',
    }));

    expect(response.status).toBe(204);
    expect(mocks.recordMetric).toHaveBeenCalledWith({
      kind: 'conversion',
      service: 'web',
      name: 'analytics.checkout_click.analyst.year.feature_gate',
    });
  });

  it('accepts pricing views without optional plan attribution', async () => {
    const response = await POST(request({ name: 'pricing_view', source: 'direct' }));

    expect(response.status).toBe(204);
    expect(mocks.recordMetric).toHaveBeenCalledWith(expect.objectContaining({
      name: 'analytics.pricing_view.direct',
    }));
  });

  it('records an approved activation milestone', async () => {
    const response = await POST(request({ name: 'activation', milestone: 'historical_monitoring' }));

    expect(response.status).toBe(204);
    expect(mocks.recordMetric).toHaveBeenCalledWith(expect.objectContaining({
      name: 'analytics.activation.historical_monitoring',
    }));
  });

  it('rejects unbounded dimensions', async () => {
    const response = await POST(request({
      name: 'checkout_click',
      plan: 'enterprise',
      source: 'campaign-supplied-by-user',
    }));

    expect(response.status).toBe(400);
    expect(mocks.recordMetric).not.toHaveBeenCalled();
  });
});
