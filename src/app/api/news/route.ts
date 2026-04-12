import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { NewsItem, NewsResponse } from '@/lib/types';
import { DbEvent, dbEventToNewsItem } from '@/types';

/*
Dan Sharan

API route — Supabase data proxy
Fetches pre-processed events from the database and applies optional
client-driven filters (categories, sources, time range, search).

The scraper (src/scraper/index.ts) is solely responsible for ingesting new data.
This route is intentionally "dumb": no RSS parsing, no geocoding.
*/

// ─── Supabase client (read-only anon key, respects RLS) ───────────────────────
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
});

// ─── In-memory cache — shields Supabase from read bursts ─────────────────────
const sourceCache = new Map<string, { data: NewsItem[]; timestamp: number }>();
const CACHE_TTL = 15 * 60 * 1000; // 15 minutes

const CACHE_KEY = 'events';

// Basic throttle for refresh bypass (in-memory, per-server-instance)
const refreshThrottle = new Map<string, number>();
const REFRESH_COOLDOWN = 60 * 1000; // 1 minute

export async function GET(request: Request) {
    const now = Date.now();
    const { searchParams } = new URL(request.url);
    const categoriesArray = (searchParams.get('categories') || 'general').split(',');
    let search = searchParams.get('search');
    if (search && search.length > 200) search = search.slice(0, 200);

    const sourcesParam = searchParams.get('sources') || 'news,reddit,x,telegram,extra';
    const sources = sourcesParam.split(',');
    const timeRange = searchParams.get('timeRange') || 'all';
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
        // ── Cache check ───────────────────────────────────────────────────────
        const cached = sourceCache.get(CACHE_KEY);
        let allItems: NewsItem[];

        if (!forceRefresh && cached && (now - cached.timestamp) < CACHE_TTL) {
            allItems = cached.data;
        } else {
            // ── Supabase query ────────────────────────────────────────────────
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

        // ── Filters ───────────────────────────────────────────────────────────
        let filteredItems = allItems;

        // source filter
        filteredItems = filteredItems.filter(item => {
            if (sources.includes('news') && item.sourceType === 'rss') return true;
            if (sources.includes('extra') && item.sourceType === 'gnews') return true;
            if (item.sourceType === 'social') {
                const s = item.source.toLowerCase();
                if (sources.includes('reddit') && s.includes('reddit')) return true;
                if (sources.includes('x') && (s.includes('x)') || s.includes('twitter'))) return true;
                if (sources.includes('telegram') && s.includes('telegram')) return true;
            }
            return false;
        });

        // category filter
        if (!categoriesArray.includes('general')) {
            filteredItems = filteredItems.filter(item =>
                item.category && categoriesArray.includes(item.category)
            );
        }

        // time range filter
        if (timeRange !== 'all') {
            let msCutoff = 0;
            switch (timeRange) {
                case '1d': msCutoff = 24 * 60 * 60 * 1000; break;
                case '3d': msCutoff = 3 * 24 * 60 * 60 * 1000; break;
                case '1w': msCutoff = 7 * 24 * 60 * 60 * 1000; break;
                case '1m': msCutoff = 30 * 24 * 60 * 60 * 1000; break;
            }
            if (msCutoff > 0) {
                filteredItems = filteredItems.filter(
                    item => (now - new Date(item.publishedAt).getTime()) <= msCutoff
                );
            }
        }

        // search filter
        if (search) {
            const searchLower = search.toLowerCase();
            filteredItems = filteredItems.filter(item =>
                item.title.toLowerCase().includes(searchLower) ||
                (item.description && item.description.toLowerCase().includes(searchLower))
            );
        }

        // sort by date (Supabase already orders, but filters may scramble it)
        filteredItems.sort((a, b) =>
            new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
        );

        const response: NewsResponse = {
            items: filteredItems,
            lastUpdated: new Date().toISOString(),
            sources: {
                gnews: sources.includes('extra'),
                rss: sources.includes('news'),
                social: sources.includes('reddit') || sources.includes('x') || sources.includes('telegram'),
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
