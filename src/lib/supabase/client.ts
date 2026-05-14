/**
 * Browser-side Supabase client for authentication.
 * 
 * Uses `createBrowserClient` from @supabase/ssr which automatically manages
 * cookie-based sessions. This is the ONLY Supabase client that should be 
 * used in React client components for auth operations.
 * 
 * Note: The existing `src/lib/core/supabase.ts` remains separate and handles
 * data-fetching for the scraper and API routes.
 */

import { createBrowserClient } from '@supabase/ssr';

export function createClient() {
    return createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
}
