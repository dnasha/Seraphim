import { supabaseAdmin } from '@/lib/core/supabase-admin';

export interface RecoveryJob {
  job_key: string;
  kind: 'stripe_webhook' | 'account_deletion';
  payload: Record<string, unknown>;
  claim_token: string;
  attempts: number;
}

export async function enqueueRecoveryJob(key: string, kind: RecoveryJob['kind'], payload: Record<string, unknown>) {
  const { data, error } = await supabaseAdmin.rpc('enqueue_recovery_job', {
    p_key: key, p_kind: kind, p_payload: payload,
  });
  if (error || typeof data !== 'string') throw error ?? new Error('job_enqueue_failed');
  return data;
}

export async function claimRecoveryJob(key: string | null = null): Promise<RecoveryJob | null> {
  const { data, error } = await supabaseAdmin.rpc('claim_recovery_job', { p_key: key });
  if (error) throw error;
  return Array.isArray(data) ? data[0] ?? null : null;
}

export async function completeRecoveryJob(job: RecoveryJob) {
  const { data, error } = await supabaseAdmin.rpc('finish_recovery_job', {
    p_key: job.job_key, p_token: job.claim_token, p_success: true,
  });
  if (error || data !== true) throw error ?? new Error('job_lease_lost');
}

export async function failRecoveryJob(job: RecoveryJob) {
  const { error } = await supabaseAdmin.rpc('finish_recovery_job', {
    p_key: job.job_key, p_token: job.claim_token, p_success: false,
  });
  // A crash or unavailable database leaves the expiring lease reclaimable.
  if (error) console.error('[recovery] Could not release job lease', job.job_key);
}
