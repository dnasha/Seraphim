import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { NewsItem, NewsResponse } from '@/lib/types';
import { DbEvent, dbEventToNewsItem } from '@/types';

/*
  Dan Sharan
  API Proxy Route: Fetches pre-processed events from Supabase.
  This route handles in-memory caching and basic throttling to protect the database.
  The scraper (src/scraper/index.ts) is responsible for data ingestion; this route is read-only.
*/

// Supabase client (read-only anon key, respects RLS)
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
});

// In-memory cache to reduce Supabase egress and improve response times
const sourceCache = new Map<string, { data: NewsItem[]; timestamp: number }>();
const CACHE_TTL = 15 * 60 * 1000; // 15 minutes

const CACHE_KEY = 'events';

const refreshThrottle = new Map<string, number>();
const REFRESH_COOLDOWN = 60 * 1000; // 1 minute

// Rate limit for pagination (prevents scraping/spamming)
const cursorThrottle = new Map<string, number>();
const CURSOR_COOLDOWN = 1500; // 1.5 seconds between page loads

export async function GET(request: Request) {
    const now = Date.now();
    const { searchParams } = new URL(request.url);
    let forceRefresh = searchParams.get('refresh') === 'true';
    const cursor = searchParams.get('cursor');
    const includeUnmapped = searchParams.get('include_unmapped') === 'true';
    const LIMIT = 500;

    // Cache is only used for the default query (no cursor, mapped only)
    const canUseCache = !cursor && !includeUnmapped;

    // Throttle refresh attempts
    if (forceRefresh) {
        const lastRefresh = refreshThrottle.get('global') || 0;
        if (now - lastRefresh < REFRESH_COOLDOWN) {
            forceRefresh = false; // Downgrade to cached version if spammed
        } else {
            refreshThrottle.set('global', now);
        }
    }

    // Rate limit paginated requests
    if (cursor) {
        const ip = request.headers.get('x-forwarded-for')?.split(',')[0] || 'anonymous';
        const lastCursorReq = cursorThrottle.get(ip) || 0;
        if (now - lastCursorReq < CURSOR_COOLDOWN) {
            return NextResponse.json(
                { error: 'Please wait before loading more events' }, 
                { status: 429 }
            );
        }
        cursorThrottle.set(ip, now);
    }

    try {
        let allItems: NewsItem[];
        let nextCursor: string | undefined;

        // Check local cache first (only for default query)
        const cached = sourceCache.get(CACHE_KEY);

        if (canUseCache && !forceRefresh && cached && (now - cached.timestamp) < CACHE_TTL) {
            allItems = cached.data;
        } else {
            // Fetch fresh data from Supabase
            let query = supabase
                .from('events')
                .select('id, title, description, url, source, source_type, category, image_url, published_at, latitude, longitude, location_name')
                .order('published_at', { ascending: false })
                .limit(LIMIT);

            if (!includeUnmapped) {
                query = query.not('latitude', 'is', null);
            }

            if (cursor) {
                query = query.lt('published_at', cursor);
            }

            const { data: rows, error } = await query;

            if (error) {
                console.error('[api/news] Supabase query failed:', error.message);
                return NextResponse.json({ error: 'Failed to fetch news' }, { status: 500 });
            }

            allItems = (rows as DbEvent[]).map(dbEventToNewsItem);
            
            if (rows.length === LIMIT) {
                nextCursor = rows[rows.length - 1].published_at;
            }

            // Only cache the default mapped-only initial view
            if (canUseCache) {
                sourceCache.set(CACHE_KEY, { data: allItems, timestamp: now });
            }
        }

        const response: NewsResponse = {
            items: allItems,
            lastUpdated: new Date().toISOString(),
            nextCursor,
            sources: {
                gnews: true,
                rss: true,
                social: true,
            },
        };

        // If it's a paginated or unmapped query, don't cache aggressively at the Edge to avoid stale slices.
        const cacheControl = canUseCache 
            ? 'public, s-maxage=900, stale-while-revalidate=59' 
            : 'public, s-maxage=60, stale-while-revalidate=10';

        return NextResponse.json(response, {
            headers: {
                'Cache-Control': cacheControl
            }
        });
    } catch (error) {
        console.error('[api/news] Unhandled error:', error);
        return NextResponse.json({ error: 'Failed to fetch news' }, { status: 500 });
    }
}
