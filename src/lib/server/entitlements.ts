import 'server-only';

import { createClient } from '@/lib/supabase/server';
import { cookies } from 'next/headers';
import { getEntitlements, normalizeUserTier, type TierEntitlements, type UserTier } from '@/lib/entitlements';
import { resolveEffectiveProfile } from '@/lib/server/effectiveProfile';

export interface RequestEntitlements {
  tier: UserTier;
  entitlements: TierEntitlements;
  userId: string | null;
}

const profileTierRequests = new Map<string, Promise<UserTier>>();

async function resolveProfileTier(
  userId: string,
): Promise<UserTier> {
  // Coalesce concurrent reads, but never retain a resolved authorization result
  // across requests: billing and overrides can change on another instance.
  const inFlight = profileTierRequests.get(userId);
  if (inFlight) return inFlight;

  const request = (async () => {
    const profile = await resolveEffectiveProfile(userId);
    const tier = normalizeUserTier(profile.effectiveTier, true);
    return tier;
  })();

  profileTierRequests.set(userId, request);
  try {
    return await request;
  } finally {
    profileTierRequests.delete(userId);
  }
}

/** Resolve a request from the verified Supabase session, never client cache. */
export async function resolveRequestEntitlements(): Promise<RequestEntitlements> {
  const cookieStore = await cookies();
  const hasAuthCookie = cookieStore.getAll().some(({ name }) =>
    name.startsWith('sb-') && name.includes('-auth-token'),
  );
  if (!hasAuthCookie) {
    return { tier: 'guest', entitlements: getEntitlements('guest'), userId: null };
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return { tier: 'guest', entitlements: getEntitlements('guest'), userId: null };
  }

  const tier = await resolveProfileTier(user.id);
  return { tier, entitlements: getEntitlements(tier), userId: user.id };
}
