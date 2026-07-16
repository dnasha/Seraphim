import type { NextConfig } from "next";
import type { ManifestEntry } from "@serwist/build";
import withSerwistInit from "@serwist/next";
import { NEWS_IMAGE_HOSTS } from "./src/lib/utils/newsImages";

process.env.SERWIST_SUPPRESS_TURBOPACK_WARNING = "1";

type SizedManifestEntry = ManifestEntry & { size: number };

const excludeVolatileNextAssets = (entries: SizedManifestEntry[]) => ({
  manifest: entries.filter((entry) => {
    const url = entry.url;
    return !(
      url.includes("static/chunks/") ||
      /static\/.+\/(?:_buildManifest|_ssgManifest)\.js$/.test(url)
    );
  }),
  warnings: [],
});

const cspReportOnly = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://challenges.cloudflare.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.maptiler.com https://challenges.cloudflare.com https://vitals.vercel-insights.com",
  "worker-src 'self' blob:",
  "child-src 'self' blob:",
  "frame-src https://challenges.cloudflare.com https://js.stripe.com https://hooks.stripe.com",
  "manifest-src 'self'",
  "media-src 'self' blob: https:",
  "report-uri /api/csp-report",
].join('; ');

const withSerwist = withSerwistInit({
  swSrc: "src/app/sw.ts",
  swDest: "public/sw.js",
  register: true,
  cacheOnNavigation: false,
  reloadOnOnline: false,
  exclude: [
    /\.map$/,
    /^manifest.*\.js$/,
    /(?:^|\/)static\/chunks\/.*\.js$/,
    /(?:^|\/)(?:_buildManifest|_ssgManifest)\.js$/,
  ],
  manifestTransforms: [excludeVolatileNextAssets],
  disable: process.env.NODE_ENV === "development",
});

const nextConfig: NextConfig = {
  turbopack: {},
  compiler: {
    removeConsole: process.env.NODE_ENV === 'production',
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '*.gnews.io' },
      { protocol: 'https', hostname: '*.static.com' }, // Generic placeholder for others
      { protocol: 'https', hostname: 't.me' },
      { protocol: 'https', hostname: '*.twimg.com' },
      ...NEWS_IMAGE_HOSTS.map((hostname) => ({ protocol: 'https' as const, hostname })),
    ],
    formats: ['image/avif', 'image/webp'],
    minimumCacheTTL: 86_400,
  },
  devIndicators: false,
  ...(process.env.NODE_ENV === 'development' && { allowedDevOrigins: ['*'] }),
  async headers() {
    return [
      {
        source: '/api/:path*',
        headers: [
          { key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' },
        ],
      },
      {
        source: '/auth/:path*',
        headers: [
          { key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' },
        ],
      },
      {
        source: '/account/:path*',
        headers: [
          { key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' },
        ],
      },
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          { key: 'Content-Security-Policy-Report-Only', value: cspReportOnly },
        ],
      },
    ];
  },
};

export default withSerwist(nextConfig);
