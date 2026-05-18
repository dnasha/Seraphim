/**
 * Purpose: Fetches recent events from the database and processes them through the current geocoding engine to generate a fresh benchmark dataset for grading.
 * Usage: bun run scripts/diagnostics/generate-benchmark.ts --limit 100 --out scripts/results/new-grading-100.json
 */

import { createClient } from '@supabase/supabase-js';
import { NewsItem } from '@/lib/core/types';
import { enrichItemsWithLocation, ensureInitialized } from '@/lib/geocoding';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Missing Supabase credentials (SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY).');
    process.exit(1);
}

const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
});

// Parse CLI flags to control sample size and output destination for the generated benchmark.
const args = process.argv.slice(2);
const limitArg = args.indexOf('--limit');
const LIMIT = limitArg !== -1 ? parseInt(args[limitArg + 1], 10) : 100;

const outArg = args.indexOf('--out');
const DEFAULT_OUT = `scripts/results/benchmark-${LIMIT}.json`;
const OUT_PATH = outArg !== -1 ? args[outArg + 1] : DEFAULT_OUT;

const daysAgoArg = args.indexOf('--days-ago');
const DAYS_AGO = daysAgoArg !== -1 ? parseInt(args[daysAgoArg + 1], 10) : 0;

async function run() {
    console.log("Initializing Geocoding Engine...");
    ensureInitialized();

    console.log(`Pulling latest ${LIMIT} events from Supabase (older than ${DAYS_AGO} days ago)...`);
    
    let query = db
        .from('events')
        .select('*');

    if (DAYS_AGO > 0) {
        const cutOffDate = new Date(Date.now() - DAYS_AGO * 24 * 60 * 60 * 1000).toISOString();
        query = query.lt('created_at', cutOffDate);
    }
    
    const { data: events, error } = await query
        .order('created_at', { ascending: false })
        .limit(LIMIT);

    if (error) {
        console.error("Failed to fetch events:", error.message);
        return;
    }

    if (!events || events.length === 0) {
        console.warn("No events found in database.");
        return;
    }

    console.log(`Retrieved ${events.length} events.`);
    console.log(`\nRe-running geocoding engine on fresh data...`);

    // Map database records back to the NewsItem structure required by the enrichment engine.
    const newsItems: NewsItem[] = events.map((e) => ({
        id: e.id,
        title: e.title,
        description: e.description,
        source: e.source,
        sourceType: e.source_type,
        publishedAt: e.published_at,
        url: e.url
    }));

    // Re-process items to capture current engine output for performance comparison.
    const enrichedItems = await enrichItemsWithLocation(newsItems);

    const results = enrichedItems.map((item, idx) => {
        const original = events[idx];
        const found_locations = item.foundLocations || [];

        const current_engine_result = (item.locationName) 
            ? {
                lat: item.latitude,
                lon: item.longitude,
                displayName: item.locationName
            } 
            : null;

        return {
            id: idx + 1,
            db_id: original.id,
            title: item.title,
            description: item.description || '',
            // Retain original database location for point-in-time drift analysis.
            db_location: original.latitude ? {
                lat: original.latitude,
                lon: original.longitude,
                displayName: original.location_name
            } : null,
            // Capture latest engine heuristics output.
            engine_result: current_engine_result,
            found_candidates: found_locations
        };
    });

    const absoluteOutPath = path.resolve(process.cwd(), OUT_PATH);
    const outputDir = path.dirname(absoluteOutPath);
    
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    fs.writeFileSync(absoluteOutPath, JSON.stringify(results, null, 2), 'utf-8');
    
    console.log(`\nDONE`);
    console.log(`Wrote benchmark set to ${absoluteOutPath}`);
    console.log(`Mapped by current engine: ${results.filter(r => r.engine_result).length} / ${results.length}`);
}

run().catch(err => {
    console.error("Benchmark generation failed:", err);
    process.exit(1);
});
