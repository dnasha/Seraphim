
import { createClient } from '@supabase/supabase-js';
import { 
    cosineSimilarity, 
    calculateDistance,
    SIMILARITY_THRESHOLD_STRICT,
    SIMILARITY_THRESHOLD_PLACE_ANCHORED,
    SIMILARITY_THRESHOLD_PROXIMITY,
    MAX_MERGE_DISTANCE_KM,
    buildEmbeddingText
} from '../../src/scraper/utils/vectorize';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Missing environment variables');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function debugHantavirus() {
    console.log('Searching for "hantavirus" events...');
    
    const { data: events, error } = await supabase
        .from('events')
        .select('*')
        .or('title.ilike.%hantavirus%,description.ilike.%hantavirus%');

    if (error) {
        console.error('Error fetching events:', error);
        return;
    }

    if (!events || events.length === 0) {
        console.log('No hantavirus events found.');
        return;
    }

    const parsedEvents = events.map(e => ({
        ...e,
        embedding: typeof e.embedding === 'string' ? JSON.parse(e.embedding) : e.embedding
    }));

    // Filter for Canary Islands (approximate bbox or name)
    const canaryEvents = parsedEvents.filter(e => 
        (e.location_name?.toLowerCase().includes('canary') || e.location_name?.toLowerCase().includes('canarias')) ||
        (e.latitude > 27 && e.latitude < 30 && e.longitude > -19 && e.longitude < -13)
    );

    const { generateEmbeddings } = await import('../../src/scraper/utils/vectorize');
    
    console.log('\nGenerating embeddings for all 5 events...');
    const texts = canaryEvents.map(e => buildEmbeddingText(e.title, e.description));
    const newEmbeddings = await generateEmbeddings(texts);

    for (let i = 0; i < canaryEvents.length; i++) {
        canaryEvents[i].embedding = newEmbeddings[i];
    }

    console.log('\n--- Similarity Matrix (With Fresh Embeddings) ---\n');

    for (let i = 0; i < canaryEvents.length; i++) {
        for (let j = i + 1; j < canaryEvents.length; j++) {
            const e1 = canaryEvents[i];
            const e2 = canaryEvents[j];

            const sim = cosineSimilarity(e1.embedding, e2.embedding);
            const dist = calculateDistance(e1.latitude, e1.longitude, e2.latitude, e2.longitude);

            console.log(`Comparing [${i}] and [${j}]:`);
            console.log(`  Sim: ${sim.toFixed(4)} | Dist: ${dist.toFixed(2)} km`);
            console.log(`  Names: "${e1.location_name}" vs "${e2.location_name}"`);
            
            let match = 'NONE';
            if (sim >= SIMILARITY_THRESHOLD_STRICT) match = 'STRICT (>0.85)';
            else if (sim >= SIMILARITY_THRESHOLD_PLACE_ANCHORED && e1.location_name === e2.location_name && e1.location_name) match = 'ANCHORED (>0.75 + name)';
            else if (sim >= SIMILARITY_THRESHOLD_PROXIMITY && dist <= MAX_MERGE_DISTANCE_KM) match = 'PROXIMITY (>0.60 + 50km)';

            console.log(`  RESULT: ${match}`);
            console.log('');
        }
    }
}

debugHantavirus();
