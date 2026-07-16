import type { Metadata } from 'next';

export const DEFAULT_SITE_ORIGIN = 'https://www.seraphi.me';
export const SITE_NAME = 'Seraphim';
export const HOME_TITLE = 'Seraphim | Live Global News Map & OSINT';
export const HOME_DESCRIPTION =
  'Know the world as it happens. Seraphim maps and clusters breaking news and open-source intelligence in real time so you can follow events and their sources.';
export const SOCIAL_PROFILES = [
  'https://github.com/dnasha/Seraphim',
  'https://x.com/seraphimosint',
  'https://www.youtube.com/@seraphimosint',
] as const;

export const SHARED_SOCIAL_IMAGE = {
  url: '/opengraph-image.png',
  width: 1200,
  height: 630,
  alt: 'Seraphim live global intelligence map',
} as const;

type EnvLike = Record<string, string | undefined>;

export function getSiteOrigin(env: EnvLike = process.env) {
  const raw = env.SITE_URL || env.NEXT_PUBLIC_SITE_URL;
  if (!raw) return DEFAULT_SITE_ORIGIN;

  try {
    const url = new URL(raw);
    const isLocal = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    if ((url.protocol !== 'https:' && !isLocal) || url.username || url.password) {
      return DEFAULT_SITE_ORIGIN;
    }
    if (url.hostname === 'seraphi.me') {
      url.hostname = 'www.seraphi.me';
    }
    return url.origin;
  } catch {
    return DEFAULT_SITE_ORIGIN;
  }
}

export function absoluteSiteUrl(path = '/', env: EnvLike = process.env) {
  return new URL(path, `${getSiteOrigin(env)}/`).toString();
}

export function createPageMetadata(input: {
  title: string;
  description: string;
  path: string;
}): Metadata {
  const url = absoluteSiteUrl(input.path);
  return {
    title: input.title,
    description: input.description,
    alternates: { canonical: url },
    openGraph: {
      title: `${input.title} | ${SITE_NAME}`,
      description: input.description,
      url,
      siteName: SITE_NAME,
      locale: 'en_US',
      type: 'website',
      images: [SHARED_SOCIAL_IMAGE],
    },
    twitter: {
      card: 'summary_large_image',
      title: `${input.title} | ${SITE_NAME}`,
      description: input.description,
      images: [SHARED_SOCIAL_IMAGE.url],
    },
  };
}

export function serializeJsonLd(value: unknown) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

export function buildWebsiteJsonLd(env: EnvLike = process.env) {
  const origin = getSiteOrigin(env);
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': `${origin}/#organization`,
        name: SITE_NAME,
        url: `${origin}/`,
        logo: absoluteSiteUrl('/icon-512x512.png', env),
        sameAs: [...SOCIAL_PROFILES],
      },
      {
        '@type': 'WebSite',
        '@id': `${origin}/#website`,
        name: SITE_NAME,
        url: `${origin}/`,
        description: HOME_DESCRIPTION,
        publisher: { '@id': `${origin}/#organization` },
        inLanguage: 'en-US',
      },
    ],
  };
}

export interface SoftwareOfferTier {
  name: string;
  monthlyPrice: number;
  yearlyPrice: number;
  isLifetime: boolean;
  lifetimePrice: number;
}

export function buildSoftwareApplicationJsonLd(
  tiers: SoftwareOfferTier[],
  env: EnvLike = process.env,
) {
  const pricingUrl = absoluteSiteUrl('/pricing', env);
  const offers = tiers.flatMap((tier) => {
    if (tier.isLifetime) {
      return [{
        '@type': 'Offer',
        name: `${tier.name} Lifetime`,
        price: tier.lifetimePrice.toFixed(2),
        priceCurrency: 'USD',
        url: pricingUrl,
      }];
    }

    if (tier.monthlyPrice === 0 && tier.yearlyPrice === 0) {
      return [{
        '@type': 'Offer',
        name: tier.name,
        price: '0.00',
        priceCurrency: 'USD',
        url: pricingUrl,
      }];
    }

    return [
      {
        '@type': 'Offer',
        name: `${tier.name} Monthly`,
        price: tier.monthlyPrice.toFixed(2),
        priceCurrency: 'USD',
        url: pricingUrl,
      },
      {
        '@type': 'Offer',
        name: `${tier.name} Yearly`,
        price: tier.yearlyPrice.toFixed(2),
        priceCurrency: 'USD',
        url: pricingUrl,
      },
    ];
  });

  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: SITE_NAME,
    url: `${getSiteOrigin(env)}/`,
    applicationCategory: 'NewsApplication',
    operatingSystem: 'Web',
    description: HOME_DESCRIPTION,
    isAccessibleForFree: true,
    offers,
  };
}
