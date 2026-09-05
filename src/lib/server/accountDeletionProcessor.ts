import Stripe from 'stripe';
import { stripe } from '@/lib/stripe';
import { supabaseAdmin } from '@/lib/core/supabase-admin';

export async function processAccountDeletion(deletionJobId: string) {
  const { data: job, error } = await supabaseAdmin.from('account_deletion_jobs')
    .select('id, user_id, user_id_hash, stripe_customer_id, stripe_deleted_at, status')
    .eq('id', deletionJobId).single();
  if (error || !job) throw error ?? new Error('deletion_job_missing');
  if (job.status === 'completed') return;
  if (!job.user_id || !job.user_id_hash) throw new Error('deletion_identity_missing');
  // A checkout that acquired its reservation before deletion may still be
  // creating its Stripe customer. Let it finish before taking the final snapshot.
  const { data: creating, error: creatingError } = await supabaseAdmin.from('billing_checkout_intents')
    .select('id').eq('user_id', job.user_id).eq('status', 'creating')
    .gt('expires_at', new Date().toISOString()).limit(1);
  if (creatingError || creating?.length) throw creatingError ?? new Error('checkout_still_creating');
  if (!job.stripe_deleted_at) {
    const { data: profile, error: profileError } = await supabaseAdmin.from('user_profiles')
      .select('stripe_customer_id').eq('id', job.user_id).maybeSingle();
    if (profileError) throw profileError;
    if (profile?.stripe_customer_id) {
      job.stripe_customer_id = profile.stripe_customer_id;
      const { error: snapshotError } = await supabaseAdmin.from('account_deletion_jobs')
        .update({ stripe_customer_id: job.stripe_customer_id }).eq('id', job.id);
      if (snapshotError) throw snapshotError;
    }
  }
  if (!job.stripe_deleted_at && job.stripe_customer_id) {
    try {
      await stripe.customers.del(job.stripe_customer_id);
    } catch (error) {
      if (!(error instanceof Stripe.errors.StripeInvalidRequestError && error.code === 'resource_missing')) {
        throw error;
      }
    }
  }

  const { error: stripeStateError } = await supabaseAdmin
    .from('account_deletion_jobs')
    .update({ status: 'stripe_deleted', stripe_deleted_at: new Date().toISOString(), updated_at: new Date().toISOString(), failure_code: null })
    .eq('id', job.id);
  if (stripeStateError) throw stripeStateError;

  // Temporary access grants are erased and checkout operations are
  // pseudonymized before Auth deletion. Stripe remains the financial record.
  const { error: overrideDeleteError } = await supabaseAdmin
    .from('user_entitlement_overrides')
    .delete()
    .eq('user_id', job.user_id);
  if (overrideDeleteError) throw overrideDeleteError;

  const { error: intentAnonymizeError } = await supabaseAdmin
    .from('billing_checkout_intents')
    .update({ user_id: null, user_id_hash: job.user_id_hash })
    .eq('user_id', job.user_id);
  if (intentAnonymizeError) throw intentAnonymizeError;

  const { error: angelAnonymizeError } = await supabaseAdmin
    .from('angel_purchases')
    .update({ user_id: null, user_id_hash: job.user_id_hash })
    .eq('user_id', job.user_id);
  if (angelAnonymizeError) throw angelAnonymizeError;

  const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(job.user_id);
  if (deleteError && deleteError.code !== 'user_not_found' && deleteError.status !== 404) throw deleteError;


}
