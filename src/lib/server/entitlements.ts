import 'server-only';

import { createClient } from '@/lib/supabase/server';
import { cookies } from 'next/headers';
import { getEntitlements, normalizeUserTier, type TierEntitlements, type UserTier } from '@/lib/entitlements';

export interface RequestEntitlements {
  tier: UserTier;
  entitlements: TierEntitlements;
  userId: string | null;
}

const PROFILE_TIER_TTL_MS = 60_000;
const PROFILE_TIER_CACHE_MAX = 1_000;
const profileTierCache = new Map<string, { tier: UserTier; expiresAt: number }>();
const profileTierRequests = new Map<string, Promise<UserTier>>();

function pruneProfileTierCache(now: number) {
  for (const [userId, cached] of profileTierCache) {
    if (cached.expiresAt <= now) profileTierCache.delete(userId);
  }
  while (profileTierCache.size > PROFILE_TIER_CACHE_MAX) {
    const oldest = profileTierCache.keys().next().value as string | undefined;
    if (!oldest) break;
    profileTierCache.delete(oldest);
  }
}

async function resolveProfileTier(
  userId: string,
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<UserTier> {
  const now = Date.now();
  pruneProfileTierCache(now);
  const cached = profileTierCache.get(userId);
  if (cached && cached.expiresAt > now) return cached.tier;

  const inFlight = profileTierRequests.get(userId);
  if (inFlight) return inFlight;

  const request = (async () => {
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('tier')
      .eq('id', userId)
      .maybeSingle();
    const tier = normalizeUserTier(profile?.tier, true);
    profileTierCache.set(userId, { tier, expiresAt: Date.now() + PROFILE_TIER_TTL_MS });
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

  const tier = await resolveProfileTier(user.id, supabase);
  return { tier, entitlements: getEntitlements(tier), userId: user.id };
}
