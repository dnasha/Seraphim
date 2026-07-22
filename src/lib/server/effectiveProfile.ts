import 'server-only';

import { supabaseAdmin } from '@/lib/core/supabase-admin';
import { normalizeUserTier, type UserTier } from '@/lib/entitlements';

export type AngelStatus = 'active' | 'dispute_pending' | 'revoked';

export interface EffectiveProfile {
  billingTier: UserTier;
  effectiveTier: UserTier;
  tierSource: 'billing' | 'override';
  overrideExpiresAt: string | null;
  subscriptionStatus: string | null;
  billingInterval: string | null;
  currentPeriodEnd: string | null;
  trialEndsAt: string | null;
  cancelAtPeriodEnd: boolean;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  angelStatus: AngelStatus | null;
}

export async function resolveEffectiveProfile(userId: string): Promise<EffectiveProfile> {
  const now = new Date().toISOString();
  const [profileResult, overrideResult, angelResult] = await Promise.all([
    supabaseAdmin
      .from('user_profiles')
      .select('tier, subscription_status, billing_interval, current_period_end, trial_ends_at, cancel_at_period_end, stripe_customer_id, stripe_subscription_id')
      .eq('id', userId)
      .maybeSingle(),
    supabaseAdmin
      .from('user_entitlement_overrides')
      .select('tier, expires_at')
      .eq('user_id', userId)
      .is('revoked_at', null)
      .gt('expires_at', now)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabaseAdmin
      .from('angel_purchases')
      .select('status')
      .eq('user_id', userId)
      .order('purchased_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (profileResult.error) throw profileResult.error;

  const profile = profileResult.data;
  const billingTier = normalizeUserTier(profile?.tier, true);
  const override = overrideResult.error ? null : overrideResult.data;
  const effectiveTier = override
    ? normalizeUserTier(override.tier, true)
    : billingTier;
  const angelStatus = angelResult.data?.status;

  return {
    billingTier,
    effectiveTier,
    tierSource: override ? 'override' : 'billing',
    overrideExpiresAt: override?.expires_at ?? null,
    subscriptionStatus: profile?.subscription_status ?? null,
    billingInterval: profile?.billing_interval ?? null,
    currentPeriodEnd: profile?.current_period_end ?? null,
    trialEndsAt: profile?.trial_ends_at ?? null,
    cancelAtPeriodEnd: profile?.cancel_at_period_end ?? false,
    stripeCustomerId: profile?.stripe_customer_id ?? null,
    stripeSubscriptionId: profile?.stripe_subscription_id ?? null,
    angelStatus: !angelResult.error && angelStatus && ['active', 'dispute_pending', 'revoked'].includes(angelStatus)
      ? angelStatus as AngelStatus
      : null,
  };
}
