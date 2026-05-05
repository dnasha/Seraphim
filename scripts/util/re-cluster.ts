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
    console.log('[re-cluster] Initializing historical story consolidation...');

    const startTime = Date.now();
    
    // Step 0: Get total count for progress tracking
    const { count: totalEvents, error: countErr } = await supabase
        .from('events')
        .select('*', { count: 'exact', head: true });

    if (countErr) {
        console.error('[re-cluster] Failed to fetch total event count:', countErr.message);
        process.exit(1);
    }

    console.log(`[re-cluster] Total events to analyze: ${totalEvents?.toLocaleString()}`);

    const processedIds = new Set<string>();
    let totalProcessed = 0;
    let totalMerges = 0;
    let totalDeletes = 0;
    let lastDate = process.env.START_DATE || new Date().toISOString();

    while (true) {
        const batchStartMs = Date.now();
        
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
            console.error('[re-cluster] Fetch error:', fetchError);
            break;
        }

        if (!events || events.length === 0) {
            console.log('[re-cluster] SUCCESS: Reached the end of the archive.');
            break;
        }

        // Progress Calculation
        totalProcessed += events.length;
        const progressPercent = ((totalProcessed / (totalEvents || 1)) * 100).toFixed(2);
        const elapsedSec = (Date.now() - startTime) / 1000;
        const itemsPerSec = totalProcessed / elapsedSec;
        const remainingItems = (totalEvents || 0) - totalProcessed;
        const etaMin = remainingItems > 0 ? (remainingItems / itemsPerSec / 60).toFixed(1) : '0';

        console.log(`\n[re-cluster] --- Batch Progress: ${progressPercent}% (${totalProcessed.toLocaleString()} / ${totalEvents?.toLocaleString()}) ---`);
        console.log(`[re-cluster] Batch: ${events.length} items | Speed: ${itemsPerSec.toFixed(1)} items/s | ETA: ${etaMin}m`);
        console.log(`[re-cluster] Date Window: ${lastDate} -> ${events[events.length - 1].published_at}`);
        
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

        const CONCURRENCY = 50;
        const eventMap = new Map(events.map(e => [e.id, e]));

        for (let i = 0; i < events.length; i += CONCURRENCY) {
            const chunk = events.slice(i, i + CONCURRENCY);
            
            // Step 2a: Run vector searches in parallel for the chunk
            const matchPromises = chunk.map(async (event) => {
                if (processedIds.has(event.id) || !event.embedding) return null;
                
                const embedding = typeof event.embedding === 'string' ? JSON.parse(event.embedding) : event.embedding;
                const windowStart = new Date(new Date(event.published_at).getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

                const { data: matches, error } = await supabase
                    .rpc('match_events', {
                        query_embedding: embedding,
                        match_threshold: SIMILARITY_THRESHOLD_PROXIMITY,
                        match_count: 10,
                        p_since: windowStart
                    });

                if (error) {
                    console.error('[re-cluster] Match RPC error:', error.message);
                    return null;
                }
                return { event, matches: matches || [] };
            });

            const chunkResults = await Promise.all(matchPromises);

            // Step 2b: Bulk fetch missing matches
            const missingIds = new Set<string>();
            for (const res of chunkResults) {
                if (!res) continue;
                for (const m of res.matches) {
                    if (m.id !== res.event.id && !eventMap.has(m.id) && !processedIds.has(m.id)) {
                        missingIds.add(m.id);
                    }
                }
            }

            if (missingIds.size > 0) {
                const { data: missingData } = await supabase
                    .from('events')
                    .select('id, title, url, source, source_type, latitude, longitude, description, credibility_tier, published_at, embedding, sources')
                    .in('id', Array.from(missingIds));
                
                if (missingData) {
                    for (const d of missingData) {
                        eventMap.set(d.id, d);
                    }
                }
            }

            // Step 2c: Process sequentially to preserve newer-absorbs-older logic
            for (const res of chunkResults) {
                if (!res) continue;
                const { event, matches } = res;
                if (processedIds.has(event.id)) continue;

                const currentSources = event.sources || [{
                    name: event.source,
                    url: event.url,
                    source_type: event.source_type,
                    discovered_at: event.published_at
                }];

                for (const match of matches) {
                    if (match.id === event.id || processedIds.has(match.id)) continue;

                    const matchedEvent = eventMap.get(match.id);
                    if (!matchedEvent) continue;

                    let shouldMerge = false;

                    const eventTime = new Date(event.published_at).getTime();
                    const matchTime = new Date(matchedEvent.published_at).getTime();
                    const sevenDays = 7 * 24 * 60 * 60 * 1000;
                    
                    if (Math.abs(eventTime - matchTime) > sevenDays) {
                        continue;
                    }

                    if (match.similarity >= SIMILARITY_THRESHOLD_STRICT) {
                        shouldMerge = true;
                    } else if (match.similarity >= SIMILARITY_THRESHOLD_PROXIMITY && 
                               event.latitude !== null && event.longitude !== null && 
                               matchedEvent.latitude !== null && matchedEvent.longitude !== null) {
                        const dist = calculateDistance(event.latitude, event.longitude, matchedEvent.latitude, matchedEvent.longitude);
                        if (dist <= MAX_MERGE_DISTANCE_KM) {
                            shouldMerge = true;
                        }
                    }

                    if (shouldMerge) {
                        console.log(`[re-cluster] MERGE: "${event.title.slice(0, 40)}..." (Master) <-- "${matchedEvent.title.slice(0, 40)}..." (Sim: ${match.similarity.toFixed(2)})`);
                        
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
                            console.log(`[re-cluster]   └─ Content Win: Matched event has better ${matchTier < currentTier ? 'tier' : 'length'}. Updating Master.`);
                            event.title = matchedEvent.title;
                            event.description = matchedEvent.description;
                            event.source = matchedEvent.source;
                            event.url = matchedEvent.url;
                            event.credibility_tier = matchedEvent.credibility_tier;
                            event.published_at = matchedEvent.published_at;
                        }

                        const matchSources = matchedEvent.sources || [{
                            name: matchedEvent.source,
                            url: matchedEvent.url,
                            source_type: matchedEvent.source_type,
                            discovered_at: matchedEvent.published_at
                        }];

                        for (const s of matchSources) {
                            if (!currentSources.some((cs: { url: string }) => cs.url === s.url)) {
                                currentSources.push(s);
                            }
                        }

                        idsToDelete.push(matchedEvent.id);
                        processedIds.add(matchedEvent.id);
                        totalMerges++;
                        totalDeletes++;
                    }
                }

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
            }
        }

        // --- Execute Bulk DB Operations for the Batch ---

        if (idsToDelete.length > 0) {
            const DELETE_CHUNK_SIZE = 500;
            for (let i = 0; i < idsToDelete.length; i += DELETE_CHUNK_SIZE) {
                const chunk = idsToDelete.slice(i, i + DELETE_CHUNK_SIZE);
                const { error: delErr } = await supabase.from('events').delete().in('id', chunk);
                if (delErr) {
                    console.error('[re-cluster] Bulk delete error:', delErr.message);
                }
            }
        }

        if (masterUpdates.length > 0) {
            const UPDATE_CHUNK_SIZE = 50;
            for (let i = 0; i < masterUpdates.length; i += UPDATE_CHUNK_SIZE) {
                const chunk = masterUpdates.slice(i, i + UPDATE_CHUNK_SIZE);
                await Promise.all(chunk.map(u => 
                    supabase.from('events').update(u.data).eq('id', u.id)
                ));
            }
        }

        const batchElapsed = ((Date.now() - batchStartMs) / 1000).toFixed(1);
        console.log(`[re-cluster] Batch Summary: ${idsToDelete.length} deletions, ${masterUpdates.length} updates | Time: ${batchElapsed}s`);
    }

    const totalElapsedMin = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
    console.log(`\n[re-cluster] COMPLETED in ${totalElapsedMin}m`);
    console.log(`[re-cluster] Total Processed: ${totalProcessed.toLocaleString()}`);
    console.log(`[re-cluster] Total Merges: ${totalMerges.toLocaleString()}`);
    console.log(`[re-cluster] Total Deletes: ${totalDeletes.toLocaleString()}`);
}

reClusterHistoricalData();
