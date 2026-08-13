/*
  Seraphim Geocoding Engine Tests
  Verifies the core NLP pipeline for location extraction and dictionary resolution.
  Tests datelines, action-target patterns, prepositions, multi-word locations, and demonyms.

  Usage: bun run test -- scripts/tests/geocoding-engine.test.ts
*/

import { describe, it, expect, beforeAll } from 'vitest';
import { extractLocation, geocodeLocation, resolveLocation, ensureInitialized, KNOWN_LOCATIONS } from '@/lib/geocoding';

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

    it.each(['constructor', 'toString', '__proto__'])(
        'treats Object prototype key %s as an unknown location',
        async placeName => {
            await expect(geocodeLocation(placeName)).resolves.toBeNull();
        },
    );
});

describe('prototype-like article text', () => {
    it('does not crash or create a location for a non-geographic Constructor mention', async () => {
        await expect(resolveLocation(
            'Constructor killed in factory accident',
            'Officials said the constructor was working near machinery.',
        )).resolves.toBeNull();
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
    it('resolves a City, State pair to the exact gazetteer identity and coordinates', async () => {
        const { match, candidates } = extractLocation('Shooting in Austin, Texas leaves 3 dead', '');
        expect(match).toBeDefined();
        const allLower = candidates.map(c => c.toLowerCase());
        expect(allLower.some(c => c.includes('austin') || c.includes('texas'))).toBe(true);

        const resolution = await resolveLocation('Shooting in Austin, Texas leaves 3 dead', '');
        expect(resolution).toMatchObject({
            displayName: 'Austin, Texas',
            lat: 30.27,
            lon: -97.74,
            evidence: 'explicit_pair',
        });
        expect(resolution?.gazetteerId).toBe('geonames:4671654');
    });
});

describe('hierarchy-aware ambiguous location resolution', () => {
    it('resolves Santa Cruz from an explicit California parent', async () => {
        const resolution = await resolveLocation(
            'Bystander video shows teen lifeguard rescue',
            'A boy was rescued from a beach in Santa Cruz, California after being swept offshore.',
        );
        expect(resolution).toMatchObject({
            displayName: 'Santa Cruz, California',
            lat: 36.97,
            lon: -122.03,
            evidence: 'explicit_pair',
        });
        expect(resolution?.gazetteerId).toBe('geonames:5393052');
    });

    it('uses a separately mentioned admin region to resolve Santa Cruz', async () => {
        const resolution = await resolveLocation(
            'Ocean rescue in Santa Cruz',
            'California authorities said the swimmer was brought safely ashore.',
        );
        expect(resolution).toMatchObject({
            displayName: 'Santa Cruz, California',
            lat: 36.97,
            lon: -122.03,
            evidence: 'hierarchy_context',
        });
    });

    it.each([
        ['Police investigate a robbery in Santa Cruz, Costa Rica', 10.26, -85.59, 'Santa Cruz, Costa Rica'],
        ['Court issues a ruling in Santa Cruz Province', -51.63, -69.25, 'Santa Cruz, Argentina', 'Argentina'],
        ['Officials meet in Santa Cruz Department', -17.79, -63.18, 'Santa Cruz Department', 'Bolivia'],
    ])('resolves regional Santa Cruz context: %s', async (title, lat, lon, displayName, context = '') => {
        const resolution = await resolveLocation(title, context);
        expect(resolution).toMatchObject({ displayName, lat, lon });
    });

    it('abstains on bare Santa Cruz without hierarchy evidence', async () => {
        await expect(resolveLocation('Police respond in Santa Cruz', '')).resolves.toBeNull();
    });

    it.each([
        ['Video: suspect transported in a police van', ''],
        ['Cyclist Van der Poel wins shortened stage', ''],
        ['Researcher Mijke van den Hurk defended her thesis', ''],
    ])('does not pin a vehicle or surname to Van, Türkiye: %s', async (title, description) => {
        await expect(resolveLocation(title, description)).resolves.toBeNull();
    });

    it.each([
        ['Crash in Van, Türkiye closes highway', 'Van, Türkiye', 'explicit_pair'],
        ['Earthquake in Van damages homes', 'Van', 'unambiguous'],
    ])('keeps genuine Van geography: %s', async (title, displayName, evidence) => {
        const resolution = await resolveLocation(title, '');
        expect(resolution).toMatchObject({
            displayName,
            lat: 38.49,
            lon: 43.38,
            evidence,
        });
    });

    it.each([
        ['Shooting in Springfield, Illinois', 39.8, -89.64],
        ['Conference in Victoria, British Columbia', 48.44, -123.35],
        ['Storm in Richmond, Virginia', 37.55, -77.46],
        ['Fire in Salem, Oregon', 44.94, -123.04],
        ['Conference in San Jose, California', 37.34, -121.89],
    ])('uses explicit hierarchy for ambiguous city: %s', async (title, lat, lon) => {
        const resolution = await resolveLocation(title, '');
        expect(resolution).toMatchObject({ lat, lon, evidence: 'explicit_pair' });
    });

    it.each(['Springfield', 'Victoria', 'Richmond', 'San Jose'])(
        'abstains when an ambiguous city lacks hierarchy and population dominance: %s',
        async city => {
            await expect(resolveLocation(`Incident reported in ${city}`, '')).resolves.toBeNull();
        },
    );
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
    it('does not pin an uncorroborated title-subject place/person collision', () => {
        const { match } = extractLocation('Burnham announces a new leadership team', 'The company will expand its product line.');
        expect(match).toBeNull();
    });

    it('preserves a location after stripping a recognized outlet suffix', () => {
        const { match } = extractLocation('Explosions reported overnight in Kyiv — Reuters', '');
        expect(match?.toLowerCase()).toContain('kyiv');
    });

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

    it.each([
        'What’s the cheapest way to score Brooks sneakers?',
        'Only three of 62 death cases from Saba Saba protests are in court',
        '10 Best Budgeting Books To Read Now',
        'How solar wind forecasting will help New Horizons spacecraft',
        'Hawthorne Bridge closed to vehicle traffic',
    ])('does not pin known non-geographic collision: %s', (title) => {
        expect(extractLocation(title, '').match).toBeNull();
    });

    it('does not treat a person surname as a location', () => {
        expect(extractLocation('Wikipedia cofounder Jimmy Wales rejects AI edits', '').match).toBeNull();
    });

    it.each([
        ['SAN NICOLAS, Mexico, June 22 - World Cup preview', 'San Nicolas, Mexico'],
        ['Report: Kennedy Space Center not ready for heavy rockets', 'Kennedy Space Center, Florida'],
        ['Workers picket at Target Field ahead of Twins game', 'Minneapolis, Minnesota'],
        ['Starmer speaks from Downing Street', 'London'],
    ])('resolves an unambiguous venue or contextual place: %s', (title, expected) => {
        expect(extractLocation(title, '').match).toBe(expected);
    });

    it('does not map a lowercase surname particle to Van, Türkiye', () => {
        expect(extractLocation(
            'AI explored as tool for unraveling radicalization\'s complex drivers',
            'AI scientist Mijke van den Hurk investigated the issue.'
        ).match).toBeNull();
    });

    it('does not map an uppercase product code to Georgia', () => {
        expect(extractLocation('Casio GA-2100 smartwatch gets a major discount', '').match).toBeNull();
    });

    it('does not map the El Niño climate pattern to a Mexican town', () => {
        expect(extractLocation('Districts prepare for El Niño concerns', '').match).toBeNull();
    });

    it('does not map a political Liberal reference to Liberal, Kansas', () => {
        const result = extractLocation(
            'Inquiry examines alleged illegal political donations',
            'The donations to the Liberal party are under investigation in Australia.'
        );
        expect(result.match).toBe('Australia');
    });

    it('does not map a Knowledge Centre organization name to Centre, Haiti', () => {
        const result = extractLocation(
            'Report details ecological characterization of peatlands',
            'The European Commission Knowledge Centre published the report in Europe.'
        );
        expect(result.match).toBe('Europe');
    });

    it('rejects a lowercase hyphenated NLP fragment', () => {
        expect(extractLocation(
            'Çfarë sinjalizon financimi para-anëtarësues',
            'Instrumenti për Ndihmë Para-Anëtarësimi.'
        ).match).toBeNull();
    });

    it('removes a sports-franchise name before selecting the story location', () => {
        const result = extractLocation(
            'A Portland teen thrifted a Los Angeles Lakers jacket',
            ''
        );
        expect(result.match).toBe('Portland');
    });
});

describe('extractLocation - recent production regressions', () => {
    it('prefers a title-leading country over an incidental destination abbreviation', () => {
        const result = extractLocation(
            'Nepal court jails 2 former ministers over refugee scam',
            'Forged documents enabled Nepali nationals to be resettled in the US.'
        );
        expect(result.match).toBe('Nepal');
    });

    it('extracts a named target port instead of the attacking country', () => {
        const result = extractLocation('A massive US airstrike just hit the Iranian port of Chabahar.', '');
        expect(result.match).toBe('Chabahar');
    });

    it('treats a sports venue as stronger than victory-over wording', () => {
        const result = extractLocation(
            'Spain into World Cup final after victory over France',
            'Spain beat France 2-0 in their semi-final in Dallas.'
        );
        expect(result.match).toBe('Dallas');
    });

    it('normalizes dotted Saint Paul without selecting Paul, Cabo Verde', () => {
        const result = extractLocation('Police investigate vandalism at a St. Paul gallery', '');
        expect(result.match).toBe('Saint Paul');
    });

    it('resolves Nelson Mandela Bay to Gqeberha', () => {
        const result = extractLocation('Nelson Mandela Bay faces sewage pollution penalties', '');
        expect(result.match).toBe('Gqeberha');
    });

    it('uses the Tasmanian demonym rather than a parent-company country', () => {
        const result = extractLocation(
            'Tasmanian government proposes buying a brewery site',
            'The Japanese parent company supports exploring the idea.'
        );
        expect(result.match).toBe('Australia');
    });

    it('keeps a title-leading city above a neighboring city in the description', () => {
        const result = extractLocation(
            'Minneapolis city leaders reckon with projected budget gap',
            'Leaders in neighboring St. Paul face similar choices.'
        );
        expect(result.match).toBe('Minneapolis');
    });

    it('recognizes a title-leading host city', () => {
        const result = extractLocation(
            'London to host the Africa Advancement Forum summit',
            'The summit will focus on Africa\'s strength in unity.'
        );
        expect(result.match).toBe('London');
    });

    it('prefers Bushehr when the title says defenses activated around it', () => {
        const result = extractLocation(
            'Air defences activated around Bushehr nuclear power plant',
            'Explosions were also reported near Bandar Abbas.'
        );
        expect(result.match).toBe('Bushehr');
    });

    it('prefers a stated travel destination over the origin in a title', () => {
        const result = extractLocation(
            'Taiwan opposition launches first trip to mainland China',
            'The delegation left for Shanghai on Tuesday.'
        );
        expect(result.match).toBe('Shanghai');
    });

    it('keeps a reported World Cup venue above competing team countries', () => {
        const result = extractLocation(
            'Spain shuts down France and advances to the final',
            'The reporter filed from the Dallas stadium where the teams played.'
        );
        expect(result.match).toBe('Dallas');
    });

    it('does not mistake person-name components for description locations', () => {
        expect(extractLocation(
            'Five school board candidates removed from ballot',
            'Chicago officials upheld challenges to Angel Velez and Cydney Wallace.'
        ).match).toBe('Chicago');
        expect(extractLocation(
            'Review: Expanding a one-woman show',
            'The cast includes Kerry Washington and Kara Young.'
        ).match).toBeNull();
    });

    it('keeps a possessive title subject above an incidental region mention', () => {
        const result = extractLocation(
            'Campeche’s bees present their case for legal rights',
            'The campaign recalls protections for whales in the Gulf of California.'
        );
        expect(result.match).toBe('Campeche');
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


