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
    console.log('[re-tier] Starting credibility tier backfill (Bulk Source Strategy)...');

    // Create a master map of source names to tiers
    const tierMap = new Map<string, number>();
    [...RSS_SOURCES, ...REDDIT_SOURCES, ...TELEGRAM_CHANNELS, ...X_ACCOUNTS].forEach(s => {
        tierMap.set(s.name, s.credibility_tier);
    });

    console.log(`[re-tier] Found ${tierMap.size} unique sources to verify.`);

    let totalUpdated = 0;

    for (const [sourceName, tier] of tierMap) {
        let sourceUpdated = 0;
        
        while (true) {
            // Fetch a batch of IDs that need updating for this specific source
            const { data, error: fetchErr } = await supabase
                .from('events')
                .select('id')
                .eq('source', sourceName)
                .neq('credibility_tier', tier)
                .limit(100);

            if (fetchErr) {
                console.error(`[re-tier] Fetch error for "${sourceName}":`, fetchErr.message);
                break;
            }

            if (!data || data.length === 0) break;

            const ids = data.map(d => d.id);
            
            // Perform the update for just this batch of 500
            const { error: updateErr } = await supabase
                .from('events')
                .update({ credibility_tier: tier })
                .in('id', ids);

            if (updateErr) {
                console.error(`[re-tier] Update error for "${sourceName}":`, updateErr.message);
                break;
            }

            sourceUpdated += data.length;
            totalUpdated += data.length;
        }

        if (sourceUpdated > 0) {
            console.log(`[re-tier] Updated ${sourceUpdated} events for "${sourceName}" to Tier ${tier}`);
        }
    }

    console.log(`[re-tier] Done! Successfully upgraded ${totalUpdated} events.`);
}

backfillTiers();
