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

// Basic throttle for refresh bypass (prevents rapid-fire database hits)
const refreshThrottle = new Map<string, number>();
const REFRESH_COOLDOWN = 60 * 1000; // 1 minute

export async function GET(request: Request) {
    const now = Date.now();
    const { searchParams } = new URL(request.url);
    let forceRefresh = searchParams.get('refresh') === 'true';

    // Throttle refresh attempts
    if (forceRefresh) {
        const lastRefresh = refreshThrottle.get('global') || 0;
        if (now - lastRefresh < REFRESH_COOLDOWN) {
            forceRefresh = false; // Downgrade to cached version if spammed
        } else {
            refreshThrottle.set('global', now);
        }
    }

    try {
        // Check local cache first
        const cached = sourceCache.get(CACHE_KEY);
        let allItems: NewsItem[];

        if (!forceRefresh && cached && (now - cached.timestamp) < CACHE_TTL) {
            allItems = cached.data;
        } else {
            // Fetch fresh data from Supabase
            const { data: rows, error } = await supabase
                .from('events')
                .select('id, title, description, url, source, source_type, category, image_url, published_at, latitude, longitude, location_name')
                .order('published_at', { ascending: false })
                .limit(500);

            if (error) {
                console.error('[api/news] Supabase query failed:', error.message);
                return NextResponse.json({ error: 'Failed to fetch news' }, { status: 500 });
            }

            allItems = (rows as DbEvent[]).map(dbEventToNewsItem);
            sourceCache.set(CACHE_KEY, { data: allItems, timestamp: now });
        }

        const response: NewsResponse = {
            items: allItems,
            lastUpdated: new Date().toISOString(),
            sources: {
                gnews: true,
                rss: true,
                social: true,
            },
        };

        return NextResponse.json(response, {
            headers: {
                // Cache at the Edge for 15 minutes to eliminate server loads
                'Cache-Control': 'public, s-maxage=900, stale-while-revalidate=59'
            }
        });
    } catch (error) {
        console.error('[api/news] Unhandled error:', error);
        return NextResponse.json({ error: 'Failed to fetch news' }, { status: 500 });
    }
}
