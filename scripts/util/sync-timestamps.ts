import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables.");
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

interface DbEventSource {
    name: string;
    url: string;
    source_type: string;
    discovered_at: string;
}

interface DbEvent {
    id: string;
    published_at: string;
    sources: DbEventSource[];
}

async function syncTimestamps() {
    console.log("🚀 Starting story timestamp synchronization...");

    let offset = 0;
    const limit = 500;
    let totalUpdated = 0;

    while (true) {
        const { data: events, error } = await supabase
            .from('events')
            .select('id, published_at, sources')
            .range(offset, offset + limit - 1);

        if (error) {
            console.error("Error fetching events:", error.message);
            break;
        }

        if (!events || events.length === 0) break;

        const updates = [];

        for (const event of (events as DbEvent[])) {
            let latestTime = new Date(event.published_at).getTime();
            let latestStr = event.published_at;
            let needsUpdate = false;

            if (event.sources && Array.isArray(event.sources)) {
                for (const source of event.sources) {
                    const sourceTime = new Date(source.discovered_at).getTime();
                    if (sourceTime > latestTime) {
                        latestTime = sourceTime;
                        latestStr = source.discovered_at;
                        needsUpdate = true;
                    }
                }
            }

            if (needsUpdate) {
                updates.push({
                    id: event.id,
                    published_at: latestStr
                });
            }
        }

        if (updates.length > 0) {
            console.log(`Updating ${updates.length} events in this batch...`);
            for (const update of updates) {
                const { error: updateError } = await supabase
                    .from('events')
                    .update({ published_at: update.published_at })
                    .eq('id', update.id);
                
                if (updateError) {
                    console.error(`Failed to update event ${update.id}:`, updateError.message);
                } else {
                    totalUpdated++;
                }
            }
        }

        offset += limit;
        console.log(`Processed ${offset} events...`);
        if (events.length < limit) break;
    }

    console.log(`\n✅ Done! Total events updated: ${totalUpdated}`);
}

syncTimestamps().catch(err => {
    console.error("Fatal error:", err);
    process.exit(1);
});
