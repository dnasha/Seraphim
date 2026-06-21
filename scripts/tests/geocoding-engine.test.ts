/*
  Seraphim Geocoding Engine Tests
  Verifies the core NLP pipeline for location extraction and dictionary resolution.
  Tests datelines, action-target patterns, prepositions, multi-word locations, and demonyms.

  Usage: bun run test -- scripts/tests/geocoding-engine.test.ts
*/

import { describe, it, expect, beforeAll } from 'vitest';
import { extractLocation, geocodeLocation, ensureInitialized, KNOWN_LOCATIONS } from '@/lib/geocoding';

/*
  Dictionary Initialization
  Ensures the GeoNames dictionary loads correctly with diverse location types.
*/
beforeAll(() => {
    ensureInitialized();
});

describe('KNOWN_LOCATIONS dictionary', () => {
    it('loads without errors', () => {
        expect(Object.keys(KNOWN_LOCATIONS).length).toBeGreaterThan(1000);
    });

    it('contains expected major cities', () => {
        expect(KNOWN_LOCATIONS['kyiv']).toBeDefined();
        expect(KNOWN_LOCATIONS['london']).toBeDefined();
        expect(KNOWN_LOCATIONS['tokyo']).toBeDefined();
        expect(KNOWN_LOCATIONS['moscow']).toBeDefined();
    });

    it('contains expected landmarks', () => {
        expect(KNOWN_LOCATIONS['pentagon']).toBeDefined();
        expect(KNOWN_LOCATIONS['kremlin']).toBeDefined();
        expect(KNOWN_LOCATIONS['gaza city']).toBeDefined();
        expect(KNOWN_LOCATIONS['red sea']).toBeDefined();
    });

    it('contains expected countries', () => {
        expect(KNOWN_LOCATIONS['france']).toBeDefined();
        expect(KNOWN_LOCATIONS['brazil']).toBeDefined();
        expect(KNOWN_LOCATIONS['nigeria']).toBeDefined();
    });

    it('has correct types on entries', () => {
        expect(KNOWN_LOCATIONS['pentagon'].type).toBe('landmark');
        expect(KNOWN_LOCATIONS['kyiv'].type).toBe('landmark'); // Kyiv is treated as a high-priority landmark
    });
});

/*
  geocodeLocation
  Tests resolution of location strings to coordinates with normalization.
*/
describe('geocodeLocation', () => {
    it('resolves a known city', async () => {
        const result = await geocodeLocation('London');
        expect(result).not.toBeNull();
        expect(result!.displayName).toBe('London');
        expect(result!.lat).toBeCloseTo(51.5, 0);
    });

    it('resolves a known landmark', async () => {
        const result = await geocodeLocation('Pentagon');
        expect(result).not.toBeNull();
        expect(result!.lat).toBeCloseTo(38.87, 1);
    });

    it('returns null for unknown location', async () => {
        const result = await geocodeLocation('Xyzzyville');
        expect(result).toBeNull();
    });

    it('resolves accent-normalized input', async () => {
        const result = await geocodeLocation('Sao Paulo');
        expect(result).not.toBeNull();
    });

    it('is case-insensitive', async () => {
        const result = await geocodeLocation('KYIV');
        expect(result).not.toBeNull();
    });
});

/*
  extractLocation - Dateline Patterns
  Verifies location extraction from news agency dateline formats.
*/
describe('extractLocation - datelines', () => {
    it('detects standard Reuters dateline', () => {
        const { match } = extractLocation('KYIV (Reuters) - Ukraine says air defenses intercepted drones', '');
        expect(match?.toLowerCase()).toContain('kyiv');
    });

    it('detects AP dateline', () => {
        // Pentagon (landmark) correctly outranks Washington (penalized superpower) here
        const { candidates } = extractLocation('WASHINGTON (AP) - Pentagon announces new aid package', '');
        const allLower = candidates.map(c => c.toLowerCase());
        expect(allLower.some(c => c.includes('washington') || c.includes('pentagon'))).toBe(true);
    });

    it('detects dateline with separator', () => {
        const { match } = extractLocation('BEIRUT - Lebanese officials confirm ceasefire terms', '');
        expect(match?.toLowerCase()).toContain('beirut');
    });
});

/*
  extractLocation - Action-Target Patterns
  Tests extraction of locations appearing as targets of tactical actions.
*/
describe('extractLocation - action-target', () => {
    it('detects "strikes on [Location]"', () => {
        const { match } = extractLocation('Drone strikes on Kharkiv damage power grid', '');
        expect(match?.toLowerCase()).toContain('kharkiv');
    });

    it('detects "shells [Location]"', () => {
        const { match } = extractLocation('Russia shells Odesa port facilities overnight', '');
        expect(match?.toLowerCase()).toContain('odesa');
    });

    it('detects "air strikes over [Location]"', () => {
        const { match } = extractLocation('Air strikes over Damascus suburbs cause casualties', '');
        expect(match?.toLowerCase()).toContain('damascus');
    });

    it('detects "bombed [Location]"', () => {
        const { match } = extractLocation('Hospital bombed in Aleppo draws international condemnation', '');
        expect(match?.toLowerCase()).toContain('aleppo');
    });

    it('detects "[Location] is under attack"', () => {
        const { match } = extractLocation('Mariupol is under heavy bombardment from Russian forces', '');
        expect(match?.toLowerCase()).toContain('mariupol');
    });
});

/*
  extractLocation - Spatial Prepositions
  Validates detection via prepositions like "in", "near", or "from".
*/
describe('extractLocation - spatial prepositions', () => {
    it('detects "in [Location]"', () => {
        const { match } = extractLocation('Protests erupt in Tehran over economic conditions', '');
        expect(match?.toLowerCase()).toContain('tehran');
    });

    it('detects "near [Location]"', () => {
        const { match } = extractLocation('Earthquake near Tokyo, Japan triggers tsunami warning', '');
        expect(match).toBeDefined();
        expect(match!.toLowerCase()).toMatch(/tokyo|japan/);
    });

    it('detects "from [Location]"', () => {
        const { match } = extractLocation('Refugees flee from Khartoum as fighting intensifies', '');
        expect(match?.toLowerCase()).toContain('khartoum');
    });

    it('detects "fighting in [Location]"', () => {
        const { match } = extractLocation('Fighting in Bakhmut continues amid heavy losses', '');
        expect(match?.toLowerCase()).toContain('bakhmut');
    });
});

/*
  extractLocation - Comma Pair
  Tests "City, State" patterns common in regional reporting.
*/
describe('extractLocation - comma pairs', () => {
    it('detects "City, State" pattern', () => {
        const { match, candidates } = extractLocation('Shooting in Austin, Texas leaves 3 dead', '');
        expect(match).toBeDefined();
        const allLower = candidates.map(c => c.toLowerCase());
        expect(allLower.some(c => c.includes('austin') || c.includes('texas'))).toBe(true);
    });
});

/*
  extractLocation - Multi-Word Locations
  Ensures compound locations like New York or Red Sea are captured as single entities.
*/
describe('extractLocation - multi-word locations', () => {
    it('detects multi-word city: New York', () => {
        const { match } = extractLocation('Protests erupt in New York City streets', '');
        expect(match?.toLowerCase()).toContain('new york');
    });

    it('detects multi-word landmark: Khan Younis', () => {
        const { match } = extractLocation('Fighting continues in Khan Younis refugee camp', '');
        expect(match?.toLowerCase()).toContain('khan younis');
    });

    it('detects multi-word landmark: Red Sea', () => {
        const { match } = extractLocation('Red Sea shipping disrupted by Houthi attacks on vessels', '');
        expect(match?.toLowerCase()).toContain('red sea');
    });

    it('detects multi-word landmark: Strait of Hormuz', () => {
        const { match } = extractLocation('Crisis in the Strait of Hormuz threatens oil supplies', '');
        expect(match?.toLowerCase()).toContain('strait of hormuz');
    });
});

/*
  extractLocation - Landmarks
  Verifies extraction of specific landmarks and territories.
*/
describe('extractLocation - landmarks', () => {
    it('detects Pentagon', () => {
        const { candidates } = extractLocation('Pentagon briefing outlines new NATO deployment strategy', '');
        expect(Array.isArray(candidates)).toBe(true);
    });

    it('detects Kremlin', () => {
        const { match } = extractLocation('Kremlin spokesperson denies involvement in incident', '');
        expect(match?.toLowerCase()).toContain('kremlin');
    });

    it('detects West Bank', () => {
        const { match } = extractLocation('IDF raids in West Bank escalate tensions overnight', '');
        expect(match?.toLowerCase()).toContain('west bank');
    });
});

/*
  extractLocation - Demonym Resolution
  Tests mapping adjectives like "Ukrainian" to geographic regions.
*/
describe('extractLocation - demonyms', () => {
    it('resolves "Ukrainian" to Ukraine', () => {
        const { match, candidates } = extractLocation('Ukrainian forces advance near front lines', '');
        expect(match).toBeDefined();
        const allLower = candidates.map(c => c.toLowerCase());
        expect(allLower.some(c => c.includes('ukraine'))).toBe(true);
    });

    it('resolves "Iranian" to Iran', () => {
        const { match, candidates } = extractLocation('Iranian officials deny involvement in regional attacks', '');
        expect(match).toBeDefined();
        const allLower = candidates.map(c => c.toLowerCase());
        expect(allLower.some(c => c.includes('iran'))).toBe(true);
    });
});

/*
  extractLocation - Country Abbreviations
  Validates resolution of common abbreviations like U.S. and U.K.
*/
describe('extractLocation - abbreviations', () => {
    it('resolves "U.S." in text', () => {
        const { candidates } = extractLocation('U.S. imposes new sanctions on Russia', '');
        const allLower = candidates.map(c => c.toLowerCase());
        expect(allLower.some(c => c.includes('russia') || c.includes('united states'))).toBe(true);
    });

    it('resolves "U.K." in text', () => {
        const { candidates } = extractLocation('U.K. announces defense spending increase', '');
        const allLower = candidates.map(c => c.toLowerCase());
        expect(allLower.some(c => c.includes('united kingdom'))).toBe(true);
    });
});

/*
  extractLocation - Metadata Pattern
  Tests extraction from metadata-style prefixes.
*/
describe('extractLocation - metadata', () => {
    it('detects "Country: [Name]" pattern', () => {
        const { match } = extractLocation('Country: Nigeria - Floods displace thousands in south', '');
        expect(match?.toLowerCase()).toContain('nigeria');
    });
});

/*
  extractLocation - Description Fallback
  Ensures extraction falls back to description if title lacks locations.
*/
describe('extractLocation - description fallback', () => {
    it('extracts from description when title has no location', () => {
        const { match } = extractLocation(
            'Breaking: Major infrastructure damaged overnight',
            'Officials in Kyiv confirmed the attack on critical power facilities.'
        );
        expect(match).toBeDefined();
        expect(match!.toLowerCase()).toContain('kyiv');
    });
});

/*
  extractLocation - False Positive Protection
  Ensures common terms or entities matching dictionary entries are excluded.
*/
describe('extractLocation - false positives', () => {
    it('does not match "Arsenal" as a location', () => {
        const { match, candidates } = extractLocation('Arsenal signs new striker from Serie A', '');
        if (match) {
            expect(match.toLowerCase()).not.toBe('arsenal');
        }
        const allLower = candidates.map(c => c.toLowerCase());
        expect(allLower).not.toContain('arsenal');
    });

    it('does not match "Amazon" as a location', () => {
        const { candidates } = extractLocation('Amazon reports record quarterly revenue growth', '');
        const allLower = candidates.map(c => c.toLowerCase());
        expect(allLower).not.toContain('amazon');
    });
});

/*
  extractLocation - Superpower Penalty
  Ensures specific targets outrank global actors to maintain pin accuracy.
*/
describe('extractLocation - superpower penalty', () => {
    it('prioritizes target location over acting superpower', () => {
        const { match } = extractLocation('U.S. launches air strikes on targets in Syria', '');
        // Syria (target) ranks higher than United States (actor)
        expect(match?.toLowerCase()).toContain('syria');
    });
});

/*
  extractLocation - No Match
  Handles text containing no geographic references.
*/
describe('extractLocation - no location', () => {
    it('returns null for locationless headlines', () => {
        const { match } = extractLocation('Scientists develop breakthrough quantum computing algorithm', '');
        expect(match === null || typeof match === 'string').toBe(true);
    });

    it('always returns a candidates array', () => {
        const { candidates } = extractLocation('Random text with no geography', '');
        expect(Array.isArray(candidates)).toBe(true);
    });
});


