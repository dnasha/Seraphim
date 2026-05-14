/**
 * News Detail API
 * 
 * Fetches the full content (description and source list) for a specific event 
 * by its unique UUID. Implements server-side caching to optimize for 
 * repetitive detail requests.
 */

import { NextResponse } from 'next/server';
import { supabase } from '@/lib/core/supabase';
import { DbEvent } from '@/types';

/**
 * In-memory cache for event details. 
 * Stores the heavy JSONB 'sources' and 'description' columns which are 
 * excluded from the primary list fetch.
 */
const detailCache = new Map<string, { description: string; sources: DbEvent['sources']; latitude?: number; longitude?: number; timestamp: number }>();
const DETAIL_CACHE_TTL = 1800000;

export async function GET(
    _request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;

    if (!id) {
        return NextResponse.json({ error: 'Invalid event id' }, { status: 400 });
    }

    /**
     * Strict UUID validation to prevent injection attempts or malformed 
     * database queries.
     */
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(id)) {
        return NextResponse.json({ error: 'Invalid UUID format' }, { status: 400 });
    }

    const cached = detailCache.get(id);
    if (cached && Date.now() - cached.timestamp < DETAIL_CACHE_TTL) {
        return NextResponse.json(
            { description: cached.description, sources: cached.sources ?? [] },
            { headers: { 'Cache-Control': 'public, s-maxage=1800, stale-while-revalidate=60' } }
        );
    }

    const { data, error } = await supabase
        .from('events')
        .select('description, sources, latitude, longitude')
        .eq('id', id)
        .single<Pick<DbEvent, 'description' | 'sources' | 'latitude' | 'longitude'>>();

    if (error || !data) {
        console.error('[api/news/[id]] Supabase query failed:', error?.message);
        return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    }

    detailCache.set(id, { 
        description: data.description ?? '', 
        sources: data.sources ?? [], 
        latitude: data.latitude ?? undefined,
        longitude: data.longitude ?? undefined,
        timestamp: Date.now() 
    });

    return NextResponse.json(
        { 
            description: data.description ?? '', 
            sources: data.sources ?? [],
            latitude: data.latitude,
            longitude: data.longitude
        },
        { headers: { 'Cache-Control': 'public, s-maxage=1800, stale-while-revalidate=60' } }
    );
}

