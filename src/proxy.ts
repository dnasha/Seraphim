/**
 * Next.js Proxy (formerly Middleware) for Supabase Auth session management.
 * 
 * Runs on every request to refresh expired auth tokens via cookies.
 * This is CRITICAL — without it, Server Components cannot see the user's
 * session because cookies may contain stale tokens.
 * 
 * This middleware does NOT redirect or block any routes. Seraphim is
 * fully public with optional authentication; gating is handled client-side.
 */

import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export async function proxy(request: NextRequest) {
    let supabaseResponse = NextResponse.next({
        request,
    });

    const supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
            cookies: {
                getAll() {
                    return request.cookies.getAll();
                },
                setAll(cookiesToSet) {
                    cookiesToSet.forEach(({ name, value }) =>
                        request.cookies.set(name, value)
                    );
                    supabaseResponse = NextResponse.next({
                        request,
                    });
                    cookiesToSet.forEach(({ name, value, options }) =>
                        supabaseResponse.cookies.set(name, value, options)
                    );
                },
            },
        }
    );

    // IMPORTANT: Do not add code between createServerClient and
    // supabase.auth.getUser(). A simple mistake could make it very
    // hard to debug issues with users being randomly logged out.

    // IMPORTANT: DO NOT REMOVE auth.getUser()
    // This call refreshes the auth token if expired and syncs cookies.
    await supabase.auth.getUser();

    // IMPORTANT: Return the supabaseResponse object as-is.
    // Modifying cookies on a new response object will desync
    // browser and server session state.
    return supabaseResponse;
}

export const config = {
    matcher: [
        /*
         * Match all request paths except:
         * - _next/static (static files)
         * - _next/image (image optimization)
         * - favicon.ico, manifest.json, and static assets
         */
        '/((?!_next/static|_next/image|favicon.ico|manifest.json|sw.js|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
    ],
};
