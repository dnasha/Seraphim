import { NextResponse } from 'next/server';

import { createClient } from '@/lib/supabase/server';
import { stripe } from '@/lib/stripe';
import { getConfiguredSiteUrl, isBillingPortalEnabled } from '@/lib/security/payments';
import { checkSensitiveRateLimit, hasValidSameOrigin } from '@/lib/security/sensitiveRequest';
import { resolveEffectiveProfile } from '@/lib/server/effectiveProfile';
import { recordIncident, recordMetric } from '@/lib/server/operations';

export async function POST(request: Request = new Request('http://localhost', { method: 'POST' })) {
  const origin = getConfiguredSiteUrl();
  if (!origin || !isBillingPortalEnabled()) {
    return NextResponse.json({ code: 'portal_disabled', error: 'Billing management is unavailable.' }, { status: 503 });
  }
  if (!hasValidSameOrigin(request, origin)) {
    return NextResponse.json({ code: 'invalid_origin', error: 'Request rejected.' }, { status: 403 });
  }

  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ code: 'unauthorized', error: 'Unauthorized' }, { status: 401 });
  }
  const rateLimit = await checkSensitiveRateLimit(request, user.id);
  if (!rateLimit.allowed) {
    return NextResponse.json({ code: 'rate_limited', error: 'Please try again shortly.' }, { status: 429 });
  }

  try {
    const profile = await resolveEffectiveProfile(user.id);
    if (!profile.stripeCustomerId) {
      return NextResponse.json({ code: 'billing_account_missing', error: 'No billing account found.' }, { status: 404 });
    }
    const session = await stripe.billingPortal.sessions.create({
      customer: profile.stripeCustomerId,
      return_url: `${origin}/account`,
    });
    await recordMetric({ kind: 'operational', service: 'billing', name: 'portal_opened' });
    return NextResponse.json({ url: session.url });
  } catch {
    await recordIncident({
      dedupKey: 'billing:portal-creation',
      service: 'billing',
      type: 'portal_creation_failed',
      severity: 'warning',
    });
    return NextResponse.json({ code: 'portal_failed', error: 'Unable to open billing management.' }, { status: 503 });
  }
}
