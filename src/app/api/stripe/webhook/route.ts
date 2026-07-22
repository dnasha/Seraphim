import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';

import { stripe, tierFromPriceId, intervalFromPriceId, STRIPE_PRICES, ANGEL_MAX_QUANTITY } from '@/lib/stripe';
import { supabaseAdmin } from '@/lib/core/supabase-admin';
import { canFulfillAngelCheckout } from '@/lib/security/payments';
import { recordIncident, recordMetric, recoverIncident, serverDiagnostic } from '@/lib/server/operations';

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!;

export async function POST(request: NextRequest) {
  const body = await request.text();
  const signature = request.headers.get('stripe-signature');
  if (!signature) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  let claimed: boolean;
  try {
    claimed = await claimStripeEvent(event.id, event.type);
  } catch {
    await recordIncident({
      dedupKey: 'billing:webhook-claim',
      service: 'billing',
      type: 'webhook_claim_failed',
      severity: 'critical',
      correlationId: event.id,
    });
    return NextResponse.json({ error: 'Webhook unavailable' }, { status: 500 });
  }
  if (!claimed) return NextResponse.json({ received: true, duplicate: true });

  try {
    switch (event.type) {
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded':
        await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
        break;
      case 'checkout.session.async_payment_failed':
        await transitionCheckoutIntent(event.data.object as Stripe.Checkout.Session, 'failed', 'async_payment_failed');
        break;
      case 'checkout.session.expired':
        await transitionCheckoutIntent(event.data.object as Stripe.Checkout.Session, 'expired', 'stripe_session_expired');
        break;
      case 'customer.subscription.updated':
        await handleSubscriptionUpdated(event.data.object as Stripe.Subscription);
        break;
      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
        break;
      case 'invoice.payment_succeeded':
        await handleInvoiceSubscription(event.data.object as Stripe.Invoice, 'succeeded');
        break;
      case 'invoice.payment_failed':
        await handleInvoiceSubscription(event.data.object as Stripe.Invoice, 'failed');
        break;
      case 'refund.created':
      case 'refund.updated':
        await handleRefund(event.data.object as Stripe.Refund, event.created);
        break;
      case 'refund.failed':
        await handleFailedRefund(event.data.object as Stripe.Refund);
        break;
      case 'charge.refunded':
        await handleRefundedCharge(event.data.object as Stripe.Charge, event.created);
        break;
      case 'charge.dispute.created':
        await handleDisputeOpened(event.data.object as Stripe.Dispute, event.created);
        break;
      case 'charge.dispute.closed':
        await handleDisputeClosed(event.data.object as Stripe.Dispute, event.created);
        break;
      default:
        break;
    }
    await recordMetric({ kind: 'operational', service: 'billing', name: 'webhook_processed' });
    await recoverIncident('billing:webhook-processing');
    return NextResponse.json({ received: true });
  } catch {
    await releaseStripeEventClaim(event.id);
    const correlationId = getEventCorrelationId(event) ?? event.id;
    await recordIncident({
      dedupKey: 'billing:webhook-processing',
      service: 'billing',
      type: 'webhook_processing_failed',
      severity: 'critical',
      correlationId,
      safeContext: { eventType: event.type, stripeEventId: event.id },
    });
    serverDiagnostic('webhook_processing_failed', correlationId);
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 });
  }
}

function getEventCorrelationId(event: Stripe.Event) {
  const object = event.data.object as { metadata?: Record<string, string> };
  return object.metadata?.correlation_id ?? null;
}

async function claimStripeEvent(eventId: string, eventType: string) {
  const { error } = await supabaseAdmin
    .from('stripe_processed_events')
    .insert({ event_id: eventId, event_type: eventType });
  if (!error) return true;
  if (error.code === '23505') return false;
  throw error;
}

async function releaseStripeEventClaim(eventId: string) {
  const { error } = await supabaseAdmin
    .from('stripe_processed_events')
    .delete()
    .eq('event_id', eventId);
  if (error) serverDiagnostic('webhook_claim_release_failed', eventId);
}

function getCustomerId(customer: string | Stripe.Customer | Stripe.DeletedCustomer | null) {
  if (!customer) return null;
  return typeof customer === 'string' ? customer : customer.id;
}

async function transitionCheckoutIntent(
  session: Stripe.Checkout.Session,
  status: 'pending_payment' | 'completed' | 'expired' | 'failed',
  failureCode?: string,
) {
  const intentId = session.metadata?.checkout_intent_id;
  if (!intentId) return;
  const { error } = await supabaseAdmin
    .from('billing_checkout_intents')
    .update({
      status,
      stripe_session_id: session.id,
      stripe_payment_intent_id: typeof session.payment_intent === 'string' ? session.payment_intent : null,
      failure_code: failureCode ?? null,
      updated_at: new Date().toISOString(),
      completed_at: status === 'completed' ? new Date().toISOString() : null,
    })
    .eq('id', intentId);
  if (error) throw error;
}

async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  const userId = session.metadata?.supabase_user_id;
  const priceKey = session.metadata?.price_key;
  if (!userId || !priceKey || !(priceKey in STRIPE_PRICES)) throw new Error('checkout_metadata_missing');

  if (session.mode === 'payment' && priceKey === 'angel') {
    if (!canFulfillAngelCheckout({
      mode: session.mode,
      priceKey,
      paymentStatus: session.payment_status,
      paymentIntent: session.payment_intent,
    })) {
      await transitionCheckoutIntent(session, 'pending_payment');
      return;
    }

    const { data: profile, error: profileError } = await supabaseAdmin
      .from('user_profiles')
      .select('tier, stripe_subscription_id')
      .eq('id', userId)
      .single();
    if (profileError) throw profileError;

    if (profile?.tier !== 'angel') {
      const maxQuantity = await getAngelMaxQuantity();
      const { data: fulfilled, error } = await supabaseAdmin.rpc('fulfill_angel_purchase', {
        p_user_id: userId,
        p_stripe_payment_intent_id: session.payment_intent,
        p_stripe_customer_id: typeof session.customer === 'string' ? session.customer : null,
        p_max_quantity: maxQuantity,
      });
      if (error || fulfilled !== true) throw error ?? new Error('angel_fulfillment_failed');
    }

    if (profile?.stripe_subscription_id) {
      try {
        await stripe.subscriptions.cancel(profile.stripe_subscription_id);
      } catch (error) {
        if (!(error instanceof Stripe.errors.StripeInvalidRequestError)) throw error;
      }
      const { error: clearSubscriptionError } = await supabaseAdmin
        .from('user_profiles')
        .update({
          stripe_subscription_id: null,
          subscription_status: 'active',
          billing_interval: 'lifetime',
          cancel_at_period_end: false,
          trial_ends_at: null,
          current_period_end: null,
        })
        .eq('id', userId);
      if (clearSubscriptionError) throw clearSubscriptionError;
    }

    await transitionCheckoutIntent(session, 'completed');
    await recordMetric({ kind: 'operational', service: 'billing', name: 'angel_checkout_completed' });
    await recordMetric({ kind: 'conversion', service: 'billing', name: 'purchase_completed.angel.lifetime' });
    return;
  }

  if (session.mode === 'subscription' && session.subscription) {
    const subscriptionId = typeof session.subscription === 'string'
      ? session.subscription
      : session.subscription.id;
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    await syncSubscription(userId, subscription);
    await transitionCheckoutIntent(session, 'completed');
    await recordMetric({ kind: 'operational', service: 'billing', name: 'subscription_checkout_completed' });
    await recordMetric({ kind: 'conversion', service: 'billing', name: `checkout_completed.${priceKey}` });
    if (subscription.status === 'trialing') {
      await recordMetric({ kind: 'conversion', service: 'billing', name: `trial_started.${priceKey}` });
    }
  }
}

type AngelTransition = 'refund_succeeded' | 'dispute_opened' | 'dispute_won' | 'dispute_lost';
type AngelTransitionResult = {
  result_code: 'transitioned' | 'deferred' | 'not_found' | 'already_applied' | 'terminal' | 'stale_dispute';
  affected_user_id: string | null;
  previous_status: 'active' | 'dispute_pending' | 'revoked' | null;
  current_status: 'active' | 'dispute_pending' | 'revoked' | null;
};

function getPaymentIntentId(reference: string | Stripe.PaymentIntent | null) {
  if (!reference) return null;
  return typeof reference === 'string' ? reference : reference.id;
}

async function applyAngelTransition(
  paymentIntentId: string | null,
  transition: AngelTransition,
  stripeObjectId: string,
  stripeEventCreated: number,
) {
  if (!paymentIntentId) return null;
  const eventTimeSeconds = Number.isFinite(stripeEventCreated)
    ? stripeEventCreated
    : Math.floor(Date.now() / 1000);
  const { data, error } = await supabaseAdmin.rpc('transition_angel_purchase', {
    p_stripe_payment_intent_id: paymentIntentId,
    p_transition: transition,
    p_stripe_object_id: stripeObjectId,
    p_stripe_event_at: new Date(eventTimeSeconds * 1000).toISOString(),
  });
  if (error) throw error;
  const result = Array.isArray(data) ? data[0] as AngelTransitionResult | undefined : null;
  if (!result || result.result_code === 'not_found' || result.result_code === 'deferred' || result.result_code === 'already_applied') return result ?? null;

  if (result.result_code === 'stale_dispute') {
    await recordIncident({
      dedupKey: `billing:angel-stale-dispute:${stripeObjectId}`,
      service: 'billing',
      type: 'angel_stale_dispute_event',
      severity: 'warning',
      correlationId: stripeObjectId,
      safeContext: { paymentIntentId, stripeObjectId, transition },
    });
    return result;
  }

  if (result.result_code === 'terminal' && transition === 'dispute_won') {
    await recordIncident({
      dedupKey: `billing:angel-terminal-reversal:${stripeObjectId}`,
      service: 'billing',
      type: 'angel_terminal_reversal_requires_review',
      severity: 'critical',
      correlationId: stripeObjectId,
      safeContext: { paymentIntentId, stripeObjectId, transition },
    });
    return result;
  }

  if (result.result_code !== 'transitioned') return result;

  const roleIncidentKey = `billing:angel-role:${paymentIntentId}`;
  if (transition === 'dispute_won') {
    await recoverIncident(roleIncidentKey);
  } else {
    await recordIncident({
      dedupKey: roleIncidentKey,
      service: 'billing',
      type: 'angel_founder_role_requires_review',
      severity: transition === 'dispute_opened' ? 'warning' : 'critical',
      correlationId: stripeObjectId,
      safeContext: { paymentIntentId, stripeObjectId, transition },
    });
  }
  await recordMetric({ kind: 'operational', service: 'billing', name: `angel_${transition}` });
  return result;
}

async function handleRefund(refund: Stripe.Refund, stripeEventCreated: number) {
  if (refund.status !== 'succeeded' || refund.amount <= 0) return;
  await applyAngelTransition(getPaymentIntentId(refund.payment_intent), 'refund_succeeded', refund.id, stripeEventCreated);
}

async function handleFailedRefund(refund: Stripe.Refund) {
  const paymentIntentId = getPaymentIntentId(refund.payment_intent);
  if (!paymentIntentId) return;
  const { data, error } = await supabaseAdmin
    .from('angel_purchases')
    .select('id')
    .eq('stripe_payment_intent_id', paymentIntentId)
    .maybeSingle();
  if (error || !data) return;
  await recordMetric({ kind: 'operational', service: 'billing', name: 'angel_refund_failed' });
}

async function handleRefundedCharge(charge: Stripe.Charge, stripeEventCreated: number) {
  if (charge.amount_refunded <= 0) return;
  const succeededRefund = charge.refunds?.data.find((refund) => refund.status === 'succeeded' && refund.amount > 0);
  await applyAngelTransition(getPaymentIntentId(charge.payment_intent), 'refund_succeeded', succeededRefund?.id ?? charge.id, stripeEventCreated);
}

async function handleDisputeOpened(dispute: Stripe.Dispute, stripeEventCreated: number) {
  await applyAngelTransition(getPaymentIntentId(dispute.payment_intent), 'dispute_opened', dispute.id, stripeEventCreated);
}

async function handleDisputeClosed(dispute: Stripe.Dispute, stripeEventCreated: number) {
  if (dispute.status === 'lost') {
    await applyAngelTransition(getPaymentIntentId(dispute.payment_intent), 'dispute_lost', dispute.id, stripeEventCreated);
    return;
  }
  if (dispute.status === 'won' || dispute.status === 'warning_closed' || dispute.status === 'prevented') {
    await applyAngelTransition(getPaymentIntentId(dispute.payment_intent), 'dispute_won', dispute.id, stripeEventCreated);
  }
}

async function handleSubscriptionUpdated(eventSubscription: Stripe.Subscription) {
  const subscription = await stripe.subscriptions.retrieve(eventSubscription.id);
  const userId = await resolveSubscriptionUserId(subscription);
  if (!userId) return;
  await syncSubscription(userId, subscription);
}

async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
  const userId = await resolveSubscriptionUserId(subscription);
  if (!userId) return;
  const { data: profile, error } = await supabaseAdmin
    .from('user_profiles')
    .select('tier, stripe_subscription_id')
    .eq('id', userId)
    .single();
  if (error) throw error;
  if (profile?.tier === 'angel') return;
  if (profile?.stripe_subscription_id && profile.stripe_subscription_id !== subscription.id) {
    await recordMetric({ kind: 'operational', service: 'billing', name: 'obsolete_subscription_event_ignored' });
    return;
  }
  await downgradeSubscription(userId);
}

async function handleInvoiceSubscription(invoice: Stripe.Invoice, outcome: 'succeeded' | 'failed') {
  const reference = invoice.parent?.subscription_details?.subscription;
  if (!reference) return;
  const subscriptionId = typeof reference === 'string' ? reference : reference.id;
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  const userId = await resolveSubscriptionUserId(subscription);
  if (!userId) return;
  await syncSubscription(userId, subscription);

  const priceId = subscription.items.data[0]?.price?.id ?? '';
  const tier = tierFromPriceId(priceId);
  if (tier === 'free') return;
  const interval = intervalFromPriceId(priceId);
  if (outcome === 'succeeded' && invoice.amount_paid > 0) {
    await recordMetric({
      kind: 'conversion',
      service: 'billing',
      name: `invoice_paid.${tier}.${interval}`,
      value: invoice.amount_paid,
    });
  } else if (outcome === 'failed') {
    await recordMetric({ kind: 'conversion', service: 'billing', name: `invoice_failed.${tier}.${interval}` });
  }
}

async function resolveSubscriptionUserId(subscription: Stripe.Subscription) {
  if (subscription.metadata?.supabase_user_id) return subscription.metadata.supabase_user_id;
  const customerId = getCustomerId(subscription.customer);
  if (!customerId) return null;
  const { data, error } = await supabaseAdmin
    .from('user_profiles')
    .select('id')
    .eq('stripe_customer_id', customerId)
    .maybeSingle();
  if (error) throw error;
  return data?.id ?? null;
}

async function getAngelMaxQuantity() {
  const priceId = STRIPE_PRICES.angel;
  if (!priceId) return ANGEL_MAX_QUANTITY;
  try {
    const price = await stripe.prices.retrieve(priceId, { expand: ['product'] });
    const product = price.product as { metadata?: Record<string, string> };
    const configured = Number.parseInt(product.metadata?.inventory ?? '', 10);
    if (Number.isFinite(configured) && configured > 0) {
      return Math.min(configured, ANGEL_MAX_QUANTITY);
    }
  } catch {
    return ANGEL_MAX_QUANTITY;
  }
  return ANGEL_MAX_QUANTITY;
}

async function downgradeSubscription(userId: string) {
  const { error } = await supabaseAdmin
    .from('user_profiles')
    .update({
      tier: 'free',
      subscription_status: 'canceled',
      stripe_subscription_id: null,
      trial_ends_at: null,
      current_period_end: null,
      cancel_at_period_end: false,
    })
    .eq('id', userId);
  if (error) throw error;
}

async function syncSubscription(userId: string, subscription: Stripe.Subscription) {
  const priceId = subscription.items.data[0]?.price?.id ?? '';
  const tier = tierFromPriceId(priceId);
  const interval = intervalFromPriceId(priceId);
  const isEntitled = ['active', 'trialing', 'past_due'].includes(subscription.status);

  const { data: current, error: currentError } = await supabaseAdmin
    .from('user_profiles')
    .select('tier, stripe_subscription_id')
    .eq('id', userId)
    .single();
  if (currentError) throw currentError;
  if (current?.tier === 'angel') return;
  if (current?.stripe_subscription_id && current.stripe_subscription_id !== subscription.id) {
    await recordMetric({ kind: 'operational', service: 'billing', name: 'obsolete_subscription_event_ignored' });
    return;
  }

  const { error } = await supabaseAdmin
    .from('user_profiles')
    .update({
      tier: isEntitled ? tier : 'free',
      stripe_customer_id: getCustomerId(subscription.customer),
      stripe_subscription_id: isEntitled ? subscription.id : null,
      subscription_status: subscription.status,
      billing_interval: isEntitled ? interval : 'month',
      // Billing Portal can schedule cancellation by setting `cancel_at` to the
      // period end while leaving `cancel_at_period_end` false. Treat either
      // representation as a scheduled cancellation for the account UI.
      cancel_at_period_end: Boolean(subscription.cancel_at_period_end || subscription.cancel_at),
      trial_ends_at: subscription.trial_end
        ? new Date(subscription.trial_end * 1000).toISOString()
        : null,
      current_period_end: subscription.items.data[0]?.current_period_end
        ? new Date(subscription.items.data[0].current_period_end * 1000).toISOString()
        : null,
    })
    .eq('id', userId);
  if (error) throw error;
}
