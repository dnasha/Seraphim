import { afterEach, describe, expect, it, vi } from 'vitest';

import { TIERS } from '@/app/pricing/pricingConstants';
import {
  absoluteSiteUrl,
  buildSoftwareApplicationJsonLd,
  buildWebsiteJsonLd,
  createPageMetadata,
  DEFAULT_SITE_ORIGIN,
  getSiteOrigin,
  serializeJsonLd,
} from '@/lib/siteConfig';
import robots from '@/app/robots';
import sitemap from '@/app/sitemap';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('canonical site configuration', () => {
  it('uses the www production origin by default', () => {
    expect(getSiteOrigin({})).toBe(DEFAULT_SITE_ORIGIN);
    expect(absoluteSiteUrl('/', {})).toBe('https://www.seraphi.me/');
  });

  it('accepts safe self-hosted and local origins', () => {
    expect(getSiteOrigin({ SITE_URL: 'https://example.com/path' })).toBe('https://example.com');
    expect(getSiteOrigin({ NEXT_PUBLIC_SITE_URL: 'http://localhost:3000/path' })).toBe('http://localhost:3000');
  });

  it('normalizes the legacy apex production origin to www', () => {
    expect(getSiteOrigin({ SITE_URL: 'https://seraphi.me' })).toBe(DEFAULT_SITE_ORIGIN);
  });

  it('rejects unsafe or malformed origins', () => {
    expect(getSiteOrigin({ SITE_URL: 'http://example.com' })).toBe(DEFAULT_SITE_ORIGIN);
    expect(getSiteOrigin({ SITE_URL: 'https://user:pass@example.com' })).toBe(DEFAULT_SITE_ORIGIN);
    expect(getSiteOrigin({ SITE_URL: 'not a url' })).toBe(DEFAULT_SITE_ORIGIN);
  });

  it('builds page metadata with an absolute canonical', () => {
    vi.stubEnv('SITE_URL', 'https://www.seraphi.me');
    const metadata = createPageMetadata({
      title: 'Pricing & Plans',
      description: 'Description',
      path: '/pricing',
    });

    expect(metadata.alternates).toEqual({ canonical: 'https://www.seraphi.me/pricing' });
    expect(metadata.openGraph).toMatchObject({
      title: 'Pricing & Plans | Seraphim',
      url: 'https://www.seraphi.me/pricing',
    });
  });
});

describe('crawler discovery files', () => {
  it('lists only canonical www URLs without fabricated freshness fields', () => {
    vi.stubEnv('SITE_URL', 'https://www.seraphi.me');
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://www.seraphi.me');

    const entries = sitemap();
    expect(entries.map((entry) => entry.url)).toEqual([
      'https://www.seraphi.me/',
      'https://www.seraphi.me/pricing',
      'https://www.seraphi.me/help',
      'https://www.seraphi.me/terms',
      'https://www.seraphi.me/privacy',
    ]);
    expect(entries.every((entry) => (
      entry.lastModified === undefined &&
      entry.changeFrequency === undefined &&
      entry.priority === undefined
    ))).toBe(true);
  });

  it('publishes the canonical sitemap and retains private-route exclusions', () => {
    vi.stubEnv('SITE_URL', 'https://www.seraphi.me');
    const result = robots();

    expect(result.sitemap).toBe('https://www.seraphi.me/sitemap.xml');
    expect(result.rules).toMatchObject({
      userAgent: '*',
      disallow: ['/api/', '/auth/', '/account/'],
    });
  });
});

describe('structured data', () => {
  it('describes the canonical website and established social profiles', () => {
    const data = buildWebsiteJsonLd({});
    expect(data['@graph']).toEqual(expect.arrayContaining([
      expect.objectContaining({
        '@type': 'Organization',
        url: 'https://www.seraphi.me/',
        sameAs: expect.arrayContaining([
          'https://github.com/dnasha/Seraphim',
          'https://x.com/seraphimosint',
          'https://www.youtube.com/@seraphimosint',
        ]),
      }),
      expect.objectContaining({
        '@type': 'WebSite',
        url: 'https://www.seraphi.me/',
      }),
    ]));
  });

  it('derives software offers from the pricing tier source of truth', () => {
    const data = buildSoftwareApplicationJsonLd(TIERS, {});
    expect(data.offers).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'Free', price: '0.00' }),
      expect.objectContaining({ name: 'Pro Monthly', price: '9.99' }),
      expect.objectContaining({ name: 'Pro Yearly', price: '99.99' }),
      expect.objectContaining({ name: 'Analyst Monthly', price: '29.99' }),
      expect.objectContaining({ name: 'Analyst Yearly', price: '299.99' }),
      expect.objectContaining({ name: 'Angel Lifetime', price: '399.00' }),
    ]));
  });

  it('escapes script-breaking characters in JSON-LD', () => {
    expect(serializeJsonLd({ value: '</script>' })).toContain('\\u003c/script>');
    expect(() => JSON.parse(serializeJsonLd({ value: '</script>' }))).not.toThrow();
  });
});
