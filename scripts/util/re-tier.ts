import { createClient } from '@supabase/supabase-js';
import { RSS_SOURCES, REDDIT_SOURCES, TELEGRAM_CHANNELS, X_ACCOUNTS } from '../../src/data/sources';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Missing environment variables.');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function backfillTiers() {
    console.log('[re-tier] Starting credibility tier backfill...');

    // Create a master map of source names to tiers
    const tierMap = new Map<string, number>();
    [...RSS_SOURCES, ...REDDIT_SOURCES, ...TELEGRAM_CHANNELS, ...X_ACCOUNTS].forEach(s => {
        tierMap.set(s.name, s.credibility_tier);
    });

    let totalUpdated = 0;

    while (true) {
        const { data, error } = await supabase
            .from('events')
            .select('id, source')
            .is('credibility_tier', null)
            .limit(1000);

        if (error) {
            console.error('Fetch error:', error);
            break;
        }

        if (!data || data.length === 0) {
            console.log('[re-tier] No more events found.');
            break;
        }

        for (const event of data) {
            const tier = tierMap.get(event.source) || 3; // Default to Tier 3 if unknown

            const { error: updateError } = await supabase
                .from('events')
                .update({ credibility_tier: tier })
                .eq('id', event.id);

            if (updateError) {
                console.error(`Error updating ${event.id}:`, updateError);
            } else {
                totalUpdated++;
            }
        }
        
        console.log(`[re-tier] Batch complete. Total updated so far: ${totalUpdated}`);
    }

    console.log(`[re-tier] Done! Updated a total of ${totalUpdated} events.`);
}

backfillTiers();
