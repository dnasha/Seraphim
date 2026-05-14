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

import React, { createContext, useEffect, useState, useMemo, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { User, Session, SupabaseClient } from '@supabase/supabase-js';

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
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const supabase = useMemo(() => createClient(), []);
    const [user, setUser] = useState<User | null>(null);
    const [session, setSession] = useState<Session | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isGuest, setIsGuest] = useState(false);
    const [showAuthModal, setShowAuthModal] = useState(false);

    useEffect(() => {
        const initializeAuth = async () => {
            // Check guest preference immediately on mount to minimize UI flicker
            const wasGuest = localStorage.getItem(GUEST_STORAGE_KEY);
            if (wasGuest === 'true') {
                setIsGuest(true);
            }

            // Check initial session
            const { data: { session: initialSession } } = await supabase.auth.getSession();
            
            setSession(initialSession);
            setUser(initialSession?.user ?? null);

            // If no session and not already determined as guest, show auth modal
            if (!initialSession && wasGuest !== 'true') {
                // First visit — show auth modal
                setShowAuthModal(true);
            }

            setIsLoading(false);
        };

        initializeAuth();

        // Listen for auth state changes
        const { data: { subscription } } = supabase.auth.onAuthStateChange(
            (_event, newSession) => {
                setSession(newSession);
                setUser(newSession?.user ?? null);

                // If user signs in, clear guest mode
                if (newSession?.user) {
                    setIsGuest(false);
                    localStorage.removeItem(GUEST_STORAGE_KEY);
                    setShowAuthModal(false);
                }
            }
        );

        return () => {
            subscription.unsubscribe();
        };
    }, [supabase]);

    const signOut = useCallback(async () => {
        await supabase.auth.signOut();
        setUser(null);
        setSession(null);
        setIsGuest(false);
        localStorage.removeItem(GUEST_STORAGE_KEY);
        // Show auth modal again after sign out
        setShowAuthModal(true);
    }, [supabase]);

    const continueAsGuest = useCallback(() => {
        localStorage.setItem(GUEST_STORAGE_KEY, 'true');
        setIsGuest(true);
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
    }), [user, session, isLoading, isGuest, supabase, signOut, continueAsGuest, showAuthModal]);

    return (
        <AuthContext.Provider value={value}>
            {children}
        </AuthContext.Provider>
    );
}
