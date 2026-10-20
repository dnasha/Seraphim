import { NextResponse } from 'next/server';
import { getRateLimitKeys, getTrustedClientIp } from '@/lib/security/clientIdentity';
import { createRequestRateLimiter } from '@/lib/security/requestRateLimit';
import { canUseMapStyle } from '@/lib/entitlements';
import { resolveRequestEntitlements } from '@/lib/server/entitlements';
import { getMapLibreStyleForServer, MAP_STYLES } from '@/components/map/MapConstants';

const requestRateLimit = createRequestRateLimiter({
  prefix: '@upstash/ratelimit/seraphim-map-style', limit: 60, localLimit: 20,
});

export async function GET(
  request: Request,
  { params }: { params: Promise<{ style: string }> },
) {
  const { style } = await params;
  if (!Object.prototype.hasOwnProperty.call(MAP_STYLES, style)) {
    return NextResponse.json({ error: 'Unknown map style' }, { status: 404 });
  }

  const clientIp = getTrustedClientIp(request.headers);
  if (!clientIp) return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  const networkLimit = await requestRateLimit.check(getRateLimitKeys(clientIp));
  if (!networkLimit.allowed) return NextResponse.json({ error: 'Too many requests' }, {
    status: 429, headers: { 'Retry-After': String(networkLimit.retryAfterSeconds) },
  });
  const access = await resolveRequestEntitlements();
  if (access.userId) {
    const accountLimit = await requestRateLimit.check([`user:${access.userId}`]);
    if (!accountLimit.allowed) return NextResponse.json({ error: 'Too many requests' }, {
      status: 429, headers: { 'Retry-After': String(accountLimit.retryAfterSeconds) },
    });
  }
  if (!canUseMapStyle(access.tier, style)) {
    return NextResponse.json(
      { error: 'This map style requires Pro', code: 'feature_required', requiredTier: 'pro' },
      { status: 403 },
    );
  }

  const mapTilerKey = process.env.MAPTILER_API_KEY;
  const mapTilerPath = style === 'satellite' ? 'hybrid' : style === 'topographic' ? 'topo-v2' : null;
  const payload = mapTilerKey && mapTilerPath
    ? `https://api.maptiler.com/maps/${mapTilerPath}/style.json?key=${encodeURIComponent(mapTilerKey)}`
    : getMapLibreStyleForServer(style);
  if (typeof payload === 'string') {
    const upstream = await fetch(payload, { next: { revalidate: 3600 } });
    if (!upstream.ok) {
      return NextResponse.json({ error: 'Map style is unavailable' }, { status: 502 });
    }
    return NextResponse.json(await upstream.json(), { headers: { 'Cache-Control': 'private, no-store' } });
  }

  return NextResponse.json(payload, { headers: { 'Cache-Control': 'private, no-store' } });
}
