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

// Mocking the merge logic used in re-cluster and scraper
function selectBestContent(current: MergeCandidate, incoming: MergeCandidate) {
    const currentTier = current.credibility_tier || 3;
    const incomingTier = incoming.credibility_tier || 3;

    if (incomingTier < currentTier) return incoming;
    if (incomingTier > currentTier) return current;

    const currentLen = (current.description?.length || 0) + (current.title?.length || 0);
    const incomingLen = (incoming.description?.length || 0) + (incoming.title?.length || 0);

    return incomingLen > currentLen ? incoming : current;
}

function evaluateMerge(similarity: number, distance: number, loc1?: string, loc2?: string) {
    if (similarity >= SIMILARITY_THRESHOLD_STRICT) return true;
    if (similarity >= SIMILARITY_THRESHOLD_PLACE_ANCHORED && loc1 && loc2 && loc1 === loc2) return true;
    if (similarity >= SIMILARITY_THRESHOLD_PROXIMITY && distance <= MAX_MERGE_DISTANCE_KM) return true;
    return false;
}

describe('Story Merging & Smart Selection', () => {

    it('should prioritize Tier 1 sources over Tier 3 even if Tier 3 is longer', () => {
        const master = {
            title: "BOOM! Huge explosion in Kyiv suburb!",
            description: "OMG it was so loud i think it was a missile or something everyone is running help help help help help",
            credibility_tier: 3
        };

        const incoming = {
            title: "Explosion reported in Kyiv; authorities investigating",
            description: "A loud blast was heard in the northern outskirts of the capital at 14:00. The mayor confirmed air defense was active.",
            credibility_tier: 1
        };

        const result = selectBestContent(master, incoming);
        expect(result.title).toContain("authorities investigating");
        expect(result.credibility_tier).toBe(1);
    });

    it('should keep the longer description if tiers are identical', () => {
        const master = {
            title: "Earthquake hits Japan",
            description: "A 6.2 magnitude quake hit off the coast.",
            credibility_tier: 1
        };

        const incoming = {
            title: "Significant 6.2 Magnitude Earthquake strikes near Honshu, Japan",
            description: "A major earthquake occurred at 05:30 UTC. No immediate tsunami warning has been issued, but tremors were felt in Tokyo.",
            credibility_tier: 1
        };

        const result = selectBestContent(master, incoming);
        expect(result.title).toContain("Significant");
        expect(result.description).toContain("05:30 UTC");
    });

    it('should NOT merge similar events that are geographically far apart (Spatial Gating)', () => {
        // "Protest against new tax laws" - occurs in two different cities
        const cityA = { lat: 51.5074, lon: -0.1278 }; // London
        const cityB = { lat: 48.8566, lon: 2.3522 };  // Paris
        
        const similarity = 0.75; // Above proximity threshold (0.60), below strict (0.85)
        const distance = calculateDistance(cityA.lat, cityA.lon, cityB.lat, cityB.lon);
        
        expect(distance).toBeGreaterThan(MAX_MERGE_DISTANCE_KM);
        
        const shouldMerge = evaluateMerge(similarity, distance);
        
        expect(shouldMerge).toBe(false);
    });

    it('should merge identical text regardless of distance (Wire service reports)', () => {
        const cityA = { lat: 51.5074, lon: -0.1278 }; // London
        const cityB = { lat: -33.8688, lon: 151.2093 }; // Sydney (Across the world)
        
        const similarity = 0.95; // Extremely high (identical Reuters wire)
        const distance = calculateDistance(cityA.lat, cityA.lon, cityB.lat, cityB.lon);
        
        const shouldMerge = evaluateMerge(similarity, distance);
        
        expect(shouldMerge).toBe(true);
    });

    it('should merge similar events if they share the exact same location name (Place Anchoring)', () => {
        const similarity = 0.82; // Below strict (0.85), above anchored (0.75)
        // distance is 100km which would normally fail proximity check
        const distance = 100;
        
        const shouldMerge = evaluateMerge(similarity, distance, 'Canary Islands', 'Canary Islands');
        
        expect(shouldMerge).toBe(true);
    });

    it('should correctly handle a chain of merges (Sources array growth)', () => {
        const sources = [{ url: 'url1', name: 'Source 1' }];
        const newSource = { url: 'url2', name: 'Source 2' };

        // Duplicate check logic
        if (!sources.some(s => s.url === newSource.url)) {
            sources.push(newSource);
        }

        expect(sources.length).toBe(2);
        
        // Re-merging the same URL should not grow the array
        const duplicateSource = { url: 'url1', name: 'Source 1' };
        if (!sources.some(s => s.url === duplicateSource.url)) {
            sources.push(duplicateSource);
        }
        expect(sources.length).toBe(2);
    });
});
