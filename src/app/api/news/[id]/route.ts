/**
 * Exact Event Detail API
 *
 * UUIDs are unguessable capability identifiers. This route intentionally
 * returns one event by exact ID so a shared link continues to work outside the
 * viewer's time-range entitlement, while never exposing historical listing or
 * search access.
 */

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/core/supabase-admin';
import { dbEventToNewsItem, type DbEvent } from '@/types';
import { resolveRequestEntitlements } from '@/lib/server/entitlements';
import { getRateLimitKeys, getTrustedClientIp } from '@/lib/security/clientIdentity';
import { createRequestRateLimiter } from '@/lib/security/requestRateLimit';

type CachedDetail = {
    row: DbEvent;
    timestamp: number;
};

const detailCache = new Map<string, CachedDetail>();
const DETAIL_CACHE_TTL = 60 * 1000;
const DETAIL_CACHE_MAX_ENTRIES = 250;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PRIVATE_HEADERS = {
    'Cache-Control': 'private, no-store',
    'X-Robots-Tag': 'noindex, nofollow, noarchive',
};

const requestRateLimit = createRequestRateLimiter({
    prefix: '@upstash/ratelimit/seraphim-exact-event', limit: 60, localLimit: 60, localWindowMs: 60_000,
});

function pruneCaches(now: number) {
    for (const [id, cached] of detailCache) {
        if (now - cached.timestamp >= DETAIL_CACHE_TTL) detailCache.delete(id);
    }
    while (detailCache.size > DETAIL_CACHE_MAX_ENTRIES) {
        const oldest = detailCache.keys().next().value as string | undefined;
        if (!oldest) break;
        detailCache.delete(oldest);
    }
}

function sourcesForTier(row: DbEvent, sourceLimit: number | null) {
    const primary = {
        name: row.source,
        url: row.url,
        source_type: row.source_type,
        discovered_at: row.primary_discovered_at ?? row.published_at,
    };
    const unique = new Map<string, NonNullable<DbEvent['sources']>[number]>();
    for (const source of [primary, ...(row.sources ?? [])]) {
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

function responseForRow(row: DbEvent, sourceLimit: number | null) {
    const timeline = sourcesForTier(row, sourceLimit);
    const event = dbEventToNewsItem({ ...row, sources: timeline.sources });
    return {
        description: row.description ?? '',
        ...timeline,
        latitude: row.latitude,
        longitude: row.longitude,
        event: {
            ...event,
            description: row.description ?? '',
            timelineRestricted: timeline.timelineRestricted,
            totalSources: timeline.totalSources,
        },
    };
}

export async function GET(
    request: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    const { id } = await params;
    if (!id) return NextResponse.json({ error: 'Invalid event id' }, { status: 400, headers: PRIVATE_HEADERS });
    if (!UUID_PATTERN.test(id)) {
        return NextResponse.json({ error: 'Invalid UUID format' }, { status: 400, headers: PRIVATE_HEADERS });
    }

    const clientIp = getTrustedClientIp(request.headers);
    if (!clientIp) return NextResponse.json({ error: 'Too many requests' }, {
        status: 429, headers: { ...PRIVATE_HEADERS, 'Retry-After': '60' },
    });
    const now = Date.now();
    const networkLimit = await requestRateLimit.check(getRateLimitKeys(clientIp), now);
    if (!networkLimit.allowed) return NextResponse.json({ error: 'Too many requests' }, {
        status: 429, headers: { ...PRIVATE_HEADERS, 'Retry-After': String(networkLimit.retryAfterSeconds) },
    });
    const access = await resolveRequestEntitlements();
    if (access.userId) {
        const accountLimit = await requestRateLimit.check([`user:${access.userId}`], now);
        if (!accountLimit.allowed) return NextResponse.json({ error: 'Too many requests' }, {
            status: 429, headers: { ...PRIVATE_HEADERS, 'Retry-After': String(accountLimit.retryAfterSeconds) },
        });
    }
    pruneCaches(now);

    const cached = detailCache.get(id);
    const forceRefresh = new URL(request.url).searchParams.get('refresh') === 'true';
    if (!forceRefresh && cached && now - cached.timestamp < DETAIL_CACHE_TTL) {
        return NextResponse.json(responseForRow(cached.row, access.entitlements.timelineSourceLimit), { headers: PRIVATE_HEADERS });
    }

    const { data, error } = await supabaseAdmin
        .from('events')
        .select('id, title, description, description_provenance, independent_publisher_count, url, source, source_type, category, image_url, published_at, latitude, longitude, location_name, impact_score, credibility_tier, event_count, sources, primary_discovered_at')
        .eq('id', id)
        .single<DbEvent>();

    if (error && error.code !== 'PGRST116') {
        console.error('[api/news/[id]] Supabase query failed:', error?.message);
        return NextResponse.json({ error: 'Event temporarily unavailable' }, { status: 503, headers: PRIVATE_HEADERS });
    }
    if (!data) {
        return NextResponse.json({ error: 'Event not found' }, { status: 404, headers: PRIVATE_HEADERS });
    }

    detailCache.set(id, { row: data, timestamp: now });
    pruneCaches(now);
    return NextResponse.json(responseForRow(data, access.entitlements.timelineSourceLimit), { headers: PRIVATE_HEADERS });
}
