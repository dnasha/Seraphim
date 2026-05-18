/**
 * Supabase client initialization for the Seraphim platform.
 * 
 * Provides unified client instances for both frontend and administrative 
 * operations. The standard client uses the public anonymous key for 
 * client side requests, while the admin client is reserved for 
 * server side and scraper operations requiring elevated permissions.
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL) {
    throw new Error(
        'Missing Supabase URL configuration. ' +
        'Ensure NEXT_PUBLIC_SUPABASE_URL or SUPABASE_URL is set in the environment.'
    );
}

if (!SUPABASE_ANON_KEY) {
    throw new Error(
        'Missing Supabase credentials. ' +
        'Ensure NEXT_PUBLIC_SUPABASE_ANON_KEY is set.'
    );
}

/**
 * Shared Supabase client instance using the Public Anonymous Key.
 * Suitable for client side data fetching and unauthenticated operations.
 */
export const supabase = createClient(
    SUPABASE_URL, 
    SUPABASE_ANON_KEY || 'missing_anon_key', 
    {
        auth: {
            persistSession: false,
            autoRefreshToken: false,
            detectSessionInUrl: false,
            storageKey: 'sb-seraphim-data-client'
        }
    }
);

