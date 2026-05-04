/*
  News detail API route.
  Fetches the full description for a specific news event identified by its UUID.
  Implements server-side caching to optimize performance for repetitive detail requests.
*/

import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { DbEvent } from '@/types';

// In-memory cache for event descriptions to reduce database load
const detailCache = new Map<string, { description: string; timestamp: number }>();
const DETAIL_CACHE_TTL = 30 * 60 * 1000; // 30 minutes

export async function GET(
    _request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;

    if (!id) {
        return NextResponse.json({ error: 'Invalid event id' }, { status: 400 });
    }

    // Validate UUID format to prevent malformed queries to Supabase
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(id)) {
        return NextResponse.json({ error: 'Invalid UUID format' }, { status: 400 });
    }

    // Return cached description if available and within TTL
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

