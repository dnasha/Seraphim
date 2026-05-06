/*
Seraphim Scraper - Main ingestion worker

Local execution:
bun run src/scraper/index.ts

Dry run (no database writes, prints payload):
DRY_RUN=true bun run src/scraper/index.ts

Environment variables:
SUPABASE_URL: Supabase project URL
SUPABASE_SERVICE_ROLE_KEY: Service-role key for bypassing RLS
GNEWS_API_KEY: Optional API key for GNews.io

Pipeline:
1. Fetch raw items from RSS, GNews, Reddit, and social channels.
2. Pre-fetch known URLs from database to avoid redundant processing.
3. Filter out existing items.
4. Geocode new items via the local NLP engine.
5. Generate semantic embeddings (all-MiniLM-L6-v2, local ONNX).
6. Match against recent events — merge if similarity > 0.85 (Story model).
7. Upsert new events and update merged stories in Supabase.
*/

import { createClient } from '@supabase/supabase-js';
import { fetchAllRSSFeeds, fetchAllRedditFeeds } from './fetchers/rss';
import { fetchGNews, fetchOSINTGNews } from './fetchers/gnews';
import { fetchSocialFeeds } from './fetchers/social-feeds';
import { enrichItemsWithLocation } from './fetchers/geocoding';
import type { NewsItem } from '@/lib/types';
import type { DbEvent, DbEventSource } from '@/types';
import { newsItemToDbEvent } from './utils/transforms';
import {
    generateEmbeddings,
    buildEmbeddingText,
    cosineSimilarity,
    calculateDistance,
    SIMILARITY_THRESHOLD_STRICT,
    SIMILARITY_THRESHOLD_PLACE_ANCHORED,
    SIMILARITY_THRESHOLD_PROXIMITY,
    MAX_MERGE_DISTANCE_KM,
} from './utils/vectorize';

/* Configuration */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DRY_RUN = process.env.DRY_RUN === 'true';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('[scraper] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
});

/* ─── Semantic Merge Logic ─── */

/*
Fetches recent events that already have embeddings from Supabase.
Only pulls id, embedding, sources, latitude, and longitude.
*/
async function fetchRecentEmbeddings(): Promise<{
    id: string;
    embedding: number[];
    sources: DbEventSource[];
    latitude?: number;
    longitude?: number;
    location_name?: string;
    title?: string;
    description?: string;
    credibility_tier?: number;
    source?: string;
    url?: string;
    published_at: string;
}[]> {
    const since = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

    const { data, error } = await supabase
        .from('events')
        .select('id, embedding, sources, latitude, longitude, title, description, credibility_tier, source, url')
        .not('embedding', 'is', null)
        .gte('published_at', since);

    if (error) {
        console.error('[scraper] Failed to fetch recent embeddings:', error.message);
        return [];
    }

    interface RecentEventRow {
        id: string;
        embedding: string | number[];
        sources: DbEventSource[] | null;
        latitude: number | null;
        longitude: number | null;
        location_name: string | null;
        title: string;
        description: string;
        credibility_tier: number;
        source: string;
        url: string;
        published_at: string;
    }

    const rows = (data ?? []) as unknown as RecentEventRow[];

    return rows
        .filter(r => r.embedding)
        .map(r => ({
            id: r.id,
            embedding: typeof r.embedding === 'string'
                ? JSON.parse(r.embedding)
                : r.embedding,
            sources: r.sources ?? [],
            latitude: r.latitude ?? undefined,
            longitude: r.longitude ?? undefined,
            location_name: r.location_name ?? undefined,
            title: r.title,
            description: r.description,
            credibility_tier: r.credibility_tier,
            source: r.source,
            url: r.url,
            published_at: r.published_at,
        }));
}

/*
Applies the Story merge logic with Spatial gating:
  1. Strict Match: Similarity > 0.85 (always merge)
  2. Proximity Match: Similarity > 0.60 AND distance < 50km
*/
async function resolveStoryMerges(
    dbEvents: DbEvent[],
    enrichedItems: NewsItem[]
): Promise<{
    newEvents: DbEvent[];
    merges: Map<string, { 
        sources: DbEventSource[];
        title?: string;
        description?: string;
        source?: string;
        url?: string;
        credibility_tier?: number;
        event_count?: number;
        impact_score?: number;
    }>;
}> {
    const newEvents: DbEvent[] = [];
    const merges = new Map<string, {
        sources: DbEventSource[];
        title?: string;
        description?: string;
        source?: string;
        url?: string;
        credibility_tier?: number;
        published_at?: string;
        event_count?: number;
        impact_score?: number;
    }>();

    if (dbEvents.length === 0) {
        return { newEvents, merges };
    }

    console.log(`[vectorize] Generating embeddings for ${dbEvents.length} items...`);
    const texts = enrichedItems.map(item => buildEmbeddingText(item.title, item.description));
    const startMs = Date.now();

    let embeddings: number[][];
    try {
        embeddings = await generateEmbeddings(texts);
    } catch (err) {
        console.error('[vectorize] Embedding generation failed:', err);
        return { newEvents: dbEvents, merges };
    }

    console.log(`[vectorize] Embeddings generated in ${((Date.now() - startMs) / 1000).toFixed(1)}s`);

    const candidates = await fetchRecentEmbeddings();
    console.log(`[vectorize] ${candidates.length} recent candidates loaded for similarity matching`);

    let mergeCount = 0;

    for (let i = 0; i < dbEvents.length; i++) {
        const event = dbEvents[i];
        const embedding = embeddings[i];

        event.embedding = `[${embedding.join(',')}]`;

        /* Find best match among candidates */
        let bestMatchId: string | null = null;
        let highestSim = -1;

        for (const candidate of candidates) {
            const sim = cosineSimilarity(embedding, candidate.embedding);

            let shouldMerge = false;

            // Strategy 1: Strict semantic (highly identical text)
            if (sim >= SIMILARITY_THRESHOLD_STRICT) {
                shouldMerge = true;
            }
            // Strategy 1.5: Place Name Anchoring (exact location name match)
            else if (sim >= SIMILARITY_THRESHOLD_PLACE_ANCHORED &&
                     event.location_name && candidate.location_name &&
                     event.location_name === candidate.location_name) {
                shouldMerge = true;
            }
            // Strategy 2: Proximity semantic (related text in same location)
            else if (sim >= SIMILARITY_THRESHOLD_PROXIMITY &&
                     event.latitude != null && event.longitude != null &&
                     candidate.latitude != null && candidate.longitude != null) {
                const dist = calculateDistance(event.latitude, event.longitude, candidate.latitude, candidate.longitude);
                if (dist <= MAX_MERGE_DISTANCE_KM) {
                    shouldMerge = true;
                }
            }

            if (shouldMerge && sim > highestSim) {
                highestSim = sim;
                bestMatchId = candidate.id;
            }
        }

        if (bestMatchId) {
            const matchedCandidate = candidates.find(c => c.id === bestMatchId)!;

            // Smart Selection: If the NEW incoming item is higher quality, swap it into the master
            let updateContent = false;
            const currentTier = matchedCandidate.credibility_tier || 3;
            const incomingTier = event.credibility_tier || 3;

            if (incomingTier < currentTier) {
                updateContent = true;
            } else if (incomingTier === currentTier) {
                const currentLen = (matchedCandidate.description?.length || 0) + (matchedCandidate.title?.length || 0);
                const incomingLen = (event.description?.length || 0) + (event.title?.length || 0);
                if (incomingLen > currentLen) updateContent = true;
            }

            // Always pick the latest publication time for the master card
            // Normalization: Also check against the candidate's existing sources just in case
            let candidateLatestTime = new Date(matchedCandidate.published_at).getTime();
            for (const s of matchedCandidate.sources) {
                const sourceTime = new Date(s.discovered_at).getTime();
                if (sourceTime > candidateLatestTime) {
                    candidateLatestTime = sourceTime;
                }
            }

            const incomingTime = new Date(event.published_at).getTime();
            
            // Check if we already have an even newer time in the current merge set
            const existingMerge = merges.get(bestMatchId);
            const currentSetTime = existingMerge?.published_at ? new Date(existingMerge.published_at).getTime() : -1;
            
            const maxTime = Math.max(incomingTime, candidateLatestTime, currentSetTime);
            
            let latestPublishedAt = matchedCandidate.published_at;
            if (maxTime === incomingTime) latestPublishedAt = event.published_at;
            else if (maxTime === currentSetTime) latestPublishedAt = existingMerge!.published_at!;
            // else it stays matchedCandidate.published_at (or whichever was the source of candidateLatestTime)
            // if candidateLatestTime came from a source, we should use that string
            if (maxTime === candidateLatestTime && candidateLatestTime !== new Date(matchedCandidate.published_at).getTime()) {
                const latestSource = matchedCandidate.sources.find(s => new Date(s.discovered_at).getTime() === candidateLatestTime);
                if (latestSource) latestPublishedAt = latestSource.discovered_at;
            }

            const newSource: DbEventSource = {
                name: event.source,
                url: event.url,
                source_type: event.source_type,
                discovered_at: event.published_at, // Use the article's own time instead of scraper run time
            };

            if (!matchedCandidate.sources.some(s => s.url === event.url)) {
                const updatedSources = existingMerge ? [...existingMerge.sources, newSource] : [...matchedCandidate.sources, newSource];
                const bestTier = Math.min(currentTier, incomingTier);
                const eventCount = updatedSources.length;
                
                // Unified Impact Score: All sources receive the 'credit' of the most credible source
                // in the story's timeline. We use a flattened 2:1 ratio (Diamond=4, Silver=2) 
                // to ensure high-volume stories aren't buried by low-volume high-credibility ones.
                const impactScore = eventCount * (5.0 - bestTier);

                if (existingMerge) {
                    existingMerge.sources = updatedSources;
                    existingMerge.published_at = latestPublishedAt;
                    existingMerge.event_count = eventCount;
                    existingMerge.impact_score = impactScore;
                    if (updateContent) {
                        existingMerge.title = event.title;
                        existingMerge.description = event.description;
                        existingMerge.source = event.source;
                        existingMerge.url = event.url;
                        existingMerge.credibility_tier = incomingTier;
                    }
                } else {
                    merges.set(bestMatchId, {
                        sources: updatedSources,
                        published_at: latestPublishedAt,
                        event_count: eventCount,
                        impact_score: impactScore,
                        ...(updateContent ? {
                            title: event.title,
                            description: event.description,
                            source: event.source,
                            url: event.url,
                            credibility_tier: incomingTier
                        } : {})
                    });
                }
                mergeCount++;
            }
        } else {
            newEvents.push(event);
        }
    }
    console.log(`[vectorize] Story resolution: ${mergeCount} merged, ${newEvents.length} new events`);
    return { newEvents, merges };
}

/*
Applies source merges to existing events in Supabase.
Each merge is a single UPDATE setting the expanded sources array.
Batched into individual updates to avoid complex SQL.
*/
async function applyMerges(
    merges: Map<string, { 
        sources: DbEventSource[];
        title?: string;
        description?: string;
        source?: string;
        url?: string;
        credibility_tier?: number;
        event_count?: number;
        impact_score?: number;
    }>
): Promise<number> {
    let updated = 0;
    const mergeEntries = Array.from(merges.entries());
    const CHUNK_SIZE = 50;

    for (let i = 0; i < mergeEntries.length; i += CHUNK_SIZE) {
        const chunk = mergeEntries.slice(i, i + CHUNK_SIZE);
        const promises = chunk.map(([eventId, updateData]) => 
            supabase.from('events').update(updateData).eq('id', eventId)
        );
        
        const results = await Promise.all(promises);
        results.forEach((res, idx) => {
            if (res.error) {
                console.error(`[scraper] Failed to merge sources into event ${chunk[idx][0]}:`, res.error.message);
            } else {
                updated++;
            }
        });
    }

    return updated;
}

/* ─── Main Pipeline ─── */

async function run(): Promise<void> {
    const startMs = Date.now();
    console.log(`[scraper] Starting ingestion run at ${new Date().toISOString()} (dry_run=${DRY_RUN})`);

    // Step 1: Fetch raw items from all configured sources
    console.log('[scraper] Fetching raw items from all sources...');
    const [rssItems, redditItems, gnewsItems, osintItems, socialItems] = await Promise.allSettled([
        fetchAllRSSFeeds(),
        fetchAllRedditFeeds(),
        fetchGNews('general', 20),
        fetchOSINTGNews(),
        fetchSocialFeeds(),
    ]).then(results =>
        results.map(r => (r.status === 'fulfilled' ? r.value : []))
    ) as [NewsItem[], NewsItem[], NewsItem[], NewsItem[], NewsItem[]];

    const rawItems: NewsItem[] = [
        ...rssItems,
        ...redditItems,
        ...gnewsItems,
        ...osintItems,
        ...socialItems,
    ];

    console.log(`[scraper] Raw items fetched: ${rawItems.length} (rss=${rssItems.length}, reddit=${redditItems.length}, gnews=${gnewsItems.length + osintItems.length}, social=${socialItems.length})`);

    // Validate that items have URLs as they are required for the conflict key
    const itemsWithUrl = rawItems.filter(item => !!item.url);

    // Step 2: Pre-fetch known URLs from database to skip redundant processing
    console.log('[scraper] Fetching recent known URLs from Supabase...');
    const incomingUrls = itemsWithUrl.map(i => i.url);

    /*
    Supabase in() filter generates GET requests, which can exceed URI length limits.
    Items are processed in chunks of 20 to maintain safe request lengths.
    */
    const knownUrls = new Set<string>();
    const CHUNK_SIZE = 20;
    
    // Fetch chunks in parallel
    const chunkPromises = [];
    for (let i = 0; i < incomingUrls.length; i += CHUNK_SIZE) {
        const chunk = incomingUrls.slice(i, i + CHUNK_SIZE);
        chunkPromises.push(
            supabase.from('events').select('url').in('url', chunk)
        );
    }
    
    const results = await Promise.all(chunkPromises);
    results.forEach((res, idx) => {
        if (res.error) {
            console.error(`[scraper] Failed to pre-fetch chunk ${idx + 1}:`, res.error.message);
            // Non-fatal: failures here mean the unique constraint will handle deduplication during upsert
        } else if (res.data) {
            res.data.forEach((r: { url: string }) => knownUrls.add(r.url));
        }
    });
    
    console.log(`[scraper] Known URLs in DB: ${knownUrls.size}`);

    // Step 3: Filter for new items only
    const newItems = itemsWithUrl.filter(item => !knownUrls.has(item.url));
    console.log(`[scraper] New items to process: ${newItems.length}`);

    if (newItems.length === 0) {
        console.log('[scraper] No new items. Exiting.');
        return;
    }

    // Step 4: Extract geographic data from new items
    console.log('[scraper] Running NLP geocoding on new items...');
    const enrichedItems = await enrichItemsWithLocation(newItems);

    const geocodedCount = enrichedItems.filter(i => i.latitude != null).length;
    console.log(`[scraper] Geocoding complete: ${geocodedCount}/${enrichedItems.length} items mapped`);

    // Step 5: Convert items to database schema
    const dbEvents: DbEvent[] = enrichedItems
        .map(newsItemToDbEvent)
        .filter((e): e is DbEvent => e !== null);

    // Step 6: Vectorize and resolve story merges
    console.log('[scraper] Running semantic vectorization pipeline...');
    const { newEvents, merges } = await resolveStoryMerges(dbEvents, enrichedItems);

    if (DRY_RUN) {
        console.log('[scraper] DRY RUN — would upsert the following events:');
        for (const event of newEvents) {
            console.log(`  * [${event.source_type}] ${event.title.slice(0, 80)}`);
            if (event.latitude) console.log(`    Location: ${event.location_name} (${event.latitude.toFixed(3)}, ${event.longitude!.toFixed(3)})`);
            if (event.embedding) {
                const embStr = typeof event.embedding === 'string' ? event.embedding : JSON.stringify(event.embedding);
                console.log(`    Embedding: [${embStr.slice(0, 40)}...]`);
            }
        }
        console.log(`[scraper] DRY RUN — ${newEvents.length} new events, ${merges.size} story merges`);
        return;
    }

    // Step 7a: Apply story merges (UPDATE existing events' sources arrays)
    if (merges.size > 0) {
        console.log(`[scraper] Applying ${merges.size} story merges...`);
        const mergedCount = await applyMerges(merges);
        console.log(`[scraper] ${mergedCount}/${merges.size} story merges applied`);
    }

    // Step 7b: Upsert new events
    console.log(`[scraper] Upserting ${newEvents.length} new events into Supabase...`);

    // Chunks are upserted sequentially to prevent request size issues and allow error isolation
    const UPSERT_CHUNK_SIZE = 50;
    let totalUpserted = 0;

    for (let i = 0; i < newEvents.length; i += UPSERT_CHUNK_SIZE) {
        const chunk = newEvents.slice(i, i + UPSERT_CHUNK_SIZE);
        const { data: upserted, error: upsertError } = await supabase
            .from('events')
            .upsert(chunk, { onConflict: 'url', ignoreDuplicates: true })
            .select('id');

        if (upsertError) {
            console.error(`[scraper] Chunk upsert failed at index ${i}:`, upsertError.message);
            
            // On chunk failure, retry individual rows to isolate the problematic record
            console.log(`[scraper] Attempting individual upserts for failed chunk to isolate error...`);
            for (const event of chunk) {
                const { error: singleError } = await supabase
                    .from('events')
                    .upsert([event], { onConflict: 'url', ignoreDuplicates: true });
                
                if (singleError) {
                    console.error('[scraper] Individual upsert failed for URL:', event.url);
                    console.error('[scraper] Error:', singleError.message);
                    // Truncate payload for readable logs
                    const safePayload = { ...event, embedding: '[TRUNCATED]' };
                    console.error('[scraper] Payload snippet:', JSON.stringify(safePayload, null, 2));
                } else {
                    totalUpserted++;
                }
            }
        } else {
            totalUpserted += upserted?.length ?? chunk.length;
        }
    }

    const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);
    console.log(`[scraper] Finished ingestion in ${elapsed}s. Events upserted: ${totalUpserted}, Stories merged: ${merges.size}`);
}

// Process entry point
run().catch(err => {
    console.error('[scraper] Unhandled error:', err);
    process.exit(1);
});
