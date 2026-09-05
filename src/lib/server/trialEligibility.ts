import { stripe } from '@/lib/stripe';
import { supabaseAdmin } from '@/lib/core/supabase-admin';

export async function recordTrialUse(userId: string, customerId: string, startedAt: number, intentId?: string) {
  const { error } = await supabaseAdmin.rpc('record_billing_trial', {
    p_user_id: userId, p_customer_id: customerId,
    p_started_at: new Date(startedAt * 1000).toISOString(),
    p_intent_id: intentId ?? null,
  });
  if (error) throw error;
}

export async function isTrialEligible(userId: string, customerId: string, intentId: string) {
  // Stripe history covers trials that predate the local ledger or a delayed webhook.
  // An unavailable history read must never silently grant a repeat trial.
  for await (const subscription of stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 100 })) {
    if (subscription.trial_start != null) {
      await recordTrialUse(userId, customerId, subscription.trial_start, subscription.metadata?.checkout_intent_id);
      break;
    }
  }
  const { data, error } = await supabaseAdmin.rpc('reserve_billing_trial', {
    p_user_id: userId, p_customer_id: customerId, p_intent_id: intentId,
  });
  if (error || typeof data !== 'boolean') throw error ?? new Error('trial_eligibility_unavailable');
  return data;
}
