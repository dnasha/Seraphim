import { describe, it, expect, beforeAll } from 'vitest';
import { 
    generateEmbeddings, 
    cosineSimilarity, 
    calculateDistance,
    SIMILARITY_THRESHOLD_STRICT,
    SIMILARITY_THRESHOLD_PROXIMITY,
    MAX_MERGE_DISTANCE_KM,
    buildEmbeddingText 
} from '../../src/scraper/utils/vectorize';

describe('Story Model: Spatial + Semantic Merge Logic', () => {
    beforeAll(async () => {
        await generateEmbeddings(['Warmup']);
    }, 30000);

    const getSim = async (t1: string, d1: string, t2: string, d2: string) => {
        const text1 = buildEmbeddingText(t1, d1);
        const text2 = buildEmbeddingText(t2, d2);
        const [emb1, emb2] = await generateEmbeddings([text1, text2]);
        return cosineSimilarity(emb1, emb2);
    };

    /* 
       Helper to simulate the scraper's merge decision logic
    */
    const shouldMerge = (sim: number, distKm: number | null): boolean => {
        if (sim >= SIMILARITY_THRESHOLD_STRICT) return true;
        if (distKm !== null && sim >= SIMILARITY_THRESHOLD_PROXIMITY && distKm <= MAX_MERGE_DISTANCE_KM) return true;
        return false;
    };

    it('should merge rephrased stories in the same location (Rostov Strike)', async () => {
        const sim = await getSim(
            'Russia-Ukraine war: Drones strike oil refinery in Rostov',
            'A large fire broke out at an oil refinery in Russia\'s Rostov region after a suspected drone attack.',
            'Ukrainian UAVs hit Russian fuel depot in Rostov overnight',
            'Kiev sources claim successful strike on strategic energy infrastructure in the Rostov area.'
        );
        
        // Rostov to Rostov distance is 0km
        const merged = shouldMerge(sim, 0);
        
        console.log(`[Test] Rostov Strike - Sim: ${sim.toFixed(4)}, Dist: 0km -> Merge: ${merged}`);
        
        // It should merge now because 0.64 > 0.60 (Proximity Threshold)
        expect(sim).toBeGreaterThan(SIMILARITY_THRESHOLD_PROXIMITY);
        expect(merged).toBe(true);
    });

    it('should NOT merge similar events in different locations (Protests)', async () => {
        const sim = await getSim(
            'Thousands protest in London against climate change',
            'Demonstrators marched through central London calling for immediate government action.',
            'Thousands protest in Paris against climate change',
            'Protesters gathered at the Place de la République to demand stricter environmental laws.'
        );
        
        // London to Paris is ~340km
        const dist = calculateDistance(51.507, -0.127, 48.856, 2.352);
        const merged = shouldMerge(sim, dist);
        
        console.log(`[Test] Protests - Sim: ${sim.toFixed(4)}, Dist: ${dist.toFixed(0)}km -> Merge: ${merged}`);
        
        // Similarity is high (0.70) but distance is > 50km, so it should NOT merge
        expect(sim).toBeGreaterThan(SIMILARITY_THRESHOLD_PROXIMITY);
        expect(dist).toBeGreaterThan(MAX_MERGE_DISTANCE_KM);
        expect(merged).toBe(false);
    });

    it('should always merge near-identical text regardless of distance', async () => {
        const sim = await getSim(
            'URGENT: Global health emergency declared by WHO',
            'The World Health Organization has declared a new public health emergency of international concern.',
            'URGENT: Global health emergency declared by WHO',
            'The World Health Organization has declared a new public health emergency of international concern.'
        );
        
        // Even if locations are far apart (e.g. source location varies), identical text merges
        const merged = shouldMerge(sim, 5000); 
        
        console.log(`[Test] Strict Match - Sim: ${sim.toFixed(4)}, Dist: 5000km -> Merge: ${merged}`);
        expect(sim).toBeGreaterThan(SIMILARITY_THRESHOLD_STRICT);
        expect(merged).toBe(true);
    });
});
