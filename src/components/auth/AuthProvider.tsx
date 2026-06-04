'use client';

/**
 * AuthProvider manages global authentication state for the Seraphim application.
 * 
 * Creates a singleton browser Supabase client, listens for auth state changes,
 * and provides the current user, session, and loading state via React context.
 * 
 * Guest mode: When a user clicks "Continue as Guest", their choice is persisted
 * in localStorage so the login modal doesn't reappear on subsequent visits.
 */

import React, { createContext, useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { User, Session, SupabaseClient, AuthError, PostgrestError } from '@supabase/supabase-js';
import type { UserTier } from '@/components/ui/TierBadge';

const GUEST_STORAGE_KEY = 'seraphim_guest_mode';

const normalizeUserTier = (tier: string | null | undefined, hasUser: boolean): UserTier => {
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

interface AuthContextType {
    user: User | null;
    session: Session | null;
    isLoading: boolean;
    isGuest: boolean;
    supabase: SupabaseClient;
    signOut: () => Promise<void>;
    continueAsGuest: () => void;
    showAuthModal: boolean;
    setShowAuthModal: (show: boolean) => void;
    // Shared user profile/tier properties
    userTier: UserTier;
    tierLoading: boolean;
    subscriptionStatus: string | null;
    billingInterval: string | null;
    currentPeriodEnd: string | null;
    trialEndsAt: string | null;
    cancelAtPeriodEnd: boolean;
    refetchTier: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const supabase = useMemo(() => createClient(), []);
    const [user, setUser] = useState<User | null>(null);
    const [session, setSession] = useState<Session | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isGuest, setIsGuest] = useState(false);
    const [showAuthModal, setShowAuthModal] = useState(false);

    // Shared global tier state
    const [userTier, setUserTier] = useState<UserTier>('guest');
    const [subscriptionStatus, setSubscriptionStatus] = useState<string | null>(null);
    const [billingInterval, setBillingInterval] = useState<string | null>(null);
    const [currentPeriodEnd, setCurrentPeriodEnd] = useState<string | null>(null);
    const [trialEndsAt, setTrialEndsAt] = useState<string | null>(null);
    const [cancelAtPeriodEnd, setCancelAtPeriodEnd] = useState(false);
    const [tierLoading, setTierLoading] = useState(true);

    const lastFetchedRef = useRef<Record<string, number>>({});
    const userRef = useRef<User | null>(null);

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

    useEffect(() => {
        // Resolve only guest state synchronously. Authenticated state must come
        // from Supabase and pass server verification before it can gate features.
        const wasGuest = localStorage.getItem(GUEST_STORAGE_KEY);
        const hasSupabaseSession = Object.keys(localStorage).some(key => key.startsWith('sb-') && key.endsWith('-auth-token'));
        
        let hasRestoredFromCache = false;
        
        if (!hasRestoredFromCache) {
            // If we know they are a guest (either explicit choice or no Supabase session cookie/local storage at all)
            if (wasGuest === 'true' || !hasSupabaseSession) {
                const isGuestPref = wasGuest === 'true';
                setTimeout(() => {
                    setIsGuest(isGuestPref);
                    setUserTier('guest');
                    setIsLoading(false);
                    setTierLoading(false);
                }, 0);
                hasRestoredFromCache = true;
                log('[AuthProvider] Synchronously resolved guest status on mount');
            }
        }

        let activeSubscription: { unsubscribe: () => void } | null = null;
        let isUnmounted = false;

        const initializeAuth = async () => {
            log('[AuthProvider] Starting background initializeAuth...');
            try {
                // Check guest preference
                const currentWasGuest = localStorage.getItem(GUEST_STORAGE_KEY);
                const hasSupabaseSession = Object.keys(localStorage).some(key => key.startsWith('sb-') && key.endsWith('-auth-token'));
                if (currentWasGuest === 'true' && !hasSupabaseSession && !userRef.current) {
                    if (!isUnmounted) setIsGuest(true);
                }

                // Check initial session locally with a 10-second timeout safeguard to accommodate cold starts
                log('[AuthProvider] Retrieving local session...');
                const sessionResult = await Promise.race([
                    supabase.auth.getSession().then(res => ({ ...res, timedOut: false as const })),
                    new Promise<{ data: { session: null }; timedOut: true }>((resolve) =>
                        setTimeout(() => resolve({ data: { session: null }, timedOut: true }), 10000)
                    )
                ]);
                const initialSession = sessionResult.data?.session ?? null;
                const getSessionTimedOut = 'timedOut' in sessionResult && sessionResult.timedOut;
                log('[AuthProvider] Session retrieved:', initialSession ? 'Found' : 'None', getSessionTimedOut ? '(Timed Out)' : '');
                
                let verifiedUser = initialSession?.user ?? null;
                let finalSession = initialSession;

                // If we think we have a session, verify it with the server (with a 4-second timeout)
                if (initialSession) {
                    log('[AuthProvider] Verifying session with server...');
                    const userResult = await Promise.race([
                        supabase.auth.getUser(),
                        new Promise<{ data: { user: User | null }; error: AuthError | Error | null }>((resolve) =>
                            setTimeout(() => resolve({ data: { user: null }, error: new Error('User verify timeout') }), 4000)
                        )
                    ]);
                    const user = userResult.data?.user ?? null;
                    const error = userResult.error;
                    log('[AuthProvider] Server verification result:', { hasUser: !!user, hasError: !!error });
                    
                    if (error || !user) {
                        if (error && (error.message === 'User verify timeout' || error.message.includes('fetch') || error.message.includes('network'))) {
                            console.warn('[AuthProvider] Network or timeout during verification. Not trusting local session for gated state.');
                            verifiedUser = null;
                            finalSession = null;
                        } else {
                            // Token is mathematically valid but server rejected it (deleted/banned)
                            console.warn('[AuthProvider] Server rejected session. Signing out.', error);
                            await supabase.auth.signOut();
                            verifiedUser = null;
                            finalSession = null;
                        }
                    } else {
                        verifiedUser = user;
                    }
                }
                
                // Only update the state and cached credentials if getSession completed.
                // If it timed out, we retain the cached states we restored synchronously on mount.
                if (!getSessionTimedOut) {
                    if (isUnmounted) return;
                    setSession(finalSession);
                    setUser(verifiedUser);

                    if (verifiedUser) {
                        setIsGuest(false);
                        localStorage.removeItem(GUEST_STORAGE_KEY);
                        await fetchUserTier(verifiedUser.id, true, finalSession);
                    } else {
                        log('[AuthProvider] No verified user, setting guest tier');
                        setUserTier('guest');
                        setTierLoading(false);
                        // Clear cache
                        localStorage.removeItem('seraphim_cached_tier');
                        localStorage.removeItem('seraphim_cached_sub_status');
                        localStorage.removeItem('seraphim_cached_billing_interval');
                        localStorage.removeItem('seraphim_cached_period_end');
                        localStorage.removeItem('seraphim_cached_trial_ends');
                        localStorage.removeItem('seraphim_cached_cancel_at_end');
                    }
                } else {
                    console.warn('[AuthProvider] getSession timed out. Leaving gated auth state disabled until verification succeeds.');
                    if (!hasRestoredFromCache) {
                        setUserTier('guest');
                        setTierLoading(false);
                    }
                }

                // If no session and not already determined as guest, default to guest mode internally (only if not timed out)
                if (!finalSession && currentWasGuest !== 'true' && !getSessionTimedOut) {
                    log('[AuthProvider] No active session, enabling Guest Mode');
                    if (!isUnmounted) setIsGuest(true);
                }
            } catch (err) {
                console.error('[AuthProvider] Failed to initialize auth:', err);
                if (!hasRestoredFromCache) {
                    if (isUnmounted) return;
                    setUserTier('guest');
                    setTierLoading(false);
                }
            } finally {
                log('[AuthProvider] Setting isLoading to false');
                if (!isUnmounted) {
                    setIsLoading(false);

                    // Defer registration of auth state change listener until getSession has resolved
                    log('[AuthProvider] Registering post-initialization onAuthStateChange listener...');
                    const { data: { subscription: sub } } = supabase.auth.onAuthStateChange(
                        (_event, newSession) => {
                            // Defer callback processing to avoid blocking internal Supabase client locks
                            setTimeout(async () => {
                                if (isUnmounted) return;
                                setSession(newSession);
                                setUser(newSession?.user ?? null);

                                // If user signs in, clear guest mode and fetch profile
                                if (newSession?.user) {
                                    setIsGuest(false);
                                    localStorage.removeItem(GUEST_STORAGE_KEY);
                                    setShowAuthModal(false);
                                    
                                    // Only fetch tier on active changes/events, not on initial mount where initializeAuth handles it.
                                    // This prevents redundant queued queries during cold starts.
                                    if (_event !== 'INITIAL_SESSION') {
                                        await fetchUserTier(newSession.user.id, true, newSession);
                                    }
                                } else if (_event !== 'INITIAL_SESSION') {
                                    setUserTier('guest');
                                    setSubscriptionStatus(null);
                                    setBillingInterval(null);
                                    setCurrentPeriodEnd(null);
                                    setTrialEndsAt(null);
                                    setCancelAtPeriodEnd(false);
                                    setTierLoading(false);

                                    // Clear cache
                                    localStorage.removeItem('seraphim_cached_tier');
                                    localStorage.removeItem('seraphim_cached_sub_status');
                                    localStorage.removeItem('seraphim_cached_billing_interval');
                                    localStorage.removeItem('seraphim_cached_period_end');
                                    localStorage.removeItem('seraphim_cached_trial_ends');
                                    localStorage.removeItem('seraphim_cached_cancel_at_end');
                                }
                            }, 0);
                        }
                    );
                    activeSubscription = sub;
                }
            }
        };

        initializeAuth();

        return () => {
            isUnmounted = true;
            if (activeSubscription) {
                activeSubscription.unsubscribe();
            }
        };
    }, [supabase, fetchUserTier]);



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

    useEffect(() => {
        if (!user) return;
        if (!isGuest && userTier !== 'guest') return;

        const timer = setTimeout(() => {
            if (isGuest) {
                setIsGuest(false);
                localStorage.removeItem(GUEST_STORAGE_KEY);
            }
            if (userTier === 'guest') {
                setUserTier('free');
            }
        }, 0);

        return () => clearTimeout(timer);
    }, [user, isGuest, userTier]);

    // Single global listener: handle Stripe success redirection with polling
    useEffect(() => {
        if (typeof window === 'undefined') return;
        const params = new URLSearchParams(window.location.search);
        let checkTimer: NodeJS.Timeout | undefined;
        let pollInterval: NodeJS.Timeout | undefined;

        if (params.get('checkout') === 'success' && user?.id) {
            let attempts = 0;
            const maxAttempts = 5;

            const checkTier = async () => {
                attempts++;
                log(`[AuthProvider] Polling user tier on success redirect (attempt ${attempts}/${maxAttempts})...`);
                await fetchUserTier(user.id, true);
            };

            // Check once after 2 seconds
            checkTimer = setTimeout(async () => {
                await checkTier();

                // Set up polling interval to check if they upgraded
                pollInterval = setInterval(async () => {
                    if (attempts >= maxAttempts) {
                        if (pollInterval) clearInterval(pollInterval);
                        return;
                    }

                    try {
                        const { data } = await supabase
                            .from('user_profiles')
                            .select('tier')
                            .eq('id', user.id)
                            .single();

                        const currentTier = data?.tier?.toLowerCase();
                        if (currentTier && currentTier !== 'free' && currentTier !== 'guest') {
                            log('[AuthProvider] Premium tier detected via polling, stopping poll.');
                            await fetchUserTier(user.id, true);
                            if (pollInterval) clearInterval(pollInterval);
                        } else {
                            await checkTier();
                        }
                    } catch (err) {
                        console.warn('[AuthProvider] Error polling profile tier status:', err);
                        await checkTier();
                    }
                }, 3000);
            }, 2000);
        }

        return () => {
            if (checkTimer) clearTimeout(checkTimer);
            if (pollInterval) clearInterval(pollInterval);
        };
    }, [user, fetchUserTier, supabase]);


    const signOut = useCallback(async () => {
        await supabase.auth.signOut();
        setUser(null);
        setSession(null);
        setIsGuest(false);
        setUserTier('guest');
        setSubscriptionStatus(null);
        setBillingInterval(null);
        setCurrentPeriodEnd(null);
        setTrialEndsAt(null);
        setCancelAtPeriodEnd(false);
        setTierLoading(false);
        localStorage.removeItem(GUEST_STORAGE_KEY);
        localStorage.removeItem('seraphim-map-draw-tools-v1');
        
        // Clear cached auth details
        localStorage.removeItem('seraphim_cached_user');
        localStorage.removeItem('seraphim_cached_session');
        localStorage.removeItem('seraphim_cached_tier');
        localStorage.removeItem('seraphim_cached_sub_status');
        localStorage.removeItem('seraphim_cached_billing_interval');
        localStorage.removeItem('seraphim_cached_period_end');
        localStorage.removeItem('seraphim_cached_trial_ends');
        localStorage.removeItem('seraphim_cached_cancel_at_end');

        // Show auth modal again after sign out
        setShowAuthModal(true);
    }, [supabase]);

    const continueAsGuest = useCallback(() => {
        localStorage.setItem(GUEST_STORAGE_KEY, 'true');
        setIsGuest(true);
        setUserTier('guest');
        setSubscriptionStatus(null);
        setBillingInterval(null);
        setCurrentPeriodEnd(null);
        setTrialEndsAt(null);
        setCancelAtPeriodEnd(false);
        setTierLoading(false);
        setShowAuthModal(false);
    }, []);

    const effectiveUserTier = user || session
        ? normalizeUserTier(userTier, true)
        : userTier;
    const effectiveIsGuest = user || session ? false : isGuest;

    const value = useMemo<AuthContextType>(() => ({
        user,
        session,
        isLoading,
        isGuest: effectiveIsGuest,
        supabase,
        signOut,
        continueAsGuest,
        showAuthModal,
        setShowAuthModal,
        // Shared states
        userTier: effectiveUserTier,
        tierLoading,
        subscriptionStatus,
        billingInterval,
        currentPeriodEnd,
        trialEndsAt,
        cancelAtPeriodEnd,
        refetchTier,
    }), [
        user,
        session,
        isLoading,
        effectiveIsGuest,
        supabase,
        signOut,
        continueAsGuest,
        showAuthModal,
        effectiveUserTier,
        tierLoading,
        subscriptionStatus,
        billingInterval,
        currentPeriodEnd,
        trialEndsAt,
        cancelAtPeriodEnd,
        refetchTier,
    ]);

    return (
        <AuthContext.Provider value={value}>
            {children}
        </AuthContext.Provider>
    );
}
