/**
 * Exact Event Detail API
 *
 * UUIDs are unguessable capability identifiers. This route intentionally
 * returns one event by exact ID so a shared link continues to work outside the
 * viewer's time-range entitlement, while never exposing historical listing or
 * search access.
 */

import { NextResponse } from 'next/server';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { supabaseAdmin } from '@/lib/core/supabase-admin';
import { dbEventToNewsItem, type DbEvent } from '@/types';
import { resolveRequestEntitlements } from '@/lib/server/entitlements';
import { getRateLimitKeys, getTrustedClientIp } from '@/lib/security/clientIdentity';

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

const redis = Redis.fromEnv();
const distributedRateLimit = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(60, '1 m'),
    analytics: true,
    prefix: '@upstash/ratelimit/seraphim-exact-event',
});
const localRateLimit = new Map<string, { count: number; resetAt: number }>();

function pruneCaches(now: number) {
    for (const [id, cached] of detailCache) {
        if (now - cached.timestamp >= DETAIL_CACHE_TTL) detailCache.delete(id);
    }
    while (detailCache.size > DETAIL_CACHE_MAX_ENTRIES) {
        const oldest = detailCache.keys().next().value as string | undefined;
        if (!oldest) break;
        detailCache.delete(oldest);
    }
    for (const [key, state] of localRateLimit) {
        if (state.resetAt <= now) localRateLimit.delete(key);
    }
}

async function allowExactEventRequest(keys: string[], now: number) {
    for (const key of keys) {
        const state = localRateLimit.get(key);
        if (!state || state.resetAt <= now) {
            localRateLimit.set(key, { count: 1, resetAt: now + 60_000 });
        } else {
            state.count += 1;
            if (state.count > 60) return false;
        }
    }

    try {
        const results = await Promise.all(keys.map((key) => distributedRateLimit.limit(key)));
        return results.every((result) => result.success);
    } catch (error) {
        // The local hard limit still protects this instance during a Redis outage.
        console.error('[api/news/[id]] Distributed rate limiter unavailable.', error);
        return true;
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

    const access = await resolveRequestEntitlements();
    const clientIp = getTrustedClientIp(request.headers);
    if (!clientIp) {
        return NextResponse.json(
            { error: 'Too many requests' },
            { status: 429, headers: { ...PRIVATE_HEADERS, 'Retry-After': '60' } },
        );
    }
    const now = Date.now();
    pruneCaches(now);
    const allowed = await allowExactEventRequest(getRateLimitKeys(clientIp, access.userId), now);
    if (!allowed) {
        return NextResponse.json(
            { error: 'Too many requests' },
            { status: 429, headers: { ...PRIVATE_HEADERS, 'Retry-After': '60' } },
        );
    }

    const cached = detailCache.get(id);
    const forceRefresh = new URL(request.url).searchParams.get('refresh') === 'true';
    if (!forceRefresh && cached && now - cached.timestamp < DETAIL_CACHE_TTL) {
        return NextResponse.json(responseForRow(cached.row, access.entitlements.timelineSourceLimit), { headers: PRIVATE_HEADERS });
    }

    const { data, error } = await supabaseAdmin
        .from('events')
        .select('id, title, description, url, source, source_type, category, image_url, published_at, latitude, longitude, location_name, impact_score, credibility_tier, event_count, sources, primary_discovered_at')
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
