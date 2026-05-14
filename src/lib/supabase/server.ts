/**
 * Server-side Supabase client for authentication.
 * 
 * Uses `createServerClient` from @supabase/ssr with Next.js cookie access
 * via `next/headers`. Suitable for Server Components, Route Handlers, 
 * and Server Actions that need to read the user's auth session.
 */

import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export async function createClient() {
    const cookieStore = await cookies();

    return createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
            cookies: {
                getAll() {
                    return cookieStore.getAll();
                },
                setAll(cookiesToSet) {
                    try {
                        cookiesToSet.forEach(({ name, value, options }) =>
                            cookieStore.set(name, value, options)
                        );
                    } catch {
                        // setAll can be called from Server Components where cookies
                        // cannot be set. This is safe to ignore when the middleware
                        // handles the session refresh.
                    }
                },
            },
        }
    );
}
