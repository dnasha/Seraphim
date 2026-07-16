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
import type { User, Session, SupabaseClient, AuthError } from '@supabase/supabase-js';
import type { UserTier } from '@/components/ui/TierBadge';
import { useUserProfile, normalizeUserTier } from './auth/profileCache';
import { useStripeCheckoutPoll } from './auth/stripePoll';

const GUEST_STORAGE_KEY = 'seraphim_guest_mode';

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
    tierSource: 'billing' | 'override';
    overrideExpiresAt: string | null;
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

    const userRef = useRef<User | null>(null);

    useEffect(() => {
        userRef.current = user;
    }, [user]);

    const {
        userTier,
        setUserTier,
        tierSource,
        setTierSource,
        overrideExpiresAt,
        setOverrideExpiresAt,
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
    } = useUserProfile(supabase, user);

    useEffect(() => {
        // Resolve only guest state synchronously. Authenticated state must come
        // from Supabase and pass server verification before it can gate features.
        // Keep auth loading until Supabase has restored and verified the
        // session. Cookie-backed sessions are not guaranteed to have a matching
        // localStorage key, so resolving "guest" synchronously causes protected
        // pages and paid filters to redirect/reset during cold navigation.
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
                    setUserTier('guest');
                    setTierLoading(false);
                }

                // If no session and not already determined as guest, default to guest mode internally (only if not timed out)
                if (!finalSession && currentWasGuest !== 'true' && !getSessionTimedOut) {
                    log('[AuthProvider] No active session, enabling Guest Mode');
                    if (!isUnmounted) setIsGuest(true);
                }
            } catch (err) {
                console.error('[AuthProvider] Failed to initialize auth:', err);
                if (isUnmounted) return;
                setUserTier('guest');
                setTierLoading(false);
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
                                    setTierSource('billing');
                                    setOverrideExpiresAt(null);
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
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [supabase, fetchUserTier]);
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
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user, isGuest, userTier]);

    useStripeCheckoutPoll(user, fetchUserTier);


    const signOut = useCallback(async () => {
        await supabase.auth.signOut();
        setUser(null);
        setSession(null);
        setIsGuest(false);
        setUserTier('guest');
        setTierSource('billing');
        setOverrideExpiresAt(null);
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
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [supabase]);

    const continueAsGuest = useCallback(() => {
        localStorage.setItem(GUEST_STORAGE_KEY, 'true');
        setIsGuest(true);
        setUserTier('guest');
        setTierSource('billing');
        setOverrideExpiresAt(null);
        setSubscriptionStatus(null);
        setBillingInterval(null);
        setCurrentPeriodEnd(null);
        setTrialEndsAt(null);
        setCancelAtPeriodEnd(false);
        setTierLoading(false);
        setShowAuthModal(false);
        // eslint-disable-next-line react-hooks/exhaustive-deps
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
        tierSource,
        overrideExpiresAt,
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
        tierSource,
        overrideExpiresAt,
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
