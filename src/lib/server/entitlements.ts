import 'server-only';

import { createClient } from '@/lib/supabase/server';
import { getEntitlements, normalizeUserTier, type TierEntitlements, type UserTier } from '@/lib/entitlements';

export interface RequestEntitlements {
  tier: UserTier;
  entitlements: TierEntitlements;
  userId: string | null;
}

/** Resolve a request from the verified Supabase session, never client cache. */
export async function resolveRequestEntitlements(): Promise<RequestEntitlements> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return { tier: 'guest', entitlements: getEntitlements('guest'), userId: null };
  }

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('tier')
    .eq('id', user.id)
    .maybeSingle();

  const tier = normalizeUserTier(profile?.tier, true);
  return { tier, entitlements: getEntitlements(tier), userId: user.id };
}
