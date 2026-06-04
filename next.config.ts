import type { NextConfig } from "next";
import type { ManifestEntry } from "@serwist/build";
import withSerwistInit from "@serwist/next";

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
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '*.bbci.co.uk' },
      { protocol: 'https', hostname: '*.gnews.io' },
      { protocol: 'https', hostname: '*.redd.it' },
      { protocol: 'https', hostname: '*.static.com' }, // Generic placeholder for others
      { protocol: 'https', hostname: 't.me' },
      { protocol: 'https', hostname: '*.twimg.com' },
    ],
  },
  devIndicators: false,
  ...(process.env.NODE_ENV === 'development' && { allowedDevOrigins: ['*'] }),
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default withSerwist(nextConfig);
