import { createClient } from '@supabase/supabase-js';

if (process.env.NODE_ENV !== 'test' && !process.env.VITEST && !process.env.IS_BENCHMARK && !process.versions?.bun) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('server-only');
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL) {
    throw new Error(
        'Missing Supabase URL configuration. ' +
        'Ensure NEXT_PUBLIC_SUPABASE_URL or SUPABASE_URL is set in the environment.'
    );
}

if (!SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
        'Missing Supabase service role key. ' +
        'Ensure SUPABASE_SERVICE_ROLE_KEY is set in the environment.'
    );
}

/**
 * Administrative Supabase client instance using the Service Role Key.
 * This client bypasses Row Level Security (RLS) and should only be used 
 * in secure, server-side environments like the ingestion scraper or API routes.
 */
export const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { 
        persistSession: false, 
        autoRefreshToken: false 
    },
});

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
