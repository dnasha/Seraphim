import { NextResponse } from 'next/server';

import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/core/supabase-admin';
import { getConfiguredSiteUrl } from '@/lib/security/payments';
import { checkSensitiveRateLimit, hasValidSameOrigin } from '@/lib/security/sensitiveRequest';
import { retireCheckoutReservation } from '@/lib/server/checkoutReservations';
import { recordMetric } from '@/lib/server/operations';

export async function POST(request: Request) {
  const origin = getConfiguredSiteUrl();
  if (!origin || !hasValidSameOrigin(request, origin)) {
    return NextResponse.json({ code: 'invalid_origin', error: 'Request rejected.' }, { status: 403 });
  }

  let body: { intentId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ code: 'invalid_request', error: 'Invalid request.' }, { status: 400 });
  }
  if (!body.intentId) {
    return NextResponse.json({ code: 'invalid_request', error: 'Invalid request.' }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ code: 'unauthorized', error: 'Unauthorized' }, { status: 401 });
  }

  const rateLimit = await checkSensitiveRateLimit(request, user.id);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { code: 'rate_limited', error: 'Please try again shortly.' },
      { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } },
    );
  }

  const { data: intent, error } = await supabaseAdmin
    .from('billing_checkout_intents')
    .select('id, status, stripe_session_id')
    .eq('id', body.intentId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (error) {
    return NextResponse.json({ code: 'checkout_unavailable', error: 'Unable to cancel checkout.' }, { status: 503 });
  }
  if (!intent || intent.status !== 'open') {
    return NextResponse.json({ cancelled: false });
  }

  const cancelled = await retireCheckoutReservation({
    intent_id: intent.id,
    intent_status: intent.status,
    existing_session_id: intent.stripe_session_id,
  }, user.id, {
    expireOpenSession: true,
    failureCode: 'customer_cancelled',
  });
  if (!cancelled) {
    return NextResponse.json({ code: 'checkout_conflict', error: 'Unable to cancel checkout.' }, { status: 409 });
  }

  await recordMetric({ kind: 'operational', service: 'billing', name: 'checkout_cancelled' });
  return NextResponse.json({ cancelled: true });
}
