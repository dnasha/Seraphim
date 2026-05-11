/**
 * Supabase client initialization for the Seraphim platform.
 * 
 * Provides unified client instances for both frontend and administrative 
 * operations. The standard client uses the public anonymous key for 
 * client side requests, while the admin client is reserved for 
 * server side and scraper operations requiring elevated permissions.
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error(
        'Missing Supabase public configuration. ' +
        'Ensure NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are set in .env.local'
    );
}

/**
 * Shared Supabase client instance using the Public Anonymous Key.
 * Suitable for client side data fetching and unauthenticated operations.
 */
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { 
        persistSession: false, 
        autoRefreshToken: false 
    },
});

/**
 * Administrative Supabase client instance using the Service Role Key.
 * This client bypasses Row Level Security (RLS) and should only be used 
 * in secure, server side environments like the ingestion scraper.
 */
export const supabaseAdmin = SUPABASE_SERVICE_ROLE_KEY 
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        auth: { 
            persistSession: false, 
            autoRefreshToken: false 
        },
    })
    : null;

/**
 * Validates the existence of administrative configuration.
 * Throws an error if the service role key is missing, ensuring 
 * that administrative tasks do not fail silently.
 */
export function validateServiceRoleConfig() {
    if (!SUPABASE_SERVICE_ROLE_KEY) {
        throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY environment variable.');
    }
    return { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY };
}
