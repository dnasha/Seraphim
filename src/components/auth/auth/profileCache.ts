import { useState, useCallback, useRef, useEffect } from 'react';
import type { User, Session, SupabaseClient, PostgrestError } from '@supabase/supabase-js';
import type { UserTier } from '@/components/ui/TierBadge';

export const normalizeUserTier = (tier: string | null | undefined, hasUser: boolean): UserTier => {
    const normalized = tier?.toLowerCase();
    if (normalized === 'pro' || normalized === 'analyst' || normalized === 'angel') {
        return normalized;
    }
    if (normalized === 'free') {
        return 'free';
    }
    return hasUser ? 'free' : 'guest';
};

const log = (message: unknown, ...optionalParams: unknown[]) => {
    if (process.env.NODE_ENV !== 'production') {
        console.log(message, ...optionalParams);
    }
};

export function useUserProfile(supabase: SupabaseClient, user: User | null) {
    const [userTier, setUserTier] = useState<UserTier>('guest');
    const [subscriptionStatus, setSubscriptionStatus] = useState<string | null>(null);
    const [billingInterval, setBillingInterval] = useState<string | null>(null);
    const [currentPeriodEnd, setCurrentPeriodEnd] = useState<string | null>(null);
    const [trialEndsAt, setTrialEndsAt] = useState<string | null>(null);
    const [cancelAtPeriodEnd, setCancelAtPeriodEnd] = useState(false);
    const [tierLoading, setTierLoading] = useState(true);

    const lastFetchedRef = useRef<Record<string, number>>({});
    const userRef = useRef<User | null>(user);

    useEffect(() => {
        userRef.current = user;
    }, [user]);

    const fetchUserTier = useCallback(async (userId: string | undefined, force = false, sessionPassed?: Session | null) => {
        if (!userId) {
            setUserTier('guest');
            setSubscriptionStatus(null);
            setBillingInterval(null);
            setCurrentPeriodEnd(null);
            setTrialEndsAt(null);
            setCancelAtPeriodEnd(false);
            setTierLoading(false);
            return;
        }

        const now = Date.now();
        const lastFetched = lastFetchedRef.current[userId] || 0;
        // Throttle check: Max once every 30 seconds, unless forced (e.g. initial mount or manual refetch)
        if (!force && now - lastFetched < 30000) {
            return;
        }
        
        lastFetchedRef.current[userId] = now;
        
        setTierLoading(true);
        try {
            log('[AuthProvider] Fetching user tier for', userId);
            
            // Ensure the session is loaded and refreshed before making the database query.
            // This prevents race conditions during tab focus or mount where queries are sent with expired tokens.
            let session = sessionPassed;
            if (session === undefined) {
                const { data: { session: activeSession } } = await supabase.auth.getSession();
                session = activeSession;
            }
            if (!session || session.user.id !== userId) {
                log('[AuthProvider] No active session matching userId. Skipping database query.');
                setUserTier('guest');
                setTierLoading(false);
                return;
            }

            // Race the database profile query against a 10-second timeout to prevent UI hangs on cold starts
            const queryPromise = supabase
                .from('user_profiles')
                .select('tier, subscription_status, billing_interval, current_period_end, trial_ends_at, cancel_at_period_end')
                .eq('id', userId)
                .single();
            
            const result = await Promise.race([
                queryPromise,
                new Promise<{ data: null; error: Error | PostgrestError }>((resolve) =>
                    setTimeout(() => resolve({ data: null, error: new Error('Profile query timeout') }), 10000)
                )
            ]);
            
            const { data, error } = result;

            // Guard against race conditions (e.g. user signs out or switches account during fetch)
            if (!userRef.current || userRef.current.id !== userId) {
                log('[AuthProvider] User changed or signed out during tier fetch. Discarding result.');
                return;
            }

            if (error || !data) {
                console.warn('[AuthProvider] Failed to fetch tier, keeping cached tier or defaulting to free:', error);
                setUserTier(prev => (prev && prev !== 'guest') ? prev : 'free');
            } else {
                log('[AuthProvider] User tier fetched successfully:', data.tier);
                const normalizedTier = normalizeUserTier(data.tier, true);
                setUserTier(normalizedTier);
                setSubscriptionStatus(data.subscription_status);
                setBillingInterval(data.billing_interval);
                setCurrentPeriodEnd(data.current_period_end);
                setTrialEndsAt(data.trial_ends_at);
                setCancelAtPeriodEnd(data.cancel_at_period_end ?? false);

                // Cache in localStorage to bypass cold database start delay on next load
                try {
                    localStorage.setItem('seraphim_cached_tier', normalizedTier);
                    if (data.subscription_status) localStorage.setItem('seraphim_cached_sub_status', data.subscription_status);
                    else localStorage.removeItem('seraphim_cached_sub_status');
                    if (data.billing_interval) localStorage.setItem('seraphim_cached_billing_interval', data.billing_interval);
                    else localStorage.removeItem('seraphim_cached_billing_interval');
                    if (data.current_period_end) localStorage.setItem('seraphim_cached_period_end', data.current_period_end);
                    else localStorage.removeItem('seraphim_cached_period_end');
                    if (data.trial_ends_at) localStorage.setItem('seraphim_cached_trial_ends', data.trial_ends_at);
                    else localStorage.removeItem('seraphim_cached_trial_ends');
                    localStorage.setItem('seraphim_cached_cancel_at_end', String(data.cancel_at_period_end ?? false));
                } catch (cacheErr) {
                    console.warn('[AuthProvider] Failed to save tier details to cache:', cacheErr);
                }
            }
        } catch (err) {
            console.error('[AuthProvider] Error in fetchUserTier:', err);
            setUserTier(prev => (prev && prev !== 'guest') ? prev : 'free');
        } finally {
            setTierLoading(false);
        }
    }, [supabase]);

    const refetchTier = useCallback(async () => {
        if (user?.id) {
            setTierLoading(true);
            await fetchUserTier(user.id, true);
        }
    }, [user, fetchUserTier]);

    // Single global listener: refetch user tier on window focus with 30s throttling
    useEffect(() => {
        if (typeof window === 'undefined') return;
        const handleFocus = async () => {
            if (user?.id) {
                const now = Date.now();
                const lastFetched = lastFetchedRef.current[user.id] || 0;
                if (now - lastFetched >= 30000) {
                    await fetchUserTier(user.id, true);
                }
            }
        };
        window.addEventListener('focus', handleFocus);
        return () => window.removeEventListener('focus', handleFocus);
    }, [user, fetchUserTier]);

    return {
        userTier,
        setUserTier,
        subscriptionStatus,
        setSubscriptionStatus,
        billingInterval,
        setBillingInterval,
        currentPeriodEnd,
        setCurrentPeriodEnd,
        trialEndsAt,
        setTrialEndsAt,
        cancelAtPeriodEnd,
        setCancelAtPeriodEnd,
        tierLoading,
        setTierLoading,
        fetchUserTier,
        refetchTier,
    };
}
