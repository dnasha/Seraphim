import { describe, expect, it, vi } from 'vitest';
import { validateNewsSearchParams } from '@/lib/security/newsParams';
import { safeRelativePath, safeRelativeRedirect } from '@/lib/security/redirects';
import {
  canFulfillAngelCheckout,
  getConfiguredSiteUrl,
  isAngelCheckoutEnabled,
  isBillingPortalEnabled,
  isCheckoutEnabled,
  isPaymentsEnabled,
} from '@/lib/security/payments';
import { parseProxyCoordinate, validateTilePath } from '@/lib/security/proxyGuards';
import {
  disposePublicFetchAgent,
  fetchPublicBytes,
  fetchPublicImage,
  isPublicIpAddress,
  validatePublicImageUrl,
} from '@/lib/security/ogImage';
import { getTrustedClientIp } from '@/lib/security/clientIdentity';
import { parseCspReport } from '@/lib/security/cspReport';
import { buildCspReportOnly, CSP_ENFORCED_BASELINE } from '@/lib/security/csp';
import { createLocalFixedWindowLimiter } from '@/lib/security/localRateLimit';
import { createSingleFlight } from '@/lib/server/singleFlight';
import { safeExternalHttpUrl } from '@/lib/security/externalUrl';

describe('news API param validation', () => {
  it('clamps numeric limits and accepts valid bbox searches', () => {
    const params = new URLSearchParams({
      limit: '5000',
      minLat: '-10',
      maxLat: '10',
      minLng: '-20',
      maxLng: '20',
      zoom: '4.5',
      query: 'Kyiv',
      since: '2026-01-01T00:00:00Z',
    });

    const result = validateNewsSearchParams(params);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.params.requestedLimit).toBe(1000);
      expect(result.params.searchQuery).toBe('Kyiv');
      expect(result.params.hasBBox).toBe(true);
    }
  });

  it('rejects malformed bbox and overlong search before database work', () => {
    expect(validateNewsSearchParams(new URLSearchParams({ minLat: '1' })).ok).toBe(false);
    expect(validateNewsSearchParams(new URLSearchParams({ query: 'x'.repeat(161) })).ok).toBe(false);
    expect(validateNewsSearchParams(new URLSearchParams({ since: 'bad-date' })).ok).toBe(false);
  });
});

describe('redirect guard', () => {
  const origin = 'https://seraphi.me';

  it('allows same-origin relative paths', () => {
    expect(safeRelativeRedirect('/account?tab=billing', origin)).toBe('https://seraphi.me/account?tab=billing');
  });

  it('rejects external-looking next values', () => {
    expect(safeRelativeRedirect('//evil.test', origin)).toBe('https://seraphi.me/');
    expect(safeRelativeRedirect('@evil.test/path', origin)).toBe('https://seraphi.me/');
    expect(safeRelativeRedirect('/\\evil', origin)).toBe('https://seraphi.me/');
    expect(safeRelativePath('/\\evil.example')).toBe('/');
    expect(safeRelativePath('/account?tab=billing#plan')).toBe('/account?tab=billing#plan');
  });

  it('parses stored outbound links without throwing', () => {
    expect(safeExternalHttpUrl('https://News.Example/story')).toEqual({
      href: 'https://news.example/story',
      hostname: 'news.example',
    });
    expect(safeExternalHttpUrl('https://%')).toBeNull();
    expect(safeExternalHttpUrl('javascript:alert(1)')).toBeNull();
    expect(safeExternalHttpUrl('https://user:secret@news.example/story')).toBeNull();
  });
});

describe('payment guards', () => {
  it('requires explicit payments flag', () => {
    expect(isPaymentsEnabled({ PAYMENTS_ENABLED: 'true' })).toBe(true);
    expect(isPaymentsEnabled({ PAYMENTS_ENABLED: 'false' })).toBe(false);
    expect(isPaymentsEnabled({})).toBe(false);
  });

  it('keeps checkout, Angel, and Portal kill switches independently fail-closed', () => {
    expect(isCheckoutEnabled({ PAYMENTS_ENABLED: 'true', CHECKOUT_ENABLED: 'false' })).toBe(false);
    expect(isAngelCheckoutEnabled({ PAYMENTS_ENABLED: 'true', CHECKOUT_ENABLED: 'true', ANGEL_CHECKOUT_ENABLED: 'false' })).toBe(false);
    expect(isBillingPortalEnabled({ PAYMENTS_ENABLED: 'true', BILLING_PORTAL_ENABLED: 'false' })).toBe(false);
    expect(isCheckoutEnabled({})).toBe(false);
    expect(isAngelCheckoutEnabled({})).toBe(false);
    expect(isBillingPortalEnabled({})).toBe(false);
  });

  it('requires configured https site URL except localhost', () => {
    expect(getConfiguredSiteUrl({ SITE_URL: 'https://seraphi.me/path' })).toBe('https://seraphi.me');
    expect(getConfiguredSiteUrl({ SITE_URL: 'http://localhost:3000' })).toBe('http://localhost:3000');
    expect(getConfiguredSiteUrl({ SITE_URL: 'http://evil.test' })).toBeNull();
  });

  it('fulfills Angel only after paid Checkout with a payment intent', () => {
    expect(canFulfillAngelCheckout({
      mode: 'payment',
      priceKey: 'angel',
      paymentStatus: 'paid',
      paymentIntent: 'pi_123',
    })).toBe(true);
    expect(canFulfillAngelCheckout({
      mode: 'payment',
      priceKey: 'angel',
      paymentStatus: 'unpaid',
      paymentIntent: 'pi_123',
    })).toBe(false);
  });
});

describe('proxy and OG guards', () => {
  it('cleans up dispatchers across Node and Bun-compatible agent shapes', async () => {
    const close = vi.fn(async () => undefined);
    const destroy = vi.fn(async () => undefined);

    await expect(disposePublicFetchAgent({ close })).resolves.toBeUndefined();
    await expect(disposePublicFetchAgent({ destroy })).resolves.toBeUndefined();
    await expect(disposePublicFetchAgent({})).resolves.toBeUndefined();
    await expect(disposePublicFetchAgent({ close: () => { throw new Error('cleanup failed'); } }))
      .resolves.toBeUndefined();

    expect(close).toHaveBeenCalledOnce();
    expect(destroy).toHaveBeenCalledOnce();
  });

  it('validates coordinates and tile ranges', () => {
    expect(parseProxyCoordinate('37.7', -90, 90)).toBe(37.7);
    expect(parseProxyCoordinate('999', -90, 90)).toBeNull();
    expect(validateTilePath('3', '4', '5.png')).toEqual({ z: 3, x: 4, y: 5 });
    expect(validateTilePath('3', '99', '5.png')).toBeNull();
  });

  it('rejects local/private OG image URLs', () => {
    expect(validatePublicImageUrl('https://example.com/image.png')).toBe('https://example.com/image.png');
    expect(validatePublicImageUrl('file:///etc/passwd')).toBeNull();
    expect(validatePublicImageUrl('http://localhost/image.png')).toBeNull();
    expect(validatePublicImageUrl('http://192.168.1.5/image.png')).toBeNull();
    expect(validatePublicImageUrl('http://[::1]/image.png')).toBeNull();
    expect(isPublicIpAddress('fd12::1')).toBe(false);
    expect(isPublicIpAddress('fe80::1')).toBe(false);
    expect(isPublicIpAddress('::ffff:127.0.0.1')).toBe(false);
  });

  it('uses only Vercel-provided client identity', () => {
    expect(getTrustedClientIp(new Headers({
      'x-vercel-forwarded-for': '198.51.100.1',
      'x-forwarded-for': '10.0.0.1',
    }))).toBe('198.51.100.1');
    expect(getTrustedClientIp(new Headers({ 'x-forwarded-for': '198.51.100.1' }))).toBeNull();
    expect(getTrustedClientIp(new Headers({ 'x-vercel-forwarded-for': '198.51.100.1, 10.0.0.1' }))).toBeNull();
  });

  it('falls back to 127.0.0.1 in development mode', () => {
    const originalEnv = process.env.NODE_ENV;
    try {
      // @ts-expect-error: process.env.NODE_ENV is read-only
      process.env.NODE_ENV = 'development';
      expect(getTrustedClientIp(new Headers({}))).toBe('127.0.0.1');
      expect(getTrustedClientIp(new Headers({ 'x-forwarded-for': '10.0.0.1' }))).toBe('127.0.0.1');
    } finally {
      // @ts-expect-error: process.env.NODE_ENV is read-only
      process.env.NODE_ENV = originalEnv;
    }
  });

  it('rejects private DNS results and public-to-private redirects before fetching them', async () => {
    const blockedFetch = vi.fn();
    await expect(fetchPublicImage('https://private-dns.example/image.png', {
      resolveHost: async () => [{ address: '10.0.0.1', family: 4 }],
      fetchHop: blockedFetch,
    })).resolves.toBeNull();
    expect(blockedFetch).not.toHaveBeenCalled();

    const fetchHop = vi.fn(async () => ({
      response: new Response(null, { status: 302, headers: { location: 'http://private.example/image.png' } }),
      close: async () => undefined,
    }));
    const resolver = vi.fn(async (hostname: string) => hostname === 'private.example'
      ? [{ address: '10.0.0.1', family: 4 as const }]
      : [{ address: '198.51.100.2', family: 4 as const }]);

    await expect(fetchPublicImage('https://public.example/image.png', { resolveHost: resolver, fetchHop })).resolves.toBeNull();
    expect(fetchHop).toHaveBeenCalledTimes(1);
    expect(resolver).toHaveBeenNthCalledWith(2, 'private.example');
  });

  it('pins a vetted DNS answer into the outbound transport', async () => {
    const fetchHop = vi.fn(async () => ({
      response: new Response('image', { headers: { 'content-type': 'image/png' } }),
      close: async () => undefined,
    }));

    const result = await fetchPublicImage('https://images.example/image.png', {
      resolveHost: async () => [{ address: '198.51.100.77', family: 4 }],
      fetchHop,
    });

    expect(result?.arrayBuffer.byteLength).toBeGreaterThan(0);
    expect(fetchHop).toHaveBeenCalledWith(expect.any(URL), '198.51.100.77', 1500);
  });

  it('tries another vetted DNS address after a connection failure', async () => {
    const fetchHop = vi.fn()
      .mockRejectedValueOnce(new Error('edge unavailable'))
      .mockResolvedValueOnce({
        response: new Response('document', { headers: { 'content-type': 'text/plain' } }),
        close: async () => undefined,
      });
    const result = await fetchPublicBytes('https://news.example/story', {
      maxBytes: 1024,
      resolveHost: async () => [
        { address: '198.51.100.10', family: 4 },
        { address: '198.51.100.11', family: 4 },
      ],
      fetchHop,
    });
    expect(result?.bytes.byteLength).toBeGreaterThan(0);
    expect(fetchHop).toHaveBeenNthCalledWith(1, expect.any(URL), '198.51.100.10', 1500, undefined, undefined);
    expect(fetchHop).toHaveBeenNthCalledWith(2, expect.any(URL), '198.51.100.11', 1500, undefined, undefined);
  });

  it('stops public document reads at their byte budget', async () => {
    const close = vi.fn(async () => undefined);
    const result = await fetchPublicBytes('https://news.example/story', {
      maxBytes: 64,
      allowedContentTypes: ['text/html'],
      resolveHost: async () => [{ address: '198.51.100.77', family: 4 }],
      fetchHop: async () => ({
        response: new Response('x'.repeat(1024), {
          headers: { 'content-type': 'text/html; charset=utf-8' },
        }),
        close,
      }),
    });

    expect(result?.bytes.byteLength).toBe(64);
    expect(result?.truncated).toBe(true);
    expect(close).toHaveBeenCalledOnce();
  });

  it('cancels a public document read as soon as its completion predicate succeeds', async () => {
    const cancel = vi.fn();
    const firstChunk = new Uint8Array(24);
    firstChunk.set([0x89, 0x50, 0x4e, 0x47]);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(firstChunk);
        controller.enqueue(new Uint8Array(1024));
      },
      cancel,
    });
    const result = await fetchPublicBytes('https://news.example/image.png', {
      maxBytes: 2048,
      allowedContentTypes: ['image/'],
      stopWhen: (bytes) => bytes.byteLength >= 24,
      resolveHost: async () => [{ address: '198.51.100.77', family: 4 }],
      fetchHop: async () => ({
        response: new Response(stream, { headers: { 'content-type': 'image/png' } }),
        close: async () => undefined,
      }),
    });

    expect(result?.bytes.byteLength).toBe(24);
    expect(result?.truncated).toBe(false);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('enforces HTTPS across public document redirects', async () => {
    const fetchHop = vi.fn(async () => ({
      response: new Response(null, { status: 302, headers: { location: 'http://news.example/feed.xml' } }),
      close: async () => undefined,
    }));

    await expect(fetchPublicBytes('https://news.example/feed.xml', {
      maxBytes: 1024,
      requireHttps: true,
      resolveHost: async () => [{ address: '198.51.100.77', family: 4 }],
      fetchHop,
    })).resolves.toBeNull();

    expect(fetchHop).toHaveBeenCalledOnce();
  });

  it('rejects public document redirects to private networks before connecting', async () => {
    const fetchHop = vi.fn(async () => ({
      response: new Response(null, { status: 302, headers: { location: 'https://private.example/feed.xml' } }),
      close: async () => undefined,
    }));
    const resolver = vi.fn(async (hostname: string) => hostname === 'private.example'
      ? [{ address: '10.0.0.9', family: 4 as const }]
      : [{ address: '198.51.100.77', family: 4 as const }]);

    await expect(fetchPublicBytes('https://news.example/feed.xml', {
      maxBytes: 1024,
      requireHttps: true,
      resolveHost: resolver,
      fetchHop,
    })).resolves.toBeNull();

    expect(fetchHop).toHaveBeenCalledOnce();
    expect(resolver).toHaveBeenNthCalledWith(2, 'private.example');
  });
});

describe('CSP report privacy', () => {
  it('retains only directive and origins', () => {
    expect(parseCspReport({
      'csp-report': {
        'effective-directive': 'script-src-elem',
        'blocked-uri': 'https://unexpected.example/script.js?token=secret',
        'source-file': 'https://seraphi.me/account?email=user@example.com',
        'script-sample': 'sensitive inline content',
      },
    })).toEqual({
      effectiveDirective: 'script-src-elem',
      blockedOrigin: 'https://unexpected.example',
      sourceOrigin: 'https://seraphi.me',
    });
  });

  it('normalizes malformed report fields', () => {
    expect(parseCspReport({
      effectiveDirective: 'not valid!',
      blockedURL: 'data:text/html,private',
      sourceFile: 'inline',
    })).toEqual({
      effectiveDirective: 'unknown',
      blockedOrigin: 'data:',
      sourceOrigin: 'inline',
    });
    expect(parseCspReport(null)).toBeNull();
  });
});

describe('backend hardening primitives', () => {
  it('enforces every local rate-limit key and expires bounded windows', () => {
    const limiter = createLocalFixedWindowLimiter({ limit: 2, windowMs: 1_000, maxEntries: 2 });
    expect(limiter.check(['net:1', 'user:1'], 1).success).toBe(true);
    expect(limiter.check(['net:2', 'user:1'], 2).success).toBe(true);
    const denied = limiter.check(['net:3', 'user:1'], 3);
    expect(denied).toMatchObject({ success: false, retryAfterSeconds: 1 });
    limiter.check(['net:4'], 2_000);
    expect(limiter.size()).toBeLessThanOrEqual(2);
  });

  it('coalesces identical work and clears rejected promises', async () => {
    const singleFlight = createSingleFlight(2);
    const load = vi.fn(async () => 42);
    await expect(Promise.all([
      singleFlight.run('same', load),
      singleFlight.run('same', load),
    ])).resolves.toEqual([42, 42]);
    expect(load).toHaveBeenCalledOnce();

    await expect(singleFlight.run('failed', async () => { throw new Error('failed'); })).rejects.toThrow('failed');
    await expect(singleFlight.run('failed', async () => 7)).resolves.toBe(7);
    expect(singleFlight.size()).toBe(0);
  });

  it('enforces structural CSP while reporting the complete production policy', () => {
    expect(CSP_ENFORCED_BASELINE).toContain("object-src 'none'");
    expect(CSP_ENFORCED_BASELINE).not.toContain('script-src');
    expect(buildCspReportOnly('production')).toContain("script-src 'self' 'unsafe-inline'");
    expect(buildCspReportOnly('production')).not.toContain("'unsafe-eval'");
    expect(buildCspReportOnly('development')).toContain("'unsafe-eval'");
    expect(buildCspReportOnly('production')).toContain('https://va.vercel-scripts.com');
    expect(buildCspReportOnly('production')).toContain('https://protomaps.github.io');
    expect(buildCspReportOnly('production')).toContain('https://tiles.seraphi.me');
    expect(buildCspReportOnly('production')).toContain('https://tiles.openstreetmap.us');
    expect(buildCspReportOnly('production')).toContain('https://a.tile.opentopomap.org');
    expect(buildCspReportOnly('production')).not.toContain('report-uri /api/csp-report');
    expect(buildCspReportOnly('production', true)).toContain('report-uri /api/csp-report');
    expect(buildCspReportOnly('development', true)).not.toContain('report-uri /api/csp-report');
  });
});
