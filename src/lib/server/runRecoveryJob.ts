import Stripe from 'stripe';
import { supabaseAdmin } from '@/lib/core/supabase-admin';
import { processStripeEvent } from './stripeEventProcessor';
import { processAccountDeletion } from './accountDeletionProcessor';
import { completeRecoveryJob, failRecoveryJob, type RecoveryJob } from './recoveryJobs';

export async function runRecoveryJob(job: RecoveryJob) {
  let leaseLost = false;
  const heartbeat = setInterval(() => {
    void (async () => {
      const { data, error } = await supabaseAdmin.rpc('renew_recovery_job', {
        p_key: job.job_key, p_token: job.claim_token,
      });
      if (error || data !== true) leaseLost = true;
    })().catch(() => { leaseLost = true; });
  }, 30_000);
  try {
    if (job.kind === 'stripe_webhook') await processStripeEvent(job.payload as unknown as Stripe.Event);
    else {
      const id = job.payload.deletionJobId;
      if (typeof id !== 'string') throw new Error('invalid_deletion_job');
      await processAccountDeletion(id);
    }
    if (leaseLost) throw new Error('job_lease_lost');
    await completeRecoveryJob(job);
  } catch (error) {
    await failRecoveryJob(job);
    throw error;
  } finally {
    clearInterval(heartbeat);
  }
}
