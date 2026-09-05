import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';

import { stripe } from '@/lib/stripe';
import { runRecoveryJob } from '@/lib/server/runRecoveryJob';
import { enqueueRecoveryJob, claimRecoveryJob, type RecoveryJob } from '@/lib/server/recoveryJobs';
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

  let job: RecoveryJob | null;
  try {
    const status = await enqueueRecoveryJob(event.id, 'stripe_webhook', event as unknown as Record<string, unknown>);
    if (status === 'completed') return NextResponse.json({ received: true, duplicate: true });
    job = await claimRecoveryJob(event.id);
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
  if (!job) return NextResponse.json({ error: 'Webhook queued for retry' }, { status: 503, headers: { 'Retry-After': '60' } });

  try {
    await runRecoveryJob(job);
    await recordMetric({ kind: 'operational', service: 'billing', name: 'webhook_processed' });
    await recoverIncident('billing:webhook-processing');
    return NextResponse.json({ received: true });
  } catch {
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
