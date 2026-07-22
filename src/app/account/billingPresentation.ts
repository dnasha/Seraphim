import type { UserTier } from '@/components/ui/TierBadge';

export function getSubscriptionStatusLabel(tier: UserTier, status: string | null) {
  if (tier === 'angel' || !status || status === 'inactive') return null;
  return status === 'trialing' ? 'Trial Active' : status;
}
