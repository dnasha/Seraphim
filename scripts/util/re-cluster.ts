import { createClient } from '@supabase/supabase-js';
import { 
    calculateDistance, 
    SIMILARITY_THRESHOLD_STRICT, 
    SIMILARITY_THRESHOLD_PROXIMITY, 
    MAX_MERGE_DISTANCE_KM 
} from '../../src/scraper/utils/vectorize';
import type { DbEventSource } from '../../src/types';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Missing environment variables.');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function reClusterHistoricalData() {
    console.log('[re-cluster] Starting historical story consolidation...');

    const processedIds = new Set<string>();
    let mergeCount = 0;
    let lastDate = new Date().toISOString();

    while (true) {
        /* 
           Step 1: Fetch a batch of events.
           We use a sliding window on published_at to safely paginate the entire DB.
        */
        const { data: events, error: fetchError } = await supabase
            .from('events')
            .select('id, title, url, source, source_type, embedding, latitude, longitude, sources, published_at, description, credibility_tier')
            .lt('published_at', lastDate)
            .order('published_at', { ascending: false })
            .limit(500);

        if (fetchError) {
            console.error('Fetch error:', fetchError);
            break;
        }

        if (!events || events.length === 0) {
            console.log('[re-cluster] Reached the end of the archive.');
            break;
        }

        console.log(`[re-cluster] Processing batch of ${events.length} events (older than ${lastDate})...`);
        lastDate = events[events.length - 1].published_at;

        const idsToDelete: string[] = [];
        
        interface MasterUpdate {
            id: string;
            data: {
                sources: DbEventSource[];
                title: string;
                description: string | null;
                source: string;
                url: string;
                credibility_tier: number;
                published_at: string;
            };
        }
        const masterUpdates: MasterUpdate[] = [];

        for (const event of events) {
            if (processedIds.has(event.id)) continue;
            if (!event.embedding) continue;

        const embedding = typeof event.embedding === 'string' ? JSON.parse(event.embedding) : event.embedding;
        
        /* 
           Step 2: Find potential matches in the database using semantic search.
           We'll look for events within a 7-day window of this one to keep it logical.
        */
        const windowStart = new Date(new Date(event.published_at).getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

        const { data: matches, error: matchError } = await supabase
            .rpc('match_events', {
                query_embedding: embedding,
                match_threshold: SIMILARITY_THRESHOLD_PROXIMITY, // Lower bound for filtering
                match_count: 10,
                p_since: windowStart
            });

        if (matchError) {
            console.error('Match error:', matchError);
            continue;
        }

        const currentSources = event.sources || [{
            name: event.source,
            url: event.url,
            source_type: event.source_type,
            discovered_at: event.published_at
        }];

        for (const match of (matches ?? [])) {
            if (match.id === event.id || processedIds.has(match.id)) continue;

            // Fetch full match data for coordinate check (from memory if possible, else DB)
            let matchedEvent = events!.find(e => e.id === match.id);
            
            if (!matchedEvent) {
                const { data } = await supabase
                    .from('events')
                    .select('id, title, url, source, source_type, latitude, longitude, description, credibility_tier, published_at, embedding, sources')
                    .eq('id', match.id)
                    .single();
                if (data) matchedEvent = data;
            }

            if (!matchedEvent) continue;

            let shouldMerge = false;

            if (match.similarity >= SIMILARITY_THRESHOLD_STRICT) {
                shouldMerge = true;
            } else if (match.similarity >= SIMILARITY_THRESHOLD_PROXIMITY && event.latitude && event.longitude && matchedEvent.latitude && matchedEvent.longitude) {
                const dist = calculateDistance(event.latitude, event.longitude, matchedEvent.latitude, matchedEvent.longitude);
                if (dist <= MAX_MERGE_DISTANCE_KM) {
                    shouldMerge = true;
                }
            }

            if (shouldMerge) {
                console.log(`[re-cluster] Merging: "${event.title.slice(0, 30)}..." + "${matchedEvent.title.slice(0, 30)}..." (Sim: ${match.similarity.toFixed(2)})`);
                
                // Smart Selection: Is the incoming match "better" than our current master?
                const currentTier = event.credibility_tier || 3;
                const matchTier = matchedEvent.credibility_tier || 3;
                
                let isBetter = false;
                if (matchTier < currentTier) {
                    isBetter = true;
                } else if (matchTier === currentTier) {
                    const currentLen = (event.description?.length || 0) + (event.title?.length || 0);
                    const matchLen = (matchedEvent.description?.length || 0) + (matchedEvent.title?.length || 0);
                    if (matchLen > currentLen) isBetter = true;
                }

                if (isBetter) {
                    event.title = matchedEvent.title;
                    event.description = matchedEvent.description;
                    event.source = matchedEvent.source;
                    event.url = matchedEvent.url;
                    event.credibility_tier = matchedEvent.credibility_tier;
                    event.published_at = matchedEvent.published_at; // Keep most authoritative date
                }

                const matchSource = {
                    name: matchedEvent.source,
                    url: matchedEvent.url,
                    source_type: matchedEvent.source_type,
                    discovered_at: matchedEvent.published_at
                };

                // Add to current sources if URL is unique
                if (!currentSources.some((s: { url: string }) => s.url === matchSource.url)) {
                    currentSources.push(matchSource);
                }

                // Queue the duplicate for deletion
                idsToDelete.push(matchedEvent.id);
                processedIds.add(matchedEvent.id);
                mergeCount++;
            }
        }

        // Update the "master" event with consolidated sources and improved content
        if (currentSources.length > (event.sources?.length || 1) || processedIds.has(event.id)) {
            masterUpdates.push({
                id: event.id,
                data: {
                    sources: currentSources,
                    title: event.title,
                    description: event.description,
                    source: event.source,
                    url: event.url,
                    credibility_tier: event.credibility_tier,
                    published_at: event.published_at
                }
            });
        }
        
        processedIds.add(event.id);
    } // End of for (const event of events)

        // --- Execute Bulk DB Operations for the Batch ---

        // 1. Flush bulk deletes
        if (idsToDelete.length > 0) {
            const DELETE_CHUNK_SIZE = 500;
            for (let i = 0; i < idsToDelete.length; i += DELETE_CHUNK_SIZE) {
                const chunk = idsToDelete.slice(i, i + DELETE_CHUNK_SIZE);
                const { error: delErr } = await supabase.from('events').delete().in('id', chunk);
                if (delErr) console.error('[re-cluster] Bulk delete error:', delErr.message);
            }
        }

        // 2. Flush parallel updates
        if (masterUpdates.length > 0) {
            const UPDATE_CHUNK_SIZE = 50;
            for (let i = 0; i < masterUpdates.length; i += UPDATE_CHUNK_SIZE) {
                const chunk = masterUpdates.slice(i, i + UPDATE_CHUNK_SIZE);
                await Promise.all(chunk.map(u => 
                    supabase.from('events').update(u.data).eq('id', u.id)
                ));
            }
        }
    } // End of while (true)
    
    console.log(`[re-cluster] Done! Consolidated ${mergeCount} redundant pins into stories.`);
}

reClusterHistoricalData();
