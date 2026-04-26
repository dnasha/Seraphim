import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { DbEvent } from '@/types';

/*
  Dan Sharan
  Detail Endpoint: Fetches the full description of a single event by UUID.
  Called on-demand when a user expands a sidebar card.
  This keeps the initial list payload small (no descriptions) and fetches
  the heavier text content only when the user actually requests it.
*/

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
});

// Simple in-memory cache so expanding/collapsing a card doesn't re-fetch
const detailCache = new Map<string, { description: string; timestamp: number }>();
const DETAIL_CACHE_TTL = 30 * 60 * 1000; // 30 minutes — descriptions rarely change

export async function GET(
    _request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;

    if (!id) {
        return NextResponse.json({ error: 'Missing event id' }, { status: 400 });
    }

    // Check server-side detail cache first
    const cached = detailCache.get(id);
    if (cached && Date.now() - cached.timestamp < DETAIL_CACHE_TTL) {
        return NextResponse.json(
            { description: cached.description },
            { headers: { 'Cache-Control': 'public, s-maxage=1800, stale-while-revalidate=60' } }
        );
    }

    const { data, error } = await supabase
        .from('events')
        .select('description')
        .eq('id', id)
        .single<Pick<DbEvent, 'description'>>();

    if (error || !data) {
        console.error('[api/news/[id]] Supabase query failed:', error?.message);
        return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    }

    detailCache.set(id, { description: data.description ?? '', timestamp: Date.now() });

    return NextResponse.json(
        { description: data.description ?? '' },
        { headers: { 'Cache-Control': 'public, s-maxage=1800, stale-while-revalidate=60' } }
    );
}
