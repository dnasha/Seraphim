import { useState, useCallback, useRef, useEffect } from 'react';
import type { User, Session, SupabaseClient } from '@supabase/supabase-js';
import type { UserTier } from '@/components/ui/TierBadge';

export type TierSource = 'billing' | 'override';
export type AngelStatus = 'active' | 'dispute_pending' | 'revoked';

interface AccountProfileResponse {
    effectiveTier: string | null;
    tierSource: TierSource;
    overrideExpiresAt: string | null;
    subscriptionStatus: string | null;
    billingInterval: string | null;
    currentPeriodEnd: string | null;
    trialEndsAt: string | null;
    cancelAtPeriodEnd: boolean;
    angelStatus: AngelStatus | null;
}

export const normalizeUserTier = (tier: string | null | undefined, hasUser: boolean): UserTier => {
    const normalized = tier?.toLowerCase();
    if (normalized === 'pro' || normalized === 'analyst' || normalized === 'angel') return normalized;
    if (normalized === 'free') return 'free';
    return hasUser ? 'free' : 'guest';
};

export function useUserProfile(supabase: SupabaseClient, user: User | null) {
    const [userTier, setUserTier] = useState<UserTier>('guest');
    const [tierSource, setTierSource] = useState<TierSource>('billing');
    const [overrideExpiresAt, setOverrideExpiresAt] = useState<string | null>(null);
    const [subscriptionStatus, setSubscriptionStatus] = useState<string | null>(null);
    const [billingInterval, setBillingInterval] = useState<string | null>(null);
    const [currentPeriodEnd, setCurrentPeriodEnd] = useState<string | null>(null);
    const [trialEndsAt, setTrialEndsAt] = useState<string | null>(null);
    const [cancelAtPeriodEnd, setCancelAtPeriodEnd] = useState(false);
    const [angelStatus, setAngelStatus] = useState<AngelStatus | null>(null);
    const [tierLoading, setTierLoading] = useState(true);
    const lastFetchedRef = useRef<Record<string, number>>({});
    const loadedUserIdRef = useRef<string | null>(null);
    const userRef = useRef<User | null>(user);

    useEffect(() => { userRef.current = user; }, [user]);

    const resetProfile = useCallback((tier: UserTier = 'guest') => {
        setUserTier(tier);
        setTierSource('billing');
        setOverrideExpiresAt(null);
        setSubscriptionStatus(null);
        setBillingInterval(null);
        setCurrentPeriodEnd(null);
        setTrialEndsAt(null);
        setCancelAtPeriodEnd(false);
        setAngelStatus(null);
    }, []);

    const fetchUserTier = useCallback(async (userId: string | undefined, force = false, sessionPassed?: Session | null) => {
        if (!userId) {
            resetProfile();
            loadedUserIdRef.current = null;
            setTierLoading(false);
            return undefined;
        }

        const now = Date.now();
        if (!force && now - (lastFetchedRef.current[userId] || 0) < 30000) return undefined;
        lastFetchedRef.current[userId] = now;
        const isInitialLoad = loadedUserIdRef.current !== userId;
        if (isInitialLoad) setTierLoading(true);

        try {
            let session = sessionPassed;
            if (session === undefined) session = (await supabase.auth.getSession()).data.session;
            if (!session || session.user.id !== userId) {
                resetProfile();
                return undefined;
            }

            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 10000);
            let response: Response;
            try {
                response = await fetch('/api/account/profile', {
                    cache: 'no-store',
                    credentials: 'same-origin',
                    signal: controller.signal,
                });
            } finally {
                clearTimeout(timeout);
            }

            if (!userRef.current || userRef.current.id !== userId) return undefined;
            if (!response.ok) throw new Error(`profile_${response.status}`);

            const data = await response.json() as AccountProfileResponse;
            const normalizedTier = normalizeUserTier(data.effectiveTier, true);
            loadedUserIdRef.current = userId;
            setUserTier(normalizedTier);
            setTierSource(data.tierSource === 'override' ? 'override' : 'billing');
            setOverrideExpiresAt(data.overrideExpiresAt ?? null);
            setSubscriptionStatus(data.subscriptionStatus ?? null);
            setBillingInterval(data.billingInterval ?? null);
            setCurrentPeriodEnd(data.currentPeriodEnd ?? null);
            setTrialEndsAt(data.trialEndsAt ?? null);
            setCancelAtPeriodEnd(data.cancelAtPeriodEnd ?? false);
            setAngelStatus(
                data.angelStatus === 'active' || data.angelStatus === 'dispute_pending' || data.angelStatus === 'revoked'
                    ? data.angelStatus
                    : null,
            );

            try {
                localStorage.setItem('seraphim_cached_tier', normalizedTier);
            } catch {
                // Storage is an optional rendering optimization, never an entitlement source.
            }
            return normalizedTier;
        } catch {
            setUserTier(previous => previous !== 'guest' ? previous : 'free');
            return undefined;
        } finally {
            if (isInitialLoad) setTierLoading(false);
        }
    }, [resetProfile, supabase]);

    const refetchTier = useCallback(async () => {
        if (user?.id) await fetchUserTier(user.id, true);
    }, [user, fetchUserTier]);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        const handleFocus = () => {
            if (user?.id && Date.now() - (lastFetchedRef.current[user.id] || 0) >= 30000) {
                void fetchUserTier(user.id, true);
            }
        };
        window.addEventListener('focus', handleFocus);
        return () => window.removeEventListener('focus', handleFocus);
    }, [user, fetchUserTier]);

    return {
        userTier, setUserTier,
        tierSource, setTierSource,
        overrideExpiresAt, setOverrideExpiresAt,
        subscriptionStatus, setSubscriptionStatus,
        billingInterval, setBillingInterval,
        currentPeriodEnd, setCurrentPeriodEnd,
        trialEndsAt, setTrialEndsAt,
        cancelAtPeriodEnd, setCancelAtPeriodEnd,
        angelStatus, setAngelStatus,
        tierLoading, setTierLoading,
        fetchUserTier, refetchTier, resetProfile,
    };
}
