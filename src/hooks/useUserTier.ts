/**
 * useUserTier Hook
 * 
 * Thin wrapper over global shared auth context to retrieve the current user's 
 * subscription tier from user_profiles. This caches queries globally, throttles focus refetching,
 * and completely eliminates duplicate concurrent query loads.
 */

'use client';

import { useAuth } from '@/hooks/useAuth';
import type { UserTier } from '@/components/ui/TierBadge';

interface UserTierState {
    tier: UserTier;
    tierSource: 'billing' | 'override';
    overrideExpiresAt: string | null;
    isLoading: boolean;
    subscriptionStatus: string | null;
    billingInterval: string | null;
    currentPeriodEnd: string | null;
    trialEndsAt: string | null;
    cancelAtPeriodEnd: boolean;
    refetch: () => Promise<void>;
}

export function useUserTier(): UserTierState {
    const {
        userTier,
        tierSource,
        overrideExpiresAt,
        tierLoading,
        subscriptionStatus,
        billingInterval,
        currentPeriodEnd,
        trialEndsAt,
        cancelAtPeriodEnd,
        refetchTier,
    } = useAuth();

    return {
        tier: userTier,
        tierSource,
        overrideExpiresAt,
        isLoading: tierLoading,
        subscriptionStatus,
        billingInterval,
        currentPeriodEnd,
        trialEndsAt,
        cancelAtPeriodEnd,
        refetch: refetchTier,
    };
}
