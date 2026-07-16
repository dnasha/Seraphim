import { NextResponse } from 'next/server';

import { createClient } from '@/lib/supabase/server';
import { resolveEffectiveProfile } from '@/lib/server/effectiveProfile';

export async function GET() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const profile = await resolveEffectiveProfile(user.id);
    return NextResponse.json({
      billingTier: profile.billingTier,
      effectiveTier: profile.effectiveTier,
      tierSource: profile.tierSource,
      overrideExpiresAt: profile.overrideExpiresAt,
      subscriptionStatus: profile.subscriptionStatus,
      billingInterval: profile.billingInterval,
      currentPeriodEnd: profile.currentPeriodEnd,
      trialEndsAt: profile.trialEndsAt,
      cancelAtPeriodEnd: profile.cancelAtPeriodEnd,
    }, {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch {
    return NextResponse.json({ error: 'Unable to load account profile' }, { status: 503 });
  }
}
