import type { NextConfig } from "next";
import withSerwistInit from "@serwist/next";

process.env.SERWIST_SUPPRESS_TURBOPACK_WARNING = "1";

const withSerwist = withSerwistInit({
  swSrc: "src/app/sw.ts",
  swDest: "public/sw.js",
  register: true,
  cacheOnNavigation: true,
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
