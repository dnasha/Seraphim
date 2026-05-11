/*
Supabase client initialization.
Provides a shared client instance for frontend and edge functions using the public anonymous key.
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

/* Shared Supabase client instance using the Anon Key. */
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { 
        persistSession: false, 
        autoRefreshToken: false 
    },
});

/**
 * Shared Supabase Admin client instance using the Service Role Key.
 * Only available in server-side/scraper contexts.
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
 * Validation for administrative tasks that require the Service Role Key.
 * Throws if the key is missing.
 */
export function validateServiceRoleConfig() {
    if (!SUPABASE_SERVICE_ROLE_KEY) {
        throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY environment variable.');
    }
    return { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY };
}
