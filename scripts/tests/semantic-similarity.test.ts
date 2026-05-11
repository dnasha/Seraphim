/*
  Seraphim Semantic Similarity Tests
  Verifies spatial and semantic merge logic for story consolidation.
  Tests strict semantic matching, proximity-based merging, and distance gating.

  Usage: bun test scripts/tests/semantic-similarity.test.ts
*/

import { describe, it, expect, beforeAll } from 'vitest';
import { 
    generateEmbeddings, 
    cosineSimilarity, 
    calculateDistance,
    SIMILARITY_THRESHOLD_STRICT,
    SIMILARITY_THRESHOLD_PROXIMITY,
    MAX_MERGE_DISTANCE_KM,
    buildEmbeddingText 
} from '@/lib/utils/vectorize';

describe('Story Model: Spatial and Semantic Merge Logic', () => {
    /*
      Warmup
      Initializes the local embedding model (all-MiniLM-L6-v2) for vectorization.
    */
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
      shouldMerge
      Simulates the decision logic for merging two events based on
      semantic similarity and geographic distance.
    */
    const shouldMerge = (sim: number, distKm: number | null): boolean => {
        if (sim >= SIMILARITY_THRESHOLD_STRICT) return true;
        if (distKm !== null && sim >= SIMILARITY_THRESHOLD_PROXIMITY && distKm <= MAX_MERGE_DISTANCE_KM) return true;
        return false;
    };

    it('should merge rephrased stories in the same location', async () => {
        const sim = await getSim(
            'Russia-Ukraine war: Drones strike oil refinery in Rostov',
            'A large fire broke out at an oil refinery in Russia\'s Rostov region after a suspected drone attack.',
            'Ukrainian UAVs hit Russian fuel depot in Rostov overnight',
            'Kiev sources claim successful strike on strategic energy infrastructure in the Rostov area.'
        );
        
        // Co-located events with similarity > 0.60 should merge.
        const merged = shouldMerge(sim, 0);
        
        expect(sim).toBeGreaterThan(SIMILARITY_THRESHOLD_PROXIMITY);
        expect(merged).toBe(true);
    });

    it('should NOT merge similar events in different locations', async () => {
        const sim = await getSim(
            'Thousands protest in London against climate change',
            'Demonstrators marched through central London calling for immediate government action.',
            'Thousands protest in Paris against climate change',
            'Protesters gathered at the Place de la République to demand stricter environmental laws.'
        );
        
        // London to Paris is approximately 340km.
        const dist = calculateDistance(51.507, -0.127, 48.856, 2.352);
        const merged = shouldMerge(sim, dist);
        
        // High similarity (0.70) but distance > 50km should prevent merging.
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
        
        // Identical wire service reports should merge even if coordinates differ.
        const merged = shouldMerge(sim, 5000); 
        
        expect(sim).toBeGreaterThan(SIMILARITY_THRESHOLD_STRICT);
        expect(merged).toBe(true);
    });
});

