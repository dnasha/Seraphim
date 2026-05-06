
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function checkFailures() {
    console.log('Analyzing events with NULL embeddings...');
    
    const { data, error } = await supabase
        .from('events')
        .select('published_at, source')
        .is('embedding', null)
        .order('published_at', { ascending: false });

    if (error) {
        console.error('Error:', error);
        return;
    }

    if (!data || data.length === 0) {
        console.log('No failures found now (all fixed or none existed).');
        return;
    }

    console.log(`Total events with NULL embeddings: ${data.length}`);
    
    const bySource: Record<string, number> = {};
    const byDate: Record<string, number> = {};

    for (const e of data) {
        const date = e.published_at.split('T')[0];
        byDate[date] = (byDate[date] || 0) + 1;
        bySource[e.source] = (bySource[e.source] || 0) + 1;
    }

    console.log('\nFailures by Date:');
    console.table(byDate);

    console.log('\nFailures by Source:');
    console.table(bySource);
}

checkFailures();
