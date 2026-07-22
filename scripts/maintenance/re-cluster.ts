/*
  Seraphim Historical Re-Clustering Script
  Consolidates redundant pins by merging semantically similar events into stories.
  Uses vector similarity, location anchoring, and spatial gating.

  Usage: bun run scripts/maintenance/re-cluster.ts
  Environment Variables:
    - DRY_RUN: set to 'true' to simulate changes without writing to DB.
    - START_DATE: optional ISO date to begin re-clustering from.
*/

import { supabaseAdmin as supabase } from '@/lib/core/supabase-admin';
import { 
    calculateDistance, 
    SIMILARITY_THRESHOLD_STRICT, 
    SIMILARITY_THRESHOLD_PLACE_ANCHORED,
    SIMILARITY_THRESHOLD_PROXIMITY, 
    MAX_MERGE_DISTANCE_KM 
} from '@/lib/utils/vectorize';
import type { DbEventSource } from '@/types';
import dotenv from 'dotenv';
import { calculateMergedStory } from '@/lib/utils/merging';

dotenv.config();

// Default to false unless explicitly set to 'true'.
const DRY_RUN = String(process.env.DRY_RUN).toLowerCase() === 'true';

if (!supabase) {
    console.error('Missing environment variables (SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY).');
    process.exit(1);
}

const db = supabase!;

async function reClusterHistoricalData() {
    console.log(`[re-cluster] Initializing historical story consolidation (DRY_RUN=${DRY_RUN})`);

    const startTime = Date.now();
    
    // Fetch total event count for progress tracking.
    const { count: totalEvents, error: countErr } = await db
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
           Batch Fetch
           Uses a sliding window on published_at to paginate through the archive.
        */
        const { data: events, error: fetchError } = await db
            .from('events')
            .select('id, title, url, source, source_type, embedding, latitude, longitude, location_name, sources, published_at, description, image_url, credibility_tier')
            .lt('published_at', lastDate)
            .order('published_at', { ascending: false })
            .limit(500);

        if (fetchError) {
            console.error('[re-cluster] Fetch error:', fetchError);
            break;
        }

        if (!events || events.length === 0) {
            console.log('[re-cluster] SUCCESS: Reached end of archive.');
            break;
        }

        // Calculate progress and estimated time.
        totalProcessed += events.length;
        const progressPercent = ((totalProcessed / (totalEvents || 1)) * 100).toFixed(2);
        const elapsedSec = (Date.now() - startTime) / 1000;
        const itemsPerSec = totalProcessed / elapsedSec;
        const remainingItems = (totalEvents || 0) - totalProcessed;
        const etaMin = remainingItems > 0 ? (remainingItems / itemsPerSec / 60).toFixed(1) : '0';

        console.log(`\n[re-cluster] Progress: ${progressPercent}% (${totalProcessed.toLocaleString()} / ${totalEvents?.toLocaleString()})`);
        console.log(`[re-cluster] Batch Speed: ${itemsPerSec.toFixed(1)} items/s | ETA: ${etaMin}m`);
        console.log(`[re-cluster] Window: ${lastDate} -> ${events[events.length - 1].published_at}`);
        
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
                image_url: string | null;
                credibility_tier: number;
                published_at: string;
            };
        }
        const masterUpdates: MasterUpdate[] = [];

        const CONCURRENCY = 50;
        const eventMap = new Map(events.map(e => [e.id, e]));

        for (let i = 0; i < events.length; i += CONCURRENCY) {
            const chunk = events.slice(i, i + CONCURRENCY);
            
            // Execute vector similarity searches in parallel for the chunk.
            const matchPromises = chunk.map(async (event) => {
                if (processedIds.has(event.id) || !event.embedding) return null;
                
                const embedding = typeof event.embedding === 'string' ? JSON.parse(event.embedding) : event.embedding;
                const windowStart = new Date(new Date(event.published_at).getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

                const { data: matches, error } = await db
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

            // Fetch missing events identified as potential matches.
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
                const { data: missingData } = await db
                    .from('events')
                    .select('id, title, url, source, source_type, latitude, longitude, location_name, description, image_url, credibility_tier, published_at, embedding, sources')
                    .in('id', Array.from(missingIds));
                
                if (missingData) {
                    for (const d of missingData) {
                        eventMap.set(d.id, d);
                    }
                }
            }

            // Process matches sequentially to maintain causal merge order.
            for (const res of chunkResults) {
                if (!res) continue;
                const { event, matches } = res;
                if (processedIds.has(event.id)) continue;

                let changed = false;
                const currentSources: DbEventSource[] = event.sources ? [...event.sources] : [{
                    name: event.source,
                    url: event.url,
                    source_type: event.source_type,
                    discovered_at: event.published_at
                }];

                // Synchronize top-level timestamp with latest source activity.
                for (const s of currentSources) {
                    if (new Date(s.discovered_at).getTime() > new Date(event.published_at).getTime()) {
                        event.published_at = s.discovered_at;
                        changed = true;
                    }
                }

                for (const match of matches) {
                    if (match.id === event.id || processedIds.has(match.id)) continue;

                    const matchedEvent = eventMap.get(match.id);
                    if (!matchedEvent) continue;

                    let shouldMerge = false;

                    const eventTime = new Date(event.published_at).getTime();
                    const matchTime = new Date(matchedEvent.published_at).getTime();
                    const sevenDays = 7 * 24 * 60 * 60 * 1000;
                    
                    // Skip if temporal distance exceeds 7 days.
                    if (Math.abs(eventTime - matchTime) > sevenDays) {
                        continue;
                    }

                    // Multi-tiered merge decision logic.
                    if (match.similarity >= SIMILARITY_THRESHOLD_STRICT) {
                        shouldMerge = true;
                    } else if (match.similarity >= SIMILARITY_THRESHOLD_PLACE_ANCHORED &&
                               event.location_name && matchedEvent.location_name &&
                               event.location_name === matchedEvent.location_name) {
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
                        console.log(`[re-cluster] MERGE: "${event.title.slice(0, 40)}..." <- "${matchedEvent.title.slice(0, 40)}..." (Sim: ${match.similarity.toFixed(2)})`);
                        
                        const mergedResult = calculateMergedStory(event, matchedEvent);
                        Object.assign(event, mergedResult);

                        idsToDelete.push(matchedEvent.id);
                        processedIds.add(matchedEvent.id);
                        totalMerges++;
                        totalDeletes++;
                        changed = true;
                    }
                }

                if (changed) {
                    masterUpdates.push({
                        id: event.id,
                        data: {
                            sources: currentSources,
                            title: event.title,
                            description: event.description,
                            source: event.source,
                            url: event.url,
                            image_url: event.image_url,
                            credibility_tier: event.credibility_tier,
                            published_at: event.published_at
                        }
                    });
                }
                
                processedIds.add(event.id);
            }
        }

        // Execute bulk database updates and deletions for the batch.
        if (idsToDelete.length > 0) {
            if (DRY_RUN) {
                console.log(`[re-cluster] Action (Dry Run): Would delete ${idsToDelete.length} merged items.`);
            } else {
                console.log(`[re-cluster] Action: Deleting ${idsToDelete.length} merged items.`);
                const DELETE_CHUNK_SIZE = 500;
                for (let i = 0; i < idsToDelete.length; i += DELETE_CHUNK_SIZE) {
                    const chunk = idsToDelete.slice(i, i + DELETE_CHUNK_SIZE);
                    const { error: delErr } = await db.from('events').delete().in('id', chunk);
                    if (delErr) {
                        console.error('[re-cluster] Bulk delete error:', delErr.message);
                    }
                }
            }
        }

        if (masterUpdates.length > 0) {
            if (DRY_RUN) {
                console.log(`[re-cluster] Action (Dry Run): Would update ${masterUpdates.length} master stories.`);
            } else {
                console.log(`[re-cluster] Action: Updating ${masterUpdates.length} master stories.`);
                const UPDATE_CHUNK_SIZE = 50;
                for (let i = 0; i < masterUpdates.length; i += UPDATE_CHUNK_SIZE) {
                    const chunk = masterUpdates.slice(i, i + UPDATE_CHUNK_SIZE);
                    await Promise.all(chunk.map(u => 
                        db.from('events').update(u.data).eq('id', u.id)
                    ));
                }
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

