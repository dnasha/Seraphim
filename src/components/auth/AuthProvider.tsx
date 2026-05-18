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
import type { User, Session, SupabaseClient } from '@supabase/supabase-js';
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
            const { data, error } = await supabase
                .from('user_profiles')
                .select('tier, subscription_status, billing_interval, current_period_end, trial_ends_at, cancel_at_period_end')
                .eq('id', userId)
                .single();

            if (error || !data) {
                setUserTier('free');
            } else {
                setUserTier((data.tier as UserTier) || 'free');
                setSubscriptionStatus(data.subscription_status);
                setBillingInterval(data.billing_interval);
                setCurrentPeriodEnd(data.current_period_end);
                setTrialEndsAt(data.trial_ends_at);
                setCancelAtPeriodEnd(data.cancel_at_period_end ?? false);
            }
        } catch {
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
            // Check guest preference immediately on mount to minimize UI flicker
            const wasGuest = localStorage.getItem(GUEST_STORAGE_KEY);
            if (wasGuest === 'true') {
                setIsGuest(true);
            }

            // Check initial session locally
            const { data: { session: initialSession } } = await supabase.auth.getSession();
            
            let verifiedUser = initialSession?.user ?? null;
            let finalSession = initialSession;

            // If we think we have a session, verify it with the server
            // This catches cases where the account was manually deleted or banned in the dashboard
            if (initialSession) {
                const { data: { user }, error } = await supabase.auth.getUser();
                if (error || !user) {
                    // Token is mathematically valid but server rejected it (deleted/banned)
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
                setUserTier('guest');
                setTierLoading(false);
            }

            // If no session and not already determined as guest, default to guest mode internally
            // We no longer auto-show the auth modal on first launch to reduce friction.
            if (!finalSession && wasGuest !== 'true') {
                setIsGuest(true);
            }

            setIsLoading(false);
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
                    await fetchUserTier(newSession.user.id);
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

    // Single global listener: handle Stripe success redirection (with 2s delay)
    useEffect(() => {
        if (typeof window === 'undefined') return;
        const params = new URLSearchParams(window.location.search);
        let timer: NodeJS.Timeout | undefined;
        if (params.get('checkout') === 'success' && user?.id) {
            timer = setTimeout(async () => {
                await fetchUserTier(user.id, true);
            }, 2000);
        }
        return () => {
            if (timer) clearTimeout(timer);
        };
    }, [user, fetchUserTier]);

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
