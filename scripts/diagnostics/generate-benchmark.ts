/**
 * Purpose: Fetches recent events from the database and processes them through the current geocoding engine to generate a fresh benchmark dataset for grading.
 * Usage: bun run scripts/diagnostics/generate-benchmark.ts --limit 100 --out scripts/results/new-grading-100.json
 */

import { supabaseAdmin as supabase } from '@/lib/core/supabase';
import { NewsItem } from '@/lib/core/types';
import { enrichItemsWithLocation, ensureInitialized } from '@/lib/geocoding';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config();

if (!supabase) {
    console.error('Missing Supabase credentials (SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY).');
    process.exit(1);
}

const db = supabase!;

// Parse CLI flags to control sample size and output destination for the generated benchmark.
const args = process.argv.slice(2);
const limitArg = args.indexOf('--limit');
const LIMIT = limitArg !== -1 ? parseInt(args[limitArg + 1], 10) : 100;

const outArg = args.indexOf('--out');
const DEFAULT_OUT = `scripts/results/benchmark-${LIMIT}.json`;
const OUT_PATH = outArg !== -1 ? args[outArg + 1] : DEFAULT_OUT;

async function run() {
    console.log("Initializing Geocoding Engine...");
    ensureInitialized();

    console.log(`Pulling latest ${LIMIT} events from Supabase...`);
    
    const { data: events, error } = await db
        .from('events')
        .select('*')
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
