import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ recordIncident: vi.fn(), recordMetric: vi.fn() }));

vi.mock('@/lib/server/operations', () => ({
  recordIncident: mocks.recordIncident,
  recordMetric: mocks.recordMetric,
}));

import { POST } from '@/app/api/csp-report/route';

describe('POST /api/csp-report', () => {
  it('records dashboard-compatible, privacy-safe incident dimensions', async () => {
    const response = await POST(new Request('https://seraphim.example/api/csp-report', {
      method: 'POST',
      headers: {
        'content-type': 'application/csp-report',
        'x-vercel-forwarded-for': '198.51.100.30',
      },
      body: JSON.stringify({
        'csp-report': {
          'effective-directive': 'script-src-elem',
          'blocked-uri': 'https://cdn.example/script.js?secret=value',
          'source-file': 'https://seraphim.example/account?private=value',
        },
      }),
    }) as never);

    expect(response.status).toBe(204);
    expect(mocks.recordMetric).toHaveBeenCalledWith({
      kind: 'operational',
      service: 'web',
      name: 'csp.script-src-elem',
    });
    expect(mocks.recordIncident).toHaveBeenCalledWith(expect.objectContaining({
      dedupKey: 'web:csp:script-src-elem:https://cdn.example',
      type: 'csp_report_only_violation',
      safeContext: {
        effectiveDirective: 'script-src-elem',
        blockedOrigin: 'https://cdn.example',
        sourceOrigin: 'https://seraphim.example',
      },
    }));
  });
});
