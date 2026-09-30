import { NextResponse } from 'next/server';
import { resolveRequestEntitlements } from '@/lib/server/entitlements';

const headers = { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow, noarchive' };

/** No event IDs, notes, packets, or query scopes cross this authorization boundary. */
export async function GET() {
  try {
    const access = await resolveRequestEntitlements();
    if (!access.userId) return NextResponse.json({ error: 'Sign in to use evidence exports.' }, { status: 401, headers });
    if (!access.entitlements.features.evidenceExport) {
      return NextResponse.json({ error: 'Evidence exports require Analyst or Angel.' }, { status: 403, headers });
    }
    return NextResponse.json({ userId: access.userId, tier: access.tier }, { headers });
  } catch {
    return NextResponse.json({ error: 'Could not verify evidence access.' }, { status: 503, headers });
  }
}
