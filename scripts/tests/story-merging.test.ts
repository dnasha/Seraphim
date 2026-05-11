/*
  Seraphim Story Merging and Smart Selection Tests
  Verifies the logic for consolidating events into stories and selecting the best content.
  Tests credibility-based prioritization, place anchoring, and spatial gating.

  Usage: bun test scripts/tests/story-merging.test.ts
*/

import { describe, it, expect } from 'vitest';
import { 
    calculateDistance, 
    SIMILARITY_THRESHOLD_STRICT, 
    SIMILARITY_THRESHOLD_PLACE_ANCHORED,
    SIMILARITY_THRESHOLD_PROXIMITY, 
    MAX_MERGE_DISTANCE_KM 
} from '@/lib/utils/vectorize';

interface MergeCandidate {
    title: string;
    description: string;
    credibility_tier: number;
}

/*
  selectBestContent
  Logic used by the scraper and re-cluster script to select the master
  content for a merged story based on credibility and detail.
*/
function selectBestContent(current: MergeCandidate, incoming: MergeCandidate) {
    const currentTier = current.credibility_tier || 3;
    const incomingTier = incoming.credibility_tier || 3;

    // Prioritize lower tier numbers (higher credibility).
    if (incomingTier < currentTier) return incoming;
    if (incomingTier > currentTier) return current;

    // Fall back to longer description if tiers are equal.
    const currentLen = (current.description?.length || 0) + (current.title?.length || 0);
    const incomingLen = (incoming.description?.length || 0) + (incoming.title?.length || 0);

    return incomingLen > currentLen ? incoming : current;
}

/*
  evaluateMerge
  Determines if two events should be merged based on a tiered strategy.
*/
function evaluateMerge(similarity: number, distance: number, loc1?: string, loc2?: string) {
    // 1. Strict Semantic: High similarity regardless of distance.
    if (similarity >= SIMILARITY_THRESHOLD_STRICT) return true;
    // 2. Anchored Semantic: Moderate similarity with exact location match.
    if (similarity >= SIMILARITY_THRESHOLD_PLACE_ANCHORED && loc1 && loc2 && loc1 === loc2) return true;
    // 3. Spatial Semantic: Lower similarity within 50km radius.
    if (similarity >= SIMILARITY_THRESHOLD_PROXIMITY && distance <= MAX_MERGE_DISTANCE_KM) return true;
    return false;
}

describe('Story Merging and Smart Selection', () => {

    it('prioritizes Tier 1 sources over Tier 3 even if Tier 3 is longer', () => {
        const master = {
            title: "BOOM! Huge explosion in Kyiv suburb!",
            description: "Detailed but low-credibility eyewitness account...",
            credibility_tier: 3
        };

        const incoming = {
            title: "Explosion reported in Kyiv; authorities investigating",
            description: "Concise report from verified news source.",
            credibility_tier: 1
        };

        const result = selectBestContent(master, incoming);
        expect(result.title).toContain("authorities investigating");
        expect(result.credibility_tier).toBe(1);
    });

    it('keeps the longer description if tiers are identical', () => {
        const master = {
            title: "Earthquake hits Japan",
            description: "A 6.2 magnitude quake hit off the coast.",
            credibility_tier: 1
        };

        const incoming = {
            title: "Significant 6.2 Magnitude Earthquake strikes near Honshu, Japan",
            description: "Detailed report with time and impact information.",
            credibility_tier: 1
        };

        const result = selectBestContent(master, incoming);
        expect(result.title).toContain("Significant");
    });

    it('does NOT merge similar events that are geographically far apart', () => {
        const cityA = { lat: 51.5074, lon: -0.1278 }; // London
        const cityB = { lat: 48.8566, lon: 2.3522 };  // Paris
        
        const similarity = 0.75; // Above proximity threshold, below strict
        const distance = calculateDistance(cityA.lat, cityA.lon, cityB.lat, cityB.lon);
        
        expect(distance).toBeGreaterThan(MAX_MERGE_DISTANCE_KM);
        
        const shouldMerge = evaluateMerge(similarity, distance);
        expect(shouldMerge).toBe(false);
    });

    it('merges identical text regardless of distance', () => {
        const cityA = { lat: 51.5074, lon: -0.1278 }; // London
        const cityB = { lat: -33.8688, lon: 151.2093 }; // Sydney
        
        const similarity = 0.95; // Near identical wire report
        const distance = calculateDistance(cityA.lat, cityA.lon, cityB.lat, cityB.lon);
        
        const shouldMerge = evaluateMerge(similarity, distance);
        expect(shouldMerge).toBe(true);
    });

    it('merges similar events if they share exact location names', () => {
        const similarity = 0.82; // Above anchored threshold
        const distance = 100; // Exceeds standard proximity limit
        
        const shouldMerge = evaluateMerge(similarity, distance, 'Canary Islands', 'Canary Islands');
        expect(shouldMerge).toBe(true);
    });

    it('correctly handles a chain of merges and source deduplication', () => {
        const sources = [{ url: 'url1', name: 'Source 1' }];
        const newSource = { url: 'url2', name: 'Source 2' };

        if (!sources.some(s => s.url === newSource.url)) {
            sources.push(newSource);
        }

        expect(sources.length).toBe(2);
        
        // Duplicate URLs must not grow the sources array.
        const duplicateSource = { url: 'url1', name: 'Source 1' };
        if (!sources.some(s => s.url === duplicateSource.url)) {
            sources.push(duplicateSource);
        }
        expect(sources.length).toBe(2);
    });
});

