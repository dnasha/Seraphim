/**
 * OAuth callback handler for Supabase Auth.
 * 
 * After authenticating with an OAuth provider (Google, GitHub, Discord),
 * Supabase redirects the user to /auth/callback?code=xxx.
 * This route handler exchanges the PKCE authorization code for a session
 * and redirects the user back to the application root.
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: Request) {
    const { searchParams, origin } = new URL(request.url);
    const code = searchParams.get('code');
    const next = searchParams.get('next') ?? '/';

    if (code) {
        const supabase = await createClient();
        const { error } = await supabase.auth.exchangeCodeForSession(code);

        if (!error) {
            return NextResponse.redirect(`${origin}${next}`);
        }
    }

    // If code exchange fails, redirect to root with error indicator
    return NextResponse.redirect(`${origin}/?auth_error=true`);
}
