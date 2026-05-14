import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';

export async function POST(request: Request) {
  try {
    // CSRF Protection: Verify Origin
    const origin = request.headers.get('origin') || request.headers.get('referer');
    const host = request.headers.get('host');
    
    if (origin && host) {
      try {
        const originUrl = new URL(origin);
        if (originUrl.host !== host) {
          return NextResponse.json({ error: 'CSRF validation failed.' }, { status: 403 });
        }
      } catch {
        // Invalid origin format
      }
    }

    const cookieStore = await cookies();
    
    // 1. Initialize SSR Client to verify the requesting user's session
    const supabaseClient = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          get(name: string) {
            return cookieStore.get(name)?.value;
          },
          set(name: string, value: string, options: CookieOptions) {
            // Not strictly necessary for a simple POST action, but good practice
            cookieStore.set({ name, value, ...options });
          },
          remove(name: string, options: CookieOptions) {
            cookieStore.delete({ name, ...options });
          },
        },
      }
    );

    const { data: { user }, error: userError } = await supabaseClient.auth.getUser();

    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized request.' }, { status: 401 });
    }

    const userId = user.id;

    // 2. Initialize Admin Client to perform the deletion
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!serviceRoleKey) {
      console.error('CRITICAL: SUPABASE_SERVICE_ROLE_KEY is missing from environment variables.');
      return NextResponse.json({ error: 'Server configuration error.' }, { status: 500 });
    }

    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      serviceRoleKey,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        }
      }
    );

    // 3. Delete the user
    const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(userId);

    if (deleteError) {
      console.error('Failed to delete user:', deleteError);
      return NextResponse.json({ error: deleteError.message }, { status: 500 });
    }

    // Success
    return NextResponse.json({ success: true, message: 'Account deleted successfully.' }, { status: 200 });
    
  } catch (error: unknown) {
    console.error('Account deletion error:', error);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
