import { createHmac } from 'node:crypto';
import { NextResponse } from 'next/server';

import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/core/supabase-admin';
import { getConfiguredSiteUrl } from '@/lib/security/payments';
import { checkSensitiveRateLimit, hasValidSameOrigin } from '@/lib/security/sensitiveRequest';
import { recordIncident, recordMetric } from '@/lib/server/operations';
import { runRecoveryJob } from '@/lib/server/runRecoveryJob';
import { claimRecoveryJob, type RecoveryJob } from '@/lib/server/recoveryJobs';
import { hasRecentAuthentication } from '@/lib/security/recentAuthentication';

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

  const { data: verified, error: claimsError } = await supabase.auth.getClaims();
  if (claimsError || !hasRecentAuthentication(verified?.claims, user.id)) {
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
  let job: RecoveryJob | null = null;
  try {
    const { data, error } = await supabaseAdmin.rpc('start_account_deletion', {
      p_user_id: user.id, p_user_hash: hashUserId(user.id),
    });
    if (error || typeof data !== 'string') throw error ?? new Error('deletion_enqueue_failed');
    jobId = data;
    job = await claimRecoveryJob(`delete:${jobId}`);
    if (!job) return NextResponse.json({ code: 'deletion_pending', reference: jobId,
      error: 'Deletion is already queued and will retry automatically.' }, { status: 503 });
    await runRecoveryJob(job);
    await recordMetric({ kind: 'operational', service: 'account', name: 'account_deleted' });
    return NextResponse.json({ success: true, reference: jobId });
  } catch {
    await recordIncident({ dedupKey: 'account:deletion-failed', service: 'account',
      type: 'account_deletion_failed', severity: 'critical', correlationId: jobId });
    return NextResponse.json({ code: 'deletion_failed', reference: jobId,
      error: jobId ? 'Deletion is queued for automatic recovery. Keep this support reference.'
        : 'Account deletion could not be started. Please retry.' }, { status: 503 });
  }
}
