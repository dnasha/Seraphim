/**
 * useAuth hook — convenience accessor for the AuthContext.
 * 
 * Returns the current user, session, loading state, guest status,
 * Supabase client, and auth actions (signOut, continueAsGuest).
 * 
 * Must be used within an AuthProvider.
 */

'use client';

import { useContext } from 'react';
import { AuthContext } from '@/components/auth/AuthProvider';

export function useAuth() {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
}
