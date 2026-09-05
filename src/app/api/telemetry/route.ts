import { NextRequest, NextResponse } from 'next/server';
import { recordMetric } from '@/lib/server/operations';
import { hasValidSameOrigin } from '@/lib/security/sensitiveRequest';
import { getConfiguredSiteUrl } from '@/lib/security/payments';
import { getTrustedClientIp } from '@/lib/security/clientIdentity';
import { createLocalFixedWindowLimiter } from '@/lib/security/localRateLimit';

const OPTIONAL_METRICS = new Set(['account_view', 'pricing_view', 'checkout_click', 'activation', 'map_interaction']);
const OPTIONAL_PLANS = new Set(['pro', 'analyst', 'angel']);
const OPTIONAL_INTERVALS = new Set(['month', 'year', 'lifetime']);
const OPTIONAL_SOURCES = new Set(['direct', 'pricing', 'feature_gate']);
const OPTIONAL_MILESTONES = new Set(['historical_monitoring', 'custom_window']);
const metricLimiter = createLocalFixedWindowLimiter({ limit: 30, windowMs: 60_000 });

function acceptMetric(request: NextRequest) {
  const key = getTrustedClientIp(request.headers) ?? (process.env.NODE_ENV === 'development' ? 'local' : null);
  if (!key) return false;
  return metricLimiter.check([key]).success;
}

export async function POST(request: NextRequest) {
  const origin = getConfiguredSiteUrl();
  if (!origin || !hasValidSameOrigin(request, origin)) {
    return NextResponse.json({ error: 'Invalid origin' }, { status: 403 });
  }
  if (!acceptMetric(request)) {
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: 429, headers: { 'Retry-After': '60' } },
    );
  }

  const body = await request.json().catch(() => null) as {
    name?: unknown;
    plan?: unknown;
    interval?: unknown;
    source?: unknown;
    milestone?: unknown;
  } | null;
  if (!body || typeof body.name !== 'string' || !OPTIONAL_METRICS.has(body.name)) {
    return NextResponse.json({ error: 'Invalid metric' }, { status: 400 });
  }
  if (body.plan !== undefined && (typeof body.plan !== 'string' || !OPTIONAL_PLANS.has(body.plan))) {
    return NextResponse.json({ error: 'Invalid metric dimensions' }, { status: 400 });
  }
  if (body.interval !== undefined && (typeof body.interval !== 'string' || !OPTIONAL_INTERVALS.has(body.interval))) {
    return NextResponse.json({ error: 'Invalid metric dimensions' }, { status: 400 });
  }
  if (body.source !== undefined && (typeof body.source !== 'string' || !OPTIONAL_SOURCES.has(body.source))) {
    return NextResponse.json({ error: 'Invalid metric dimensions' }, { status: 400 });
  }
  if (body.milestone !== undefined && (typeof body.milestone !== 'string' || !OPTIONAL_MILESTONES.has(body.milestone))) {
    return NextResponse.json({ error: 'Invalid metric dimensions' }, { status: 400 });
  }

  const metricName = [body.name, body.plan, body.interval, body.source, body.milestone]
    .filter((value): value is string => typeof value === 'string')
    .join('.');

  await recordMetric({
    kind: 'conversion',
    service: 'web',
    name: `analytics.${metricName}`,
  });
  return new NextResponse(null, { status: 204 });
}
