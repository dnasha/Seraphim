import { createHmac } from 'node:crypto';
import { NextResponse } from 'next/server';
import Stripe from 'stripe';

import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/core/supabase-admin';
import { stripe } from '@/lib/stripe';
import { getConfiguredSiteUrl } from '@/lib/security/payments';
import { checkSensitiveRateLimit, hasValidSameOrigin } from '@/lib/security/sensitiveRequest';
import { resolveEffectiveProfile } from '@/lib/server/effectiveProfile';
import { recordIncident, recordMetric } from '@/lib/server/operations';

const REAUTH_WINDOW_MS = 10 * 60 * 1000;

function hashUserId(userId: string) {
  const key = process.env.ACCOUNT_DELETION_HASH_KEY || process.env.STRIPE_WEBHOOK_SECRET;
  if (!key) throw new Error('deletion_hash_key_missing');
  return createHmac('sha256', key).update(userId).digest('hex');
}

export async function POST(request: Request) {
  const origin = getConfiguredSiteUrl();
  if (!origin || !hasValidSameOrigin(request, origin)) {
    return NextResponse.json({ code: 'invalid_origin', error: 'Request rejected.' }, { status: 403 });
  }

  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ code: 'unauthorized', error: 'Unauthorized.' }, { status: 401 });
  }

  const lastSignIn = user.last_sign_in_at ? new Date(user.last_sign_in_at).getTime() : 0;
  if (!lastSignIn || Date.now() - lastSignIn > REAUTH_WINDOW_MS) {
    return NextResponse.json({
      code: 'reauth_required',
      error: 'Your session is too old for account deletion. Re-authenticate by email and try again within 10 minutes.',
    }, { status: 403 });
  }

  const rateLimit = await checkSensitiveRateLimit(request, user.id);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { code: 'rate_limited', error: 'Please try again shortly.' },
      { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } },
    );
  }

  let jobId: string | null = null;
  try {
    const profile = await resolveEffectiveProfile(user.id);
    const userIdHash = hashUserId(user.id);
    const { data: existingJob } = await supabaseAdmin
      .from('account_deletion_jobs')
      .select('id, status')
      .eq('user_id', user.id)
      .neq('status', 'completed')
      .maybeSingle();

    if (existingJob) {
      jobId = existingJob.id;
    } else {
      const { data: job, error: jobError } = await supabaseAdmin
        .from('account_deletion_jobs')
        .insert({
          user_id: user.id,
          user_id_hash: userIdHash,
          stripe_customer_id: profile.stripeCustomerId,
          stripe_subscription_id: profile.stripeSubscriptionId,
        })
        .select('id')
        .single();
      if (jobError) throw jobError;
      jobId = job.id;
    }

    if (profile.stripeCustomerId) {
      try {
        await stripe.customers.del(profile.stripeCustomerId);
      } catch (error) {
        if (!(error instanceof Stripe.errors.StripeInvalidRequestError && error.code === 'resource_missing')) {
          throw error;
        }
      }
    }

    const { error: stripeStateError } = await supabaseAdmin
      .from('account_deletion_jobs')
      .update({ status: 'stripe_deleted', updated_at: new Date().toISOString(), failure_code: null })
      .eq('id', jobId);
    if (stripeStateError) throw stripeStateError;

    // Temporary access grants are erased and checkout operations are
    // pseudonymized before Auth deletion. Stripe remains the financial record.
    const { error: overrideDeleteError } = await supabaseAdmin
      .from('user_entitlement_overrides')
      .delete()
      .eq('user_id', user.id);
    if (overrideDeleteError) throw overrideDeleteError;

    const { error: intentAnonymizeError } = await supabaseAdmin
      .from('billing_checkout_intents')
      .update({ user_id: null, user_id_hash: userIdHash })
      .eq('user_id', user.id);
    if (intentAnonymizeError) throw intentAnonymizeError;

    const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(user.id);
    if (deleteError) throw deleteError;

    await supabaseAdmin
      .from('account_deletion_jobs')
      .update({
        user_id: null,
        status: 'completed',
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        failure_code: null,
      })
      .eq('id', jobId);

    await recordMetric({ kind: 'operational', service: 'account', name: 'account_deleted' });
    return NextResponse.json({ success: true, reference: jobId });
  } catch {
    if (jobId) {
      await supabaseAdmin
        .from('account_deletion_jobs')
        .update({ status: 'failed', failure_code: 'account_deletion_failed', updated_at: new Date().toISOString() })
        .eq('id', jobId);
    }
    await recordIncident({
      dedupKey: 'account:deletion-failed',
      service: 'account',
      type: 'account_deletion_failed',
      severity: 'critical',
      correlationId: jobId,
    });
    return NextResponse.json({
      code: 'deletion_failed',
      error: 'Account deletion could not be completed. Please retry or contact support.',
      reference: jobId,
    }, { status: 503 });
  }
}
