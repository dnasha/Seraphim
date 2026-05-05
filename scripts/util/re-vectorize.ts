/*
Re-vectorize: Backfill embeddings for historical events.

Reads all events that don't yet have an embedding, generates one via the
local ONNX model, and writes it back in batches.

Usage:
  bun run scripts/util/re-vectorize.ts

Environment:
  SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY
  BATCH_SIZE (optional, default 100)
*/

import { createClient } from '@supabase/supabase-js';
import { generateEmbeddings, buildEmbeddingText } from '../../src/scraper/utils/vectorize';
import dotenv from 'dotenv';

dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE ?? '200', 10);

if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
});

async function run() {
    console.log('[re-vectorize] Starting backfill...');

    /* Count total events without embeddings */
    const { count, error: countErr } = await supabase
        .from('events')
        .select('id', { count: 'exact', head: true })
        .is('embedding', null);

    if (countErr) {
        console.error('[re-vectorize] Count query failed:', countErr.message);
        process.exit(1);
    }

    console.log(`[re-vectorize] ${count} events need embeddings`);

    let processed = 0;

    while (true) {
        /* Fetch a batch of events with all required columns to satisfy constraints during upsert */
        const { data: batch, error: fetchErr } = await supabase
            .from('events')
            .select('id, title, url, source, source_type, published_at, description')
            .is('embedding', null)
            .order('published_at', { ascending: false })
            .limit(BATCH_SIZE);

        if (fetchErr) {
            console.error('[re-vectorize] Fetch failed:', fetchErr.message);
            break;
        }

        if (!batch || batch.length === 0) {
            console.log('[re-vectorize] All events processed.');
            break;
        }

        /* Build texts and generate embeddings in one batch */
        const texts = batch.map(e => buildEmbeddingText(e.title, e.description));
        const embeddings = await generateEmbeddings(texts);

        /* Write embeddings back in one bulk operation, including required columns */
        const updates = batch.map((item, i) => ({
            ...item,
            embedding: `[${embeddings[i].join(',')}]`
        }));

        const { error: updateErr } = await supabase
            .from('events')
            .upsert(updates);

        if (updateErr) {
            console.error(`[re-vectorize] Bulk update failed:`, updateErr.message);
            break;
        }

        processed += batch.length;
        console.log(`[re-vectorize] Progress: ${processed}/${count}`);
    }

    console.log(`[re-vectorize] Done. ${processed} events vectorized.`);
}

run().catch(err => {
    console.error('[re-vectorize] Fatal:', err);
    process.exit(1);
});
