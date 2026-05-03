/*
Seraphim Benchmark Generator
Consolidated utility to pull latest events from the database and run them through
the current production geocoding engine to generate a grading/benchmark file.

Run: npx tsx scripts/generate-benchmark.ts --limit 100 --out scripts/results/new-grading-100.json
*/

import { createClient } from '@supabase/supabase-js';
import { NewsItem } from '../src/lib/types';
import { enrichItemsWithLocation, ensureInitialized } from '../src/lib/geocoding';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

// Load env vars for Supabase access
dotenv.config({ path: '.env.local' });

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error("Missing Supabase credentials in .env.local");
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
});

// basic argument parser
const args = process.argv.slice(2);
const limitArg = args.indexOf('--limit');
const LIMIT = limitArg !== -1 ? parseInt(args[limitArg + 1], 10) : 100;

const outArg = args.indexOf('--out');
const DEFAULT_OUT = `scripts/results/benchmark-${LIMIT}.json`;
const OUT_PATH = outArg !== -1 ? args[outArg + 1] : DEFAULT_OUT;

async function run() {
    console.log("Initializing Geocoding Engine...");
    ensureInitialized();

    console.log(`📥 Pulling latest ${LIMIT} events from Supabase...`);
    
    const { data: events, error } = await supabase
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

    console.log(`✅ Retrieved ${events.length} events.`);
    console.log(`\n🧠 Re-running geocoding engine on fresh data...`);

    // We map DB events back to NewsItem format for the enricher
    const newsItems: NewsItem[] = events.map((e) => ({
        id: e.id,
        title: e.title,
        description: e.description,
        source: e.source,
        sourceType: e.source_type,
        publishedAt: e.published_at,
        url: e.url
    }));

    // run items through the production geocoding pipeline
    const enrichedItems = await enrichItemsWithLocation(newsItems);

    const results = enrichedItems.map((item, idx) => {
        const original = events[idx];
        
        const found_locations = item.foundLocations || [];

        // format geocoded results for comparison
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
            // The location currently stored in the DB (for reference)
            db_location: original.latitude ? {
                lat: original.latitude,
                lon: original.longitude,
                displayName: original.location_name
            } : null,
            // What the engine produces RIGHT NOW
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
    
    console.log(`\n✨ DONE`);
    console.log(`📂 Wrote benchmark set to ${absoluteOutPath}`);
    console.log(`📊 Mapped by current engine: ${results.filter(r => r.engine_result).length} / ${results.length}`);
}

run().catch(err => {
    console.error("Benchmark generation failed:", err);
    process.exit(1);
});
