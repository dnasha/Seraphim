import { NextResponse } from 'next/server';
import { canUseMapStyle } from '@/lib/entitlements';
import { resolveRequestEntitlements } from '@/lib/server/entitlements';
import { getMapLibreStyleForServer, MAP_STYLES } from '@/components/map/MapConstants';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ style: string }> },
) {
  const { style } = await params;
  if (!Object.prototype.hasOwnProperty.call(MAP_STYLES, style)) {
    return NextResponse.json({ error: 'Unknown map style' }, { status: 404 });
  }

  const access = await resolveRequestEntitlements();
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
