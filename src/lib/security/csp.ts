export const CSP_ENFORCED_BASELINE = [
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
].join('; ');

export function buildCspReportOnly(nodeEnv = process.env.NODE_ENV) {
  const scriptSources = [
    "'self'",
    "'unsafe-inline'",
    ...(nodeEnv === 'development' ? ["'unsafe-eval'"] : []),
    'https://challenges.cloudflare.com',
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
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.maptiler.com https://challenges.cloudflare.com https://vitals.vercel-insights.com",
    "worker-src 'self' blob:",
    "child-src 'self' blob:",
    'frame-src https://challenges.cloudflare.com https://js.stripe.com https://hooks.stripe.com',
    "manifest-src 'self'",
    "media-src 'self' blob: https:",
    'report-uri /api/csp-report',
  ].join('; ');
}
