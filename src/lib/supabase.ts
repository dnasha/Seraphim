/*
Supabase client initialization.
Provides a shared client instance for frontend and edge functions using the public anonymous key.
*/

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

/* Shared Supabase client instance using the Anon Key. */
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { 
        persistSession: false, 
        autoRefreshToken: false 
    },
});
