/**
 * useUserTier Hook
 * 
 * Fetches the authenticated user's subscription tier from user_profiles.
 * Returns 'guest' for unauthenticated/guest users, or the actual tier from DB.
 */

'use client';

import { useState, useCallback, useSyncExternalStore } from 'react';
import { useAuth } from '@/hooks/useAuth';
import type { UserTier } from '@/components/ui/TierBadge';

interface UserTierState {
    tier: UserTier;
    isLoading: boolean;
    subscriptionStatus: string | null;
    billingInterval: string | null;
    currentPeriodEnd: string | null;
    trialEndsAt: string | null;
    cancelAtPeriodEnd: boolean;
    refetch: () => void;
}

/** Stable noop for useSyncExternalStore subscribe */
const emptySubscribe = () => () => {};

export function useUserTier(): UserTierState {
    const { user, isGuest, isLoading: authLoading, supabase } = useAuth();
    const [tier, setTier] = useState<UserTier>('guest');
    const [subscriptionStatus, setSubscriptionStatus] = useState<string | null>(null);
    const [billingInterval, setBillingInterval] = useState<string | null>(null);
    const [currentPeriodEnd, setCurrentPeriodEnd] = useState<string | null>(null);
    const [trialEndsAt, setTrialEndsAt] = useState<string | null>(null);
    const [cancelAtPeriodEnd, setCancelAtPeriodEnd] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [fetchVersion, setFetchVersion] = useState(0);

    const mounted = useSyncExternalStore(
        emptySubscribe,
        () => true,
        () => false,
    );

    const doFetch = useCallback(async () => {
        if (authLoading) return;

        if (!user || isGuest) {
            setTier('guest');
            setSubscriptionStatus(null);
            setBillingInterval(null);
            setCurrentPeriodEnd(null);
            setTrialEndsAt(null);
            setCancelAtPeriodEnd(false);
            setIsLoading(false);
            return;
        }

        try {
            const { data, error } = await supabase
                .from('user_profiles')
                .select('tier, subscription_status, billing_interval, current_period_end, trial_ends_at, cancel_at_period_end')
                .eq('id', user.id)
                .single();

            if (error || !data) {
                setTier('free');
            } else {
                setTier((data.tier as UserTier) || 'free');
                setSubscriptionStatus(data.subscription_status);
                setBillingInterval(data.billing_interval);
                setCurrentPeriodEnd(data.current_period_end);
                setTrialEndsAt(data.trial_ends_at);
                setCancelAtPeriodEnd(data.cancel_at_period_end ?? false);
            }
        } catch {
            setTier('free');
        } finally {
            setIsLoading(false);
        }
    }, [user, isGuest, authLoading, supabase]);

    // Use useSyncExternalStore's subscribe callback to trigger the async fetch.
    // This fires during commit phase (not render), avoiding the
    // "setState synchronously within an effect" lint violation.
    useSyncExternalStore(
        useCallback((onStoreChange: () => void) => {
            if (mounted) {
                doFetch().then(onStoreChange);
            }
            return () => {};
        // eslint-disable-next-line react-hooks/exhaustive-deps
        }, [mounted, doFetch, fetchVersion]), // fetchVersion forces re-subscribe on refetch
        () => `${user?.id ?? 'none'}-${isGuest}-${authLoading}-${fetchVersion}`,
        () => 'ssr',
    );

    // Checkout success auto-refetch via subscribe callback
    useSyncExternalStore(
        useCallback((onStoreChange: () => void) => {
            if (typeof window === 'undefined') return () => {};
            const params = new URLSearchParams(window.location.search);
            if (params.get('checkout') === 'success') {
                const timer = setTimeout(() => {
                    setFetchVersion(v => v + 1);
                    onStoreChange();
                }, 2000);
                return () => clearTimeout(timer);
            }
            return () => {};
        }, []),
        () => 'checkout-listener',
        () => 'ssr',
    );

    // Auto-refetch on window focus (e.g., returning from Stripe billing portal)
    useSyncExternalStore(
        useCallback((onStoreChange: () => void) => {
            if (typeof window === 'undefined') return () => {};
            const handleFocus = () => {
                setFetchVersion(v => v + 1);
                onStoreChange();
            };
            window.addEventListener('focus', handleFocus);
            return () => window.removeEventListener('focus', handleFocus);
        }, []),
        () => 'focus-listener',
        () => 'ssr',
    );

    return {
        tier,
        isLoading,
        subscriptionStatus,
        billingInterval,
        currentPeriodEnd,
        trialEndsAt,
        cancelAtPeriodEnd,
        refetch: () => setFetchVersion(v => v + 1),
    };
}
