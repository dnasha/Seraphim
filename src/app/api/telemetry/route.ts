import { NextRequest, NextResponse } from 'next/server';
import { recordMetric } from '@/lib/server/operations';
import { hasValidSameOrigin } from '@/lib/security/sensitiveRequest';
import { getConfiguredSiteUrl } from '@/lib/security/payments';
import { getTrustedClientIp } from '@/lib/security/clientIdentity';

const OPTIONAL_METRICS = new Set(['account_view', 'checkout_click', 'map_interaction']);
const localBuckets = new Map<string, { count: number; resetAt: number }>();

function acceptMetric(request: NextRequest) {
  const key = getTrustedClientIp(request.headers) ?? (process.env.NODE_ENV === 'development' ? 'local' : null);
  if (!key) return false;
  const now = Date.now();
  const bucket = localBuckets.get(key);
  if (!bucket || now >= bucket.resetAt) {
    localBuckets.set(key, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  bucket.count += 1;
  return bucket.count <= 30;
}

export async function POST(request: NextRequest) {
  const origin = getConfiguredSiteUrl();
  if (!origin || !hasValidSameOrigin(request, origin)) {
    return NextResponse.json({ error: 'Invalid origin' }, { status: 403 });
  }
  if (!acceptMetric(request)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  const body = await request.json().catch(() => null) as { name?: unknown } | null;
  if (!body || typeof body.name !== 'string' || !OPTIONAL_METRICS.has(body.name)) {
    return NextResponse.json({ error: 'Invalid metric' }, { status: 400 });
  }

  await recordMetric({
    kind: 'conversion',
    service: 'web',
    name: `analytics.${body.name}`,
  });
  return new NextResponse(null, { status: 204 });
}
