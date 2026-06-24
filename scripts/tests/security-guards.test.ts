import { describe, expect, it, vi } from 'vitest';
import { validateNewsSearchParams } from '@/lib/security/newsParams';
import { safeRelativeRedirect } from '@/lib/security/redirects';
import { canFulfillAngelCheckout, getConfiguredSiteUrl, isPaymentsEnabled } from '@/lib/security/payments';
import { parseProxyCoordinate, validateTilePath } from '@/lib/security/proxyGuards';
import { fetchPublicImage, isPublicIpAddress, validatePublicImageUrl } from '@/lib/security/ogImage';
import { getTrustedClientIp } from '@/lib/security/clientIdentity';

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
  });
});

describe('payment guards', () => {
  it('requires explicit payments flag', () => {
    expect(isPaymentsEnabled({ PAYMENTS_ENABLED: 'true' })).toBe(true);
    expect(isPaymentsEnabled({ PAYMENTS_ENABLED: 'false' })).toBe(false);
    expect(isPaymentsEnabled({})).toBe(false);
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
});
