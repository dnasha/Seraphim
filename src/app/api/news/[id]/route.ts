/**
 * News Detail API
 * 
 * Fetches the full content (description and source list) for a specific event 
 * by its unique UUID. Implements server-side caching to optimize for 
 * repetitive detail requests.
 */

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/core/supabase-admin';
import { DbEvent } from '@/types';
import { resolveRequestEntitlements } from '@/lib/server/entitlements';

/**
 * In-memory cache for event details. 
 * Stores the heavy JSONB 'sources' and 'description' columns which are 
 * excluded from the primary list fetch.
 */
type CachedDetail = {
    description: string;
    sources: DbEvent['sources'];
    source: string;
    sourceType: DbEvent['source_type'];
    url: string;
    primaryDiscoveredAt: string;
    latitude?: number;
    longitude?: number;
    timestamp: number;
};

const detailCache = new Map<string, CachedDetail>();
const DETAIL_CACHE_TTL = 1800000;

function sourcesForTier(detail: Pick<CachedDetail, 'sources' | 'source' | 'sourceType' | 'url' | 'primaryDiscoveredAt'>, sourceLimit: number | null) {
    const primary = {
        name: detail.source,
        url: detail.url,
        source_type: detail.sourceType,
        discovered_at: detail.primaryDiscoveredAt,
    };
    const unique = new Map<string, NonNullable<DbEvent['sources']>[number]>();
    for (const source of [primary, ...(detail.sources ?? [])]) {
        if (!unique.has(source.url)) unique.set(source.url, source);
    }
    const sorted = [...unique.values()].sort((a, b) =>
        new Date(a.discovered_at).getTime() - new Date(b.discovered_at).getTime(),
    );
    if (sourceLimit === null) return { sources: sorted, timelineRestricted: false, totalSources: sorted.length };
    if (sourceLimit === 0) return { sources: [primary], timelineRestricted: sorted.length > 1, totalSources: sorted.length };
    if (sorted.length <= sourceLimit) return { sources: sorted, timelineRestricted: false, totalSources: sorted.length };
    const otherSources = sorted.filter((source) => source.url !== primary.url);
    return {
        sources: [primary, ...otherSources.slice(-(Math.max(0, sourceLimit - 1)))],
        timelineRestricted: true,
        totalSources: sorted.length,
    };
}

export async function GET(
    _request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const access = await resolveRequestEntitlements();
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
        const timeline = sourcesForTier(cached, access.entitlements.timelineSourceLimit);
        return NextResponse.json(
            {
                description: cached.description,
                ...timeline,
                latitude: cached.latitude,
                longitude: cached.longitude,
            },
            { headers: { 'Cache-Control': 'private, no-store' } }
        );
    }

    const { data, error } = await supabaseAdmin
        .from('events')
        .select('description, sources, source, source_type, url, primary_discovered_at, published_at, latitude, longitude')
        .eq('id', id)
        .single<Pick<DbEvent, 'description' | 'sources' | 'source' | 'source_type' | 'url' | 'primary_discovered_at' | 'published_at' | 'latitude' | 'longitude'>>();

    if (error || !data) {
        console.error('[api/news/[id]] Supabase query failed:', error?.message);
        return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    }

    detailCache.set(id, { 
        description: data.description ?? '', 
        sources: data.sources ?? [], 
        source: data.source,
        sourceType: data.source_type,
        url: data.url,
        primaryDiscoveredAt: data.primary_discovered_at ?? data.published_at,
        latitude: data.latitude ?? undefined,
        longitude: data.longitude ?? undefined,
        timestamp: Date.now() 
    });

    const timeline = sourcesForTier({
        sources: data.sources,
        source: data.source,
        sourceType: data.source_type,
        url: data.url,
        primaryDiscoveredAt: data.primary_discovered_at ?? data.published_at,
    }, access.entitlements.timelineSourceLimit);
    return NextResponse.json(
        { 
            description: data.description ?? '', 
            ...timeline,
            latitude: data.latitude,
            longitude: data.longitude
        },
        { headers: { 'Cache-Control': 'private, no-store' } }
    );
}

