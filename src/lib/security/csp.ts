export const CSP_ENFORCED_BASELINE = [
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
].join('; ');

export function buildCspReportOnly(
  nodeEnv = process.env.NODE_ENV,
  reportingEnabled = process.env.CSP_REPORTING_ENABLED === 'true',
) {
  const scriptSources = [
    "'self'",
    "'unsafe-inline'",
    ...(nodeEnv === 'development' ? ["'unsafe-eval'"] : []),
    'https://challenges.cloudflare.com',
    'https://va.vercel-scripts.com',
  ];

  const connectSources = [
    "'self'",
    'https://*.supabase.co',
    'wss://*.supabase.co',
    'https://*.maptiler.com',
    'https://challenges.cloudflare.com',
    'https://vitals.vercel-insights.com',
    'https://protomaps.github.io',
    'https://tiles.seraphi.me',
    'https://tiles.openstreetmap.us',
    'https://a.tile.opentopomap.org',
  ];

  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    `script-src ${scriptSources.join(' ')}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    `connect-src ${connectSources.join(' ')}`,
    "worker-src 'self' blob:",
    "child-src 'self' blob:",
    'frame-src https://challenges.cloudflare.com https://js.stripe.com https://hooks.stripe.com',
    "manifest-src 'self'",
    "media-src 'self' blob: https:",
    // Browser console warnings are sufficient during local development. Avoid
    // sending noisy report-only violations to the operations database.
    ...(nodeEnv !== 'development' && reportingEnabled ? ['report-uri /api/csp-report'] : []),
  ].join('; ');
}
