import { NextRequest, NextResponse } from 'next/server';

import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/core/supabase-admin';
import { stripe, STRIPE_PRICES, ANGEL_MAX_QUANTITY } from '@/lib/stripe';
import {
  getConfiguredSiteUrl,
  isAngelCheckoutEnabled,
  isCheckoutEnabled,
} from '@/lib/security/payments';
import { checkSensitiveRateLimit, hasValidSameOrigin } from '@/lib/security/sensitiveRequest';
import { recordIncident, recordMetric } from '@/lib/server/operations';

type PriceKey = keyof typeof STRIPE_PRICES;
type IntentReservation = {
  intent_id: string | null;
  intent_status: string | null;
  existing_session_id: string | null;
  correlation_id: string | null;
  expires_at: string | null;
  result_code: string;
};

const RESPONSE_STATUS: Record<string, number> = {
  subscription_exists: 409,
  checkout_conflict: 409,
  angel_already_owned: 409,
  angel_sold_out: 410,
};
const SUBSCRIPTION_TRIAL_DAYS = 14;

function checkoutError(code: string, status = RESPONSE_STATUS[code] ?? 409) {
  const messages: Record<string, string> = {
    subscription_exists: 'Manage your existing subscription from the billing portal.',
    checkout_conflict: 'Another checkout is already in progress.',
    angel_already_owned: 'Angel access is already active for this account.',
    angel_sold_out: 'Angel access is currently sold out.',
  };
  return NextResponse.json({ code, error: messages[code] ?? 'Unable to start checkout.' }, { status });
}

async function getAngelMaxQuantity(priceId: string) {
  try {
    const price = await stripe.prices.retrieve(priceId, { expand: ['product'] });
    const product = price.product as { metadata?: Record<string, string> };
    const configured = Number.parseInt(product.metadata?.inventory ?? '', 10);
    if (Number.isFinite(configured) && configured > 0) {
      return Math.min(configured, ANGEL_MAX_QUANTITY);
    }
  } catch {
    // The database reservation still enforces the application maximum.
  }
  return ANGEL_MAX_QUANTITY;
}

export async function POST(request: NextRequest) {
  const origin = getConfiguredSiteUrl();
  if (!origin) {
    return NextResponse.json({ code: 'configuration_error', error: 'Checkout is unavailable.' }, { status: 503 });
  }
  if (!hasValidSameOrigin(request, origin)) {
    return NextResponse.json({ code: 'invalid_origin', error: 'Request rejected.' }, { status: 403 });
  }

  let body: { priceKey?: string; returnTo?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ code: 'invalid_request', error: 'Invalid request.' }, { status: 400 });
  }

  if (!body.priceKey || !(body.priceKey in STRIPE_PRICES)) {
    return NextResponse.json({ code: 'invalid_price', error: 'Invalid price.' }, { status: 400 });
  }

  const priceKey = body.priceKey as PriceKey;
  const isAngel = priceKey === 'angel';
  if ((!isAngel && !isCheckoutEnabled()) || (isAngel && !isAngelCheckoutEnabled())) {
    return NextResponse.json({ code: 'payments_disabled', error: 'Payments are currently disabled.' }, { status: 503 });
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

  const priceId = STRIPE_PRICES[priceKey];
  if (!priceId) {
    return NextResponse.json({ code: 'configuration_error', error: 'Checkout is unavailable.' }, { status: 503 });
  }

  const returnTo = body.returnTo?.startsWith('/') && !body.returnTo.startsWith('//')
    ? body.returnTo
    : '/';
  const maxAngel = isAngel ? await getAngelMaxQuantity(priceId) : ANGEL_MAX_QUANTITY;
  const mode = isAngel ? 'payment' : 'subscription';

  const { data: reservationRows, error: reservationError } = await supabaseAdmin.rpc(
    'reserve_billing_checkout_intent',
    {
      p_user_id: user.id,
      p_price_key: priceKey,
      p_mode: mode,
      p_max_angel: maxAngel,
    },
  );
  if (reservationError || !Array.isArray(reservationRows) || !reservationRows[0]) {
    await recordIncident({
      dedupKey: 'billing:checkout-reservation',
      service: 'billing',
      type: 'checkout_reservation_failed',
      severity: 'critical',
    });
    return NextResponse.json({ code: 'checkout_unavailable', error: 'Checkout is unavailable.' }, { status: 503 });
  }

  const reservation = reservationRows[0] as IntentReservation;
  if (reservation.result_code === 'existing') {
    if (!reservation.existing_session_id) return checkoutError('checkout_conflict');
    try {
      const existing = await stripe.checkout.sessions.retrieve(reservation.existing_session_id);
      if (existing.status === 'open' && existing.url) {
        return NextResponse.json({ url: existing.url, reused: true });
      }
    } catch {
      // Fall through to a safe conflict; the expiry webhook/reconciliation closes it.
    }
    return checkoutError('checkout_conflict');
  }
  if (reservation.result_code !== 'created' || !reservation.intent_id || !reservation.correlation_id) {
    return checkoutError(reservation.result_code);
  }

  const intentId = reservation.intent_id;
  const correlationId = reservation.correlation_id;

  try {
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('user_profiles')
      .select('stripe_customer_id')
      .eq('id', user.id)
      .single();
    if (profileError) throw profileError;

    let customerId = profile?.stripe_customer_id as string | null;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: { supabase_user_id: user.id },
      }, { idempotencyKey: `seraphim-customer-${user.id}` });
      customerId = customer.id;
      const { error: updateError } = await supabaseAdmin
        .from('user_profiles')
        .update({ stripe_customer_id: customerId })
        .eq('id', user.id);
      if (updateError) throw updateError;
    }

    const commonMetadata = {
      supabase_user_id: user.id,
      price_key: priceKey,
      checkout_intent_id: intentId,
      correlation_id: correlationId,
    };
    const automaticTaxEnabled = process.env.STRIPE_AUTOMATIC_TAX_ENABLED === 'true';
    const promotionCodesEnabled = process.env.STRIPE_PROMOTION_CODES_ENABLED === 'true';
    const separator = returnTo.includes('?') ? '&' : '?';
    const sessionParams: Parameters<typeof stripe.checkout.sessions.create>[0] = {
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      mode,
      success_url: `${origin}${returnTo}${separator}checkout=success`,
      cancel_url: `${origin}${returnTo}${separator}checkout=cancelled`,
      metadata: commonMetadata,
      expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
      ...(promotionCodesEnabled ? { allow_promotion_codes: true } : {}),
      ...(automaticTaxEnabled
        ? {
            automatic_tax: { enabled: true },
            billing_address_collection: 'required' as const,
            customer_update: { address: 'auto' as const },
          }
        : {}),
      ...(isAngel
        ? { payment_intent_data: { metadata: commonMetadata } }
        : {
            subscription_data: {
              trial_period_days: SUBSCRIPTION_TRIAL_DAYS,
              metadata: commonMetadata,
            },
          }),
    };

    const session = await stripe.checkout.sessions.create(sessionParams, {
      idempotencyKey: `checkout-intent-${intentId}`,
    });
    if (!session.url) throw new Error('checkout_url_missing');

    const { error: intentUpdateError } = await supabaseAdmin
      .from('billing_checkout_intents')
      .update({
        status: 'open',
        stripe_session_id: session.id,
        expires_at: new Date(session.expires_at * 1000).toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', intentId)
      .eq('status', 'creating');
    if (intentUpdateError) throw intentUpdateError;

    await recordMetric({ kind: 'operational', service: 'billing', name: 'checkout_started' });
    await recordMetric({ kind: 'conversion', service: 'billing', name: `checkout_started.${priceKey}` });
    return NextResponse.json({ url: session.url });
  } catch {
    await supabaseAdmin
      .from('billing_checkout_intents')
      .update({ status: 'failed', failure_code: 'checkout_creation_failed', updated_at: new Date().toISOString() })
      .eq('id', intentId);
    await recordIncident({
      dedupKey: 'billing:checkout-creation',
      service: 'billing',
      type: 'checkout_creation_failed',
      severity: 'critical',
      correlationId,
    });
    return NextResponse.json({ code: 'checkout_failed', error: 'Unable to start checkout.' }, { status: 503 });
  }
}
