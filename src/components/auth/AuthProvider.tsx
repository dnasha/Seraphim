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

    const fetchUserTier = useCallback(async (userId: string | undefined, force = false) => {
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
        
        try {
            console.log('[AuthProvider] Fetching user tier for', userId);
            // Race the database profile query against a 2-second timeout to prevent UI hangs
            const queryPromise = supabase
                .from('user_profiles')
                .select('tier, subscription_status, billing_interval, current_period_end, trial_ends_at, cancel_at_period_end')
                .eq('id', userId)
                .single();
            
            const result = await Promise.race([
                queryPromise,
                new Promise<{ data: null; error: Error | PostgrestError }>((resolve) =>
                    setTimeout(() => resolve({ data: null, error: new Error('Profile query timeout') }), 2000)
                )
            ]);
            
            const { data, error } = result;

            if (error || !data) {
                console.warn('[AuthProvider] Failed to fetch tier, defaulting to free:', error);
                setUserTier('free');
            } else {
                console.log('[AuthProvider] User tier fetched successfully:', data.tier);
                const normalizedTier = (data.tier?.toLowerCase() as UserTier) || 'free';
                setUserTier(normalizedTier);
                setSubscriptionStatus(data.subscription_status);
                setBillingInterval(data.billing_interval);
                setCurrentPeriodEnd(data.current_period_end);
                setTrialEndsAt(data.trial_ends_at);
                setCancelAtPeriodEnd(data.cancel_at_period_end ?? false);
            }
        } catch (err) {
            console.error('[AuthProvider] Error in fetchUserTier:', err);
            setUserTier('free');
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
        const initializeAuth = async () => {
            console.log('[AuthProvider] Starting initializeAuth...');
            try {
                // Check guest preference immediately on mount to minimize UI flicker
                const wasGuest = localStorage.getItem(GUEST_STORAGE_KEY);
                console.log('[AuthProvider] wasGuest preference:', wasGuest);
                if (wasGuest === 'true') {
                    setIsGuest(true);
                }

                // Check initial session locally with a 1.5-second timeout safeguard
                console.log('[AuthProvider] Retrieving local session...');
                const sessionResult = await Promise.race([
                    supabase.auth.getSession(),
                    new Promise<{ data: { session: Session | null } }>((resolve) =>
                        setTimeout(() => resolve({ data: { session: null } }), 1500)
                    )
                ]);
                const initialSession = sessionResult.data?.session ?? null;
                console.log('[AuthProvider] Session retrieved:', initialSession ? 'Found' : 'None');
                
                let verifiedUser = initialSession?.user ?? null;
                let finalSession = initialSession;

                // If we think we have a session, verify it with the server (with a 1.5-second timeout)
                if (initialSession) {
                    console.log('[AuthProvider] Verifying session with server...');
                    const userResult = await Promise.race([
                        supabase.auth.getUser(),
                        new Promise<{ data: { user: User | null }; error: AuthError | Error | null }>((resolve) =>
                            setTimeout(() => resolve({ data: { user: null }, error: new Error('User verify timeout') }), 1500)
                        )
                    ]);
                    const user = userResult.data?.user ?? null;
                    const error = userResult.error;
                    console.log('[AuthProvider] Server verification result:', { hasUser: !!user, hasError: !!error });
                    
                    if (error || !user) {
                        // Token is mathematically valid but server rejected it (deleted/banned)
                        console.warn('[AuthProvider] Server rejected session. Signing out.');
                        await supabase.auth.signOut();
                        verifiedUser = null;
                        finalSession = null;
                    } else {
                        verifiedUser = user;
                    }
                }
                
                setSession(finalSession);
                setUser(verifiedUser);

                if (verifiedUser) {
                    await fetchUserTier(verifiedUser.id, true);
                } else {
                    console.log('[AuthProvider] No verified user, setting guest tier');
                    setUserTier('guest');
                    setTierLoading(false);
                }

                // If no session and not already determined as guest, default to guest mode internally
                // We no longer auto-show the auth modal on first launch to reduce friction.
                if (!finalSession && wasGuest !== 'true') {
                    console.log('[AuthProvider] No active session, enabling Guest Mode');
                    setIsGuest(true);
                }
            } catch (err) {
                console.error('[AuthProvider] Failed to initialize auth:', err);
                setUserTier('guest');
                setTierLoading(false);
            } finally {
                console.log('[AuthProvider] Setting isLoading to false');
                setIsLoading(false);
            }
        };

        initializeAuth();

        // Listen for auth state changes
        const { data: { subscription } } = supabase.auth.onAuthStateChange(
            async (_event, newSession) => {
                setSession(newSession);
                setUser(newSession?.user ?? null);

                // If user signs in, clear guest mode and fetch profile
                if (newSession?.user) {
                    setIsGuest(false);
                    localStorage.removeItem(GUEST_STORAGE_KEY);
                    setShowAuthModal(false);
                    await fetchUserTier(newSession.user.id, true);
                } else {
                    setUserTier('guest');
                    setSubscriptionStatus(null);
                    setBillingInterval(null);
                    setCurrentPeriodEnd(null);
                    setTrialEndsAt(null);
                    setCancelAtPeriodEnd(false);
                    setTierLoading(false);
                }
            }
        );

        return () => {
            subscription.unsubscribe();
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
                console.log(`[AuthProvider] Polling user tier on success redirect (attempt ${attempts}/${maxAttempts})...`);
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
                            console.log('[AuthProvider] Premium tier detected via polling, stopping poll.');
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

    const value = useMemo<AuthContextType>(() => ({
        user,
        session,
        isLoading,
        isGuest,
        supabase,
        signOut,
        continueAsGuest,
        showAuthModal,
        setShowAuthModal,
        // Shared states
        userTier,
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
        isGuest,
        supabase,
        signOut,
        continueAsGuest,
        showAuthModal,
        userTier,
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
