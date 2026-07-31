import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  recordIncident: vi.fn(),
  recordMetric: vi.fn(),
  rateLimit: vi.fn(),
  serverDiagnostic: vi.fn(),
}));

vi.mock('@upstash/redis', () => ({ Redis: { fromEnv: vi.fn(() => ({})) } }));
vi.mock('@upstash/ratelimit', () => ({
  Ratelimit: class {
    static fixedWindow = vi.fn(() => ({}));
    private readonly prefix: string;

    constructor(options: { prefix: string }) {
      this.prefix = options.prefix;
    }

    limit(key: string) {
      return mocks.rateLimit(this.prefix, key);
    }
  },
}));

vi.mock('@/lib/server/operations', () => ({
  recordIncident: mocks.recordIncident,
  recordMetric: mocks.recordMetric,
  serverDiagnostic: mocks.serverDiagnostic,
}));

import { POST } from '@/app/api/csp-report/route';

describe('POST /api/csp-report', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('CSP_REPORTING_ENABLED', 'true');
    mocks.rateLimit.mockResolvedValue({ success: true, reset: Date.now() + 60_000 });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

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
        sampled: true,
        sampleLimit: 3,
        sampleWindowMinutes: 10,
      },
    }));
    expect(mocks.rateLimit).toHaveBeenCalledTimes(3);
  });

  it('samples repeated fingerprints before they reach Redis or Supabase', async () => {
    const makeRequest = () => new Request('https://seraphim.example/api/csp-report', {
      method: 'POST',
      headers: {
        'content-type': 'application/csp-report',
        'x-vercel-forwarded-for': '198.51.100.31',
      },
      body: JSON.stringify({
        'csp-report': {
          'effective-directive': 'connect-src',
          'blocked-uri': 'https://repeat.example/resource',
          'source-file': 'https://seraphim.example/',
        },
      }),
    }) as never;

    await POST(makeRequest());
    await POST(makeRequest());

    expect(mocks.rateLimit).toHaveBeenCalledTimes(5);
    expect(mocks.recordMetric).toHaveBeenCalledOnce();
    expect(mocks.recordIncident).toHaveBeenCalledOnce();
  });

  it('drops a report when a distributed gate denies it', async () => {
    mocks.rateLimit.mockImplementation(async (prefix: string) => ({
      success: !prefix.endsWith('seraphim-csp-global'),
      reset: Date.now() + 60_000,
    }));

    const response = await POST(new Request('https://seraphim.example/api/csp-report', {
      method: 'POST',
      headers: {
        'content-type': 'application/csp-report',
        'x-vercel-forwarded-for': '198.51.100.32',
      },
      body: JSON.stringify({
        'csp-report': {
          'effective-directive': 'font-src',
          'blocked-uri': 'https://denied.example/font.woff2',
          'source-file': 'https://seraphim.example/',
        },
      }),
    }) as never);

    expect(response.status).toBe(204);
    expect(mocks.recordMetric).not.toHaveBeenCalled();
    expect(mocks.recordIncident).not.toHaveBeenCalled();
  });

  it('never records reports in development', async () => {
    vi.stubEnv('NODE_ENV', 'development');

    const response = await POST(new Request('http://localhost:3000/api/csp-report', {
      method: 'POST',
      headers: { 'content-type': 'application/csp-report' },
      body: JSON.stringify({ 'csp-report': { 'effective-directive': 'script-src' } }),
    }) as never);

    expect(response.status).toBe(204);
    expect(mocks.rateLimit).not.toHaveBeenCalled();
    expect(mocks.recordMetric).not.toHaveBeenCalled();
    expect(mocks.recordIncident).not.toHaveBeenCalled();
  });

  it('rejects a declared oversized report without reading its body', async () => {
    const getReader = vi.fn();
    const request = {
      headers: new Headers({
        'content-type': 'application/csp-report',
        'content-length': '20000',
        'x-vercel-forwarded-for': '198.51.100.34',
      }),
      body: { getReader },
    };

    expect((await POST(request as never)).status).toBe(204);
    expect(getReader).not.toHaveBeenCalled();
    expect(mocks.rateLimit).not.toHaveBeenCalled();
    expect(mocks.recordIncident).not.toHaveBeenCalled();
  });

  it('cancels a lengthless report as soon as its streamed byte budget is exceeded', async () => {
    const cancel = vi.fn();
    let chunksSent = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        chunksSent += 1;
        controller.enqueue(new Uint8Array(9_000));
        if (chunksSent === 3) controller.close();
      },
      cancel,
    }, { highWaterMark: 0 });
    const request = new Request('https://seraphim.example/api/csp-report', {
      method: 'POST',
      headers: {
        'content-type': 'application/csp-report',
        'x-vercel-forwarded-for': '198.51.100.35',
      },
      body,
      duplex: 'half',
    } as RequestInit & { duplex: 'half' });

    expect((await POST(request as never)).status).toBe(204);
    expect(chunksSent).toBe(2);
    expect(cancel).toHaveBeenCalledOnce();
    expect(mocks.recordIncident).not.toHaveBeenCalled();
  });

  it('applies ingress rate limits before pulling a report body', async () => {
    mocks.rateLimit.mockImplementation(async (prefix: string) => ({
      success: !prefix.endsWith('seraphim-csp-client'),
      reset: Date.now() + 60_000,
    }));
    const getReader = vi.fn();
    const request = {
      headers: new Headers({
        'content-type': 'application/csp-report',
        'x-vercel-forwarded-for': '198.51.100.36',
      }),
      body: { getReader },
    };

    expect((await POST(request as never)).status).toBe(204);
    expect(getReader).not.toHaveBeenCalled();
    expect(mocks.recordIncident).not.toHaveBeenCalled();
  });

  it('drops stale or manual reports before external work when reporting is disabled', async () => {
    vi.stubEnv('CSP_REPORTING_ENABLED', 'false');

    const response = await POST(new Request('https://seraphim.example/api/csp-report', {
      method: 'POST',
      headers: {
        'content-type': 'application/csp-report',
        'x-vercel-forwarded-for': '198.51.100.33',
      },
      body: JSON.stringify({
        'csp-report': {
          'effective-directive': 'connect-src',
          'blocked-uri': 'https://stale.example/resource',
          'source-file': 'https://seraphim.example/',
        },
      }),
    }) as never);

    expect(response.status).toBe(204);
    expect(mocks.rateLimit).not.toHaveBeenCalled();
    expect(mocks.recordMetric).not.toHaveBeenCalled();
    expect(mocks.recordIncident).not.toHaveBeenCalled();
  });
});
