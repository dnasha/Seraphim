
import { supabaseAdmin as supabase } from '@/lib/core/supabase';
import { 
    cosineSimilarity, 
    calculateDistance, 
    buildEmbeddingText,
    generateEmbeddings
} from '@/lib/utils/vectorize';

if (!supabase) {
    console.error('Missing Supabase credentials (SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY).');
    process.exit(1);
}

const db = supabase!;

const eventId1 = '5469f13c-5d40-436b-9232-c409f91fe57a';
const eventId2 = '90a04ade-d004-4c52-bf4a-bd82298e9247';

async function debug() {
    console.log(`Fetching events ${eventId1} and ${eventId2}...`);
    
    const { data: events, error } = await db
        .from('events')
        .select('*')
        .in('id', [eventId1, eventId2]);

    if (error) {
        console.error('Error fetching events:', error);
        return;
    }

    if (!events || events.length < 2) {
        console.error('Could not find both events. Found:', events?.length || 0);
        console.log('Events found:', events);
        return;
    }

    const e1 = events.find(e => e.id === eventId1)!;
    const e2 = events.find(e => e.id === eventId2)!;

    console.log('\n--- Event 1 ---');
    console.log('ID:', e1.id);
    console.log('Title:', e1.title);
    console.log('Description:', e1.description);
    console.log('Location:', e1.location_name);
    console.log('Coords:', e1.latitude, e1.longitude);
    console.log('Published At:', e1.published_at);

    console.log('\n--- Event 2 ---');
    console.log('ID:', e2.id);
    console.log('Title:', e2.title);
    console.log('Description:', e2.description);
    console.log('Location:', e2.location_name);
    console.log('Coords:', e2.latitude, e2.longitude);
    console.log('Published At:', e2.published_at);

    // Compare with and without descriptions
    const textsWithDesc = [
        buildEmbeddingText(e1.title, e1.description),
        buildEmbeddingText(e2.title, e2.description)
    ];
    const textsTitleOnly = [
        e1.title,
        e2.title
    ];

    console.log('\n--- Text Comparison ---');
    console.log('With Desc 1:', textsWithDesc[0]);
    console.log('With Desc 2:', textsWithDesc[1]);
    console.log('Title Only 1:', textsTitleOnly[0]);
    console.log('Title Only 2:', textsTitleOnly[1]);

    console.log('\nGenerating embeddings...');
    const freshEmbsWithDesc = await generateEmbeddings(textsWithDesc);
    const freshEmbsTitleOnly = await generateEmbeddings(textsTitleOnly);

    const simWithDesc = cosineSimilarity(freshEmbsWithDesc[0], freshEmbsWithDesc[1]);
    const simTitleOnly = cosineSimilarity(freshEmbsTitleOnly[0], freshEmbsTitleOnly[1]);

    console.log('\n--- Similarity Results ---');
    console.log('Similarity (With Desc):', simWithDesc.toFixed(4));
    console.log('Similarity (Title Only):', simTitleOnly.toFixed(4));

    if (e1.latitude && e1.longitude && e2.latitude && e2.longitude) {
        const dist = calculateDistance(e1.latitude, e1.longitude, e2.latitude, e2.longitude);
        console.log('Distance:', dist.toFixed(2), 'km');
    }

    console.log('\n--- Consolidation Check (TITLE ONLY) ---');
    const sim = simTitleOnly;
    
    console.log('1. Strict (>0.85):', sim >= 0.85 ? 'PASS' : 'FAIL');
    console.log('2. Anchored (>0.75 + exact location):', (sim >= 0.75 && e1.location_name === e2.location_name) ? 'PASS' : `FAIL (Sim=${sim.toFixed(4)})`);
    console.log('3. Spatial (>0.60 + <50km):', (sim >= 0.60 && e1.latitude && e2.latitude && calculateDistance(e1.latitude, e1.longitude, e2.latitude, e2.longitude) <= 50) ? 'PASS' : 'FAIL');
}

debug();
