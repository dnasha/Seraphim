/*
  Core geocoding engine for NLP-based location extraction and disambiguation.
  Processes news titles and descriptions to identify geographic entities
  using a dictionary-based approach combined with heuristic scoring.
*/

if (process.env.NODE_ENV !== 'test' && !process.env.VITEST && !process.env.IS_BENCHMARK && !process.versions?.bun) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('server-only');
}
import nlp from 'compromise';
import geoData from '../../../data/geonames.json';
import {
    LANDMARKS,
    CONTINENT_FALLBACKS,
    DEMONYM_MAP,
    COUNTRY_ABBREV_MAP,
    DATELINE_NOISE_WORDS,
    STOP_WORDS,
    FALSE_POSITIVES,
    CONTINENT_NAMES,
    SUPERPOWER_KEYS,
    NEWS_SOURCE_DEFAULTS,
    OVERRIDE_LOCATIONS,
} from './constants';
import {
    DATELINE_PATTERN,
    EMOJI_STRIP,
    METADATA_COUNTRY_REGEX,
    COMMA_PAIR_PATTERN,
    LOCATION_PATTERNS,
    ACTION_TARGET_PATTERNS,
} from './patterns';
import {
    MEDIA_ATTRIBUTION_SUFFIX,
    SOCIAL_MEDIA_TRAILER,
    HASHTAG_FUSED_PATTERN,
    ADMIN_SUFFIX_PATTERN,
} from './constants';
import {
    normalizeAccents,
    toTitleCase,
    cleanCandidate,
} from './utils';

export interface LocationEntry {
    lat: number;
    lon: number;
    pop: number;
    type: 'city' | 'admin1' | 'country' | 'landmark';
    cc?: string;
}

interface GeoCity { lat: number; lon: number; pop: number; cc: string }
interface GeoRegion { lat: number; lon: number; cc: string }

const geoCities: Record<string, GeoCity> = (geoData as Record<string, unknown>).cities as Record<string, GeoCity>;
const geoAdmin1: Record<string, GeoRegion> = (geoData as Record<string, unknown>).admin1 as Record<string, GeoRegion>;
const geoCountries: Record<string, GeoRegion> = ((geoData as Record<string, unknown>).countries || {}) as Record<string, GeoRegion>;

let isInitialized = false;
export const KNOWN_LOCATIONS: Record<string, LocationEntry> = {};
let MULTI_WORD_LOC_SET: Set<string>;

export function ensureInitialized() {
    if (isInitialized) return;

    // load GeoNames cities: largest population wins on collision
    for (const [key, city] of Object.entries(geoCities)) {
        if (key.length <= 2) continue;
        KNOWN_LOCATIONS[key] = { lat: city.lat, lon: city.lon, pop: city.pop, type: 'city', cc: city.cc };
    }

    // Load admin1 regions (states/provinces), respecting existing city pop density
    for (const [key, region] of Object.entries(geoAdmin1)) {
        if (key.length <= 2) continue;
        const existing = KNOWN_LOCATIONS[key];
        // don't overwrite a city with > 500k pop with an admin1 region
        if (existing && existing.pop > 500000) continue;
        KNOWN_LOCATIONS[key] = { lat: region.lat, lon: region.lon, pop: 0, type: 'admin1', cc: region.cc };
    }

    // load country centroids from geonames
    for (const [name, data] of Object.entries(geoCountries)) {
        if (name.length <= 2) continue;
        KNOWN_LOCATIONS[name] = { lat: data.lat, lon: data.lon, pop: 0, type: 'country', cc: data.cc };
    }

    // load manual overrides
    for (const [name, data] of Object.entries(OVERRIDE_LOCATIONS)) {
        KNOWN_LOCATIONS[name] = { lat: data.lat, lon: data.lon, pop: 0, type: data.type };
    }

    // load hardcoded landmarks and conflict zones
    const REGION_SUFFIX = /\b(oblast|region|province|krai|raion|governorate)$/i;
    for (const [name, coords] of Object.entries(LANDMARKS)) {
        // entries with region-like suffixes get admin1 type for correct priority scoring
        const entryType = REGION_SUFFIX.test(name) ? 'admin1' : 'landmark';
        KNOWN_LOCATIONS[name] = { lat: coords.lat, lon: coords.lon, pop: 0, type: entryType as 'landmark' | 'admin1' };
    }

    // continent-level fallbacks
    for (const [name, coords] of Object.entries(CONTINENT_FALLBACKS)) {
        KNOWN_LOCATIONS[name] = { lat: coords.lat, lon: coords.lon, pop: 0, type: 'landmark' };
    }

    // build dependent sets
    MULTI_WORD_LOC_SET = new Set(Object.keys(KNOWN_LOCATIONS).filter(k => k.includes(' ')));

    isInitialized = true;
}

// exact match check: looks up candidates in the normalized location dictionary
function disambiguate(candidate: string): string {
    ensureInitialized();
    const key = candidate.toLowerCase().trim();
    if (KNOWN_LOCATIONS[key]) return candidate;
    // try accent-normalized form (e.g. "Irán" to "iran")
    const normalized = normalizeAccents(key);
    if (normalized !== key && KNOWN_LOCATIONS[normalized]) {
        // return the display name that matches the dictionary key
        return normalizeAccents(candidate);
    }
    return candidate;
}

// try to resolve a demonym ("chinese" to "china")
function extractDemonym(text: string): string | null {
    const words = text.split(/[\s\-]+/);
    for (const word of words) {
        const lower = word.toLowerCase().replace(/[^a-z]/g, '');
        if (DEMONYM_MAP[lower]) {
            return DEMONYM_MAP[lower];
        }
        if (lower.endsWith('s') && DEMONYM_MAP[lower.slice(0, -1)]) {
            return DEMONYM_MAP[lower.slice(0, -1)];
        }
    }
    return null;
}

// try to resolve country abbreviations in text ("u.s." to "united states")
// keeps periods so we can match "u.s." properly, unlike demonyms which strip punctuation
function extractCountryAbbrev(text: string): string | null {
    // split on whitespace and hyphens
    const tokens = text.split(/[\s\-]+/);
    for (const token of tokens) {
        // normalize: lowercase, strip trailing commas/colons/semicolons but keep periods
        const cleaned = token.toLowerCase().replace(/[,;:!?'")\]]+$/, '').replace(/^['"(\[]+/, '');
        const mapped = COUNTRY_ABBREV_MAP[cleaned];
        if (mapped && mapped !== '__skip__') {
            return mapped;
        }
    }
    return null;
}

// assigns priority scores (lower is better/more specific)
function locationPriority(key: string): number {
    ensureInitialized();
    const entry = KNOWN_LOCATIONS[key];
    if (!entry) return 99;
    switch (entry.type) {
        case 'landmark': return 0;
        case 'city': return entry.pop > 1000000 ? 2 : 4;
        case 'country': return 6;
        case 'admin1': return 8;
        default: return 99;
    }
}

interface Candidate {
    name: string;
    source: 'dateline' | 'comma_pair' | 'regex' | 'direct_scan' | 'nlp' | 'demonym' | 'abbrev' | 'action_target' | 'compound_scan' | 'title_subject' | 'possessive_focus';
    placement: 'title' | 'description';
}

// strip known media attribution, social-media trailers, and clean hashtag-fused text
function preprocessText(text: string): string {
    // strip social media trailers first (longer matches)
    text = text.replace(SOCIAL_MEDIA_TRAILER, '');
    // strip "GeoConfirmed [Country]." OSINT prefix (e.g., "GeoConfirmed Iran.\n" to "")
    text = text.replace(/^GeoConfirmed\s+\w+\.?\s*/i, '');
    // normalize smart/curly quotes to straight quotes for consistent tokenization
    text = text.replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"');
    // extract abbreviation before possessive eats it: "UK's" to "UK ", "U.S.'s" to "U.S." etc.
    text = text.replace(/\b(U\.S\.|U\.K\.|U\.A\.E\.|NK|EU|NATO|UK|US|UAE)['\u2019]s\b/gi, '$1 ');
    // split fused hashtag+text: "#NKNorth Korea" to "North Korea", "#USAPresident" to "President"
    text = text.replace(HASHTAG_FUSED_PATTERN, '$2');
    // remove remaining hashtags
    text = text.replace(/#\w+/g, '');
    // strip trailing media source attribution (" - Reuters", " - Middle East Eye")
    text = text.replace(MEDIA_ATTRIBUTION_SUFFIX, '');
    return text.trim();
}

export function extractLocation(title: string, description: string): { match: string | null; candidates: string[] } {
    ensureInitialized();
    // strip emoji and normalize whitespace
    title = title.replace(EMOJI_STRIP, ' ').replace(/\s+/g, ' ').trim();
    description = description.replace(EMOJI_STRIP, ' ').replace(/\s+/g, ' ').trim();
    // clean media attribution and hashtag noise before extraction
    title = preprocessText(title);
    description = preprocessText(description);

    const candidates: Candidate[] = [];

    // helper: check if a dateline candidate is a genuine geographic dateline
    function isGenuineDateline(raw: string): boolean {
        const words = raw.toLowerCase().split(/\s+/);
        // reject section labels ("Iran Live Updates:")
        if (words.some(w => DATELINE_NOISE_WORDS.has(w))) return false;
        // reject continent-level datelines ("Africa: Morocco...")
        const key = raw.toLowerCase().trim();
        if (CONTINENT_NAMES.has(key)) return false;
        return true;
    }

    // 1a. structured metadata pattern (ReliefWeb, humanitarian feeds)
    let metaMatch = METADATA_COUNTRY_REGEX.exec(title);
    if (metaMatch) candidates.push({ name: metaMatch[1].trim(), source: 'dateline', placement: 'title' });
    metaMatch = METADATA_COUNTRY_REGEX.exec(description);
    if (metaMatch) candidates.push({ name: metaMatch[1].trim(), source: 'dateline', placement: 'description' });

    // 1b. dateline from title or description (highest confidence)
    const titleDateline = DATELINE_PATTERN.exec(title);
    if (titleDateline && isGenuineDateline(titleDateline[1])) {
        candidates.push({ name: titleDateline[1].trim(), source: 'dateline', placement: 'title' });
    }
    const descDateline = DATELINE_PATTERN.exec(description);
    if (descDateline && isGenuineDateline(descDateline[1])) {
        candidates.push({ name: descDateline[1].trim(), source: 'dateline', placement: 'description' });
    }

    // 1c. title-subject country extraction
    {
        const strippedTitle = title.replace(/^[^a-zA-Z\u00C0-\u024F]+/, '');
        const titleWords = strippedTitle.split(/\s+/);
        for (let len = Math.min(3, titleWords.length); len >= 1; len--) {
            const prefix = titleWords.slice(0, len).join(' ');
            const cleaned = cleanCandidate(prefix);
            const key = normalizeAccents(cleaned.toLowerCase());
            if (key.length > 2 && KNOWN_LOCATIONS[key] && !STOP_WORDS.has(key) && !CONTINENT_NAMES.has(key)) {
                candidates.push({ name: cleaned, source: 'title_subject', placement: 'title' });
                break;
            }
        }
    }

    // 2. comma-pair extraction ("Austin, Texas")
    COMMA_PAIR_PATTERN.lastIndex = 0;
    let commaMatch;
    while ((commaMatch = COMMA_PAIR_PATTERN.exec(title)) !== null) {
        candidates.push({ name: `${commaMatch[1].trim()}, ${commaMatch[2].trim()}`, source: 'comma_pair', placement: 'title' });
        candidates.push({ name: commaMatch[1].trim(), source: 'comma_pair', placement: 'title' });
    }
    COMMA_PAIR_PATTERN.lastIndex = 0;
    while ((commaMatch = COMMA_PAIR_PATTERN.exec(description)) !== null) {
        candidates.push({ name: `${commaMatch[1].trim()}, ${commaMatch[2].trim()}`, source: 'comma_pair', placement: 'description' });
        candidates.push({ name: commaMatch[1].trim(), source: 'comma_pair', placement: 'description' });
    }

    // pass 3: optimized multi-word dictionary scan
    const fastDictionaryScan = (text: string, placement: 'title' | 'description') => {
        const words = text.split(/[\s,.;:!?()\[\]"']+/).filter(w => w.length > 0);
        for (let i = 0; i < words.length; i++) {
            // single word scan
            const word = words[i];
            if (word !== word.toLowerCase() || word.length <= 3) {
                const cleanedWord = cleanCandidate(word);
                if (cleanedWord.length > 2) {
                    const keyWord = normalizeAccents(cleanedWord.toLowerCase());
                    const entry = KNOWN_LOCATIONS[keyWord];
                    if (entry && !MULTI_WORD_LOC_SET.has(keyWord) && !STOP_WORDS.has(keyWord) && !FALSE_POSITIVES.has(keyWord)) {
                        // Only allow single-word matches for specific, unambiguous, or major locations
                        const isMajor = entry.type === 'country' || entry.type === 'landmark' || entry.type === 'admin1' || entry.pop > 500000;
                        if (isMajor) {
                            candidates.push({ name: cleanedWord, source: 'direct_scan', placement });
                        }
                    }
                }
            }

            // multi word scan
            for (let len = Math.min(4, words.length - i); len >= 2; len--) {
                const slice = words.slice(i, i + len).join(' ');
                // if the entire slice is lowercase, it's very likely a common noun phrase (e.g. "la paz" = "the peace")
                // except for certain small connecting words, but even then, a location should usually have some capitalization.
                if (slice === slice.toLowerCase()) continue;
                
                const cleaned = cleanCandidate(slice);
                if (cleaned.length <= 3) continue;
                const key = normalizeAccents(cleaned.toLowerCase());
                if (MULTI_WORD_LOC_SET.has(key) && !STOP_WORDS.has(key) && !FALSE_POSITIVES.has(key)) {
                    candidates.push({ name: cleaned, source: 'compound_scan', placement });
                }
            }
        }
    };
    fastDictionaryScan(title, 'title');
    fastDictionaryScan(description, 'description');

    // pass 4: regex-based extraction from both title and description
    for (const pattern of LOCATION_PATTERNS) {
        pattern.lastIndex = 0;
        let match;
        while ((match = pattern.exec(title)) !== null) {
            candidates.push({ name: match[1].trim(), source: 'regex', placement: 'title' });
        }
        pattern.lastIndex = 0;
        while ((match = pattern.exec(description)) !== null) {
            candidates.push({ name: match[1].trim(), source: 'regex', placement: 'description' });
        }
    }

    // 4b. action-target patterns (highest confidence for event location)
    for (const pattern of ACTION_TARGET_PATTERNS) {
        pattern.lastIndex = 0;
        let match;
        while ((match = pattern.exec(title)) !== null) {
            candidates.push({ name: match[1].trim(), source: 'action_target', placement: 'title' });
        }
        pattern.lastIndex = 0;
        while ((match = pattern.exec(description)) !== null) {
            candidates.push({ name: match[1].trim(), source: 'action_target', placement: 'description' });
        }
    }

    // pass 4b: possessive-linked location extraction: "Indonesia's Bali" to extract Bali
    // pattern: [Word]'s [Title-cased word(s)] that exist in the dictionary
    const POSSESSIVE_LOC = /(?:[A-Za-z]+)['\u2019]s\s+([A-Z][a-zA-Z\u00C0-\u024F]+(?:\s+[A-Z][a-zA-Z\u00C0-\u024F]+){0,2})/g;
    const scanPossessive = (text: string, placement: 'title' | 'description') => {
        POSSESSIVE_LOC.lastIndex = 0;
        let m;
        while ((m = POSSESSIVE_LOC.exec(text)) !== null) {
            const inner = cleanCandidate(m[1]);
            const key = normalizeAccents(inner.toLowerCase());
            if (key.length > 2 && KNOWN_LOCATIONS[key] && !STOP_WORDS.has(key) && !FALSE_POSITIVES.has(key)) {
                // give it a high priority source: it is a directly named location inside a possessive
                candidates.push({ name: inner, source: 'possessive_focus', placement });
            }
        }
    };
    scanPossessive(title, 'title');
    scanPossessive(description, 'description');

    // 5. early fallback promotions
    const titleAbbrev = extractCountryAbbrev(title);
    if (titleAbbrev) candidates.push({ name: titleAbbrev, source: 'abbrev', placement: 'title' });
    const descAbbrev = extractCountryAbbrev(description);
    if (descAbbrev) candidates.push({ name: descAbbrev, source: 'abbrev', placement: 'description' });

    const titleDemonym = extractDemonym(title);
    if (titleDemonym) candidates.push({ name: titleDemonym, source: 'demonym', placement: 'title' });
    const descDemonym = extractDemonym(description);
    if (descDemonym) candidates.push({ name: descDemonym, source: 'demonym', placement: 'description' });

    // pass 6: scanning for known high-priority landmarks
    const scanLandmarks = (text: string, placement: 'title' | 'description') => {
        const words = text.split(/[\s,.;:!?()\[\]"']+/).filter(w => w.length > 0);
        for (let i = 0; i < words.length; i++) {
            for (let len = Math.min(4, words.length - i); len >= 1; len--) {
                const slice = words.slice(i, i + len).join(' ');
                const cleaned = cleanCandidate(slice);
                const key = normalizeAccents(cleaned.toLowerCase());
                if (LANDMARKS[key]) {
                    candidates.push({ name: cleaned, source: 'direct_scan', placement });
                }
            }
        }
    };
    scanLandmarks(title, 'title');
    scanLandmarks(description, 'description');

    // score and sort candidates
    interface ScoredCandidate {
        name: string;
        key: string;
        source: string;
        placement: 'title' | 'description';
        score: number;
        cc?: string;
    }

    function computeScored(candidateList: Candidate[]): ScoredCandidate[] {
        const scored: ScoredCandidate[] = [];

        for (const { name: raw, source, placement } of candidateList) {
            const candidate = cleanCandidate(raw);

            if (!candidate || candidate.length <= 2) continue;
            if (STOP_WORDS.has(candidate.toLowerCase())) continue;
            if (FALSE_POSITIVES.has(candidate.toLowerCase())) continue;

            const loc = disambiguate(candidate);
            let key = normalizeAccents(loc.toLowerCase());

            // strip administrative suffixes to resolve "Belgorod Oblast" to "Belgorod"
            if (!KNOWN_LOCATIONS[key]) {
                const stripped = key.replace(ADMIN_SUFFIX_PATTERN, '').trim();
                if (stripped !== key && stripped.length > 2 && KNOWN_LOCATIONS[stripped]) {
                    key = stripped;
                }
            }

            const entry = KNOWN_LOCATIONS[key];
            if (!entry) {
                const words = key.split(/\s+/);
                const rawWords = raw.split(/\s+/);
                let found = false;
                
                /*
                  Handle multi-word candidates: verify prefix matches and avoid surname collisions.
                  Check if a sub-phrase of the candidate exists in the dictionary.
                */
                for (let len = words.length - 1; len >= 1; len--) {
                    const sub = words.slice(0, len).join(' ');
                    if (sub.length > 2 && !STOP_WORDS.has(sub) && !FALSE_POSITIVES.has(sub) && KNOWN_LOCATIONS[sub]) {
                        // potential match. Check if the next word looks like a surname.
                        // if the next word exists, is capitalized in original text, and isn't a known location/noise word
                        const nextWordRaw = rawWords[len];
                        if (nextWordRaw && /^[A-Z]/.test(nextWordRaw)) {
                            const nextWordLower = nextWordRaw.toLowerCase().replace(/[^a-z]/g, '');
                            // if the next word is NOT a known location and NOT a common location suffix (City, State, etc)
                            if (!KNOWN_LOCATIONS[nextWordLower] && 
                                !['city', 'state', 'province', 'river', 'lake', 'bay', 'gulf', 'mountain', 'island', 'islands'].includes(nextWordLower)) {
                                // probably a name like "Heba Morayef" or "Graham Harris"
                                continue; 
                            }
                        }
                        
                        key = sub;
                        found = true;
                        break;
                    }
                }
                if (!found && source !== 'abbrev' && source !== 'demonym') continue;
            }

            // filter out noisy topic headers (e.g., "Israel War", "Gaza Update")
            const lowKey = raw.toLowerCase();
            if (lowKey.endsWith(' war') || lowKey.endsWith(' update') ||
                lowKey.endsWith(' report') || lowKey.endsWith(' brief') ||
                lowKey.endsWith(' briefing') || lowKey.endsWith(' talks') ||
                lowKey.endsWith(' negotiations') || lowKey.endsWith(' deal')) {
                if (source !== 'dateline') continue;
            }

            const finalEntry = KNOWN_LOCATIONS[key];
            const displayName = toTitleCase(key);
            const wPlacement = placement === 'title' ? 0 : 12;
            let wSource = 0;
            switch(source) {
                case 'possessive_focus': wSource = -15; break;
                case 'action_target': wSource = -20; break;
                case 'dateline': wSource = -15; break;
                case 'title_subject': wSource = -8; break;
                case 'compound_scan': wSource = 0; break;
                case 'comma_pair': wSource = 0; break;
                case 'regex': wSource = -12; break;
                case 'demonym': case 'abbrev': wSource = placement === 'title' ? 8 : 14; break;
                case 'direct_scan': wSource = placement === 'title' ? 6 : 12; break;
                case 'nlp': wSource = 15; break;
            }
            const wType = locationPriority(key);
            const continentPenalty = CONTINENT_NAMES.has(key) ? 40 : 0;
            const regionPenalty = (key === 'middle east' || key === 'west asia' || key === 'southeast asia') ? 25 : 0;
            const superpowerPenalty = SUPERPOWER_KEYS.has(key) ? 20 : 0;

            const finalScore = wPlacement + wSource + wType + continentPenalty + regionPenalty + superpowerPenalty;

            scored.push({
                name: displayName,
                key,
                source,
                placement,
                score: finalScore,
                cc: finalEntry?.cc
            });
        }

        /*
          Second pass: boost specific locations (cities/landmarks) if their parent country
          is also present in the text.
        */
        const foundCountries = new Set(scored.filter(s => KNOWN_LOCATIONS[s.key]?.type === 'country').map(s => s.cc));
        const foundAdmin1CCs = new Set(scored.filter(s => KNOWN_LOCATIONS[s.key]?.type === 'admin1').map(s => KNOWN_LOCATIONS[s.key]?.cc));
        for (const s of scored) {
            const entry = KNOWN_LOCATIONS[s.key];
            if (!entry) continue;
            if ((entry.type === 'city' || entry.type === 'landmark') && s.cc && foundCountries.has(s.cc)) {
                s.score -= 10; // Hierarchical boost: city/landmark within a mentioned country
            }
            // boost city when its parent admin1 region is also present BUT no country-level boost already applied
            // (prevents double-stacking that would over-promote cities like São Paulo over Brazil)
            if (entry.type === 'city' && entry.cc && foundAdmin1CCs.has(entry.cc) && !foundCountries.has(entry.cc)) {
                s.score -= 8; // city is more specific than its parent region
            }
        }

        /*
          Third pass: title-country priority.
          If a superpower country appears in the title but would lose to a description-only country,
          reduce its penalty to prevent description noise from overshadowing the headline subject.
        */
        const titleCountries = scored.filter(s =>
            s.placement === 'title' && KNOWN_LOCATIONS[s.key]?.type === 'country' && SUPERPOWER_KEYS.has(s.key)
        );
        if (titleCountries.length > 0) {
            const bestTitleCountry = titleCountries.reduce((a, b) => a.score < b.score ? a : b);
            const descOnlyCountries = scored.filter(s =>
                s.placement === 'description' && KNOWN_LOCATIONS[s.key]?.type === 'country' &&
                !scored.some(t => t.key === s.key && t.placement === 'title')
            );
            for (const descC of descOnlyCountries) {
                if (descC.score < bestTitleCountry.score) {
                    // a description-only country is beating a title superpower: boost the title one
                    bestTitleCountry.score -= 15;
                    break;
                }
            }
        }

        scored.sort((a, b) => {
            if (a.score !== b.score) return a.score - b.score;
            const popA = KNOWN_LOCATIONS[a.key]?.pop || 0;
            const popB = KNOWN_LOCATIONS[b.key]?.pop || 0;
            return popB - popA;
        });

        return scored;
    }

    let bestCandidates = computeScored(candidates);

    if (bestCandidates.length === 0) {
        const titlePlaces = nlp(title).places().out('array');
        if (titlePlaces && titlePlaces.length > 0) {
            for (const place of titlePlaces) {
                candidates.push({ name: place, source: 'nlp', placement: 'title' });
            }
            bestCandidates = computeScored(candidates);
        }

        if (bestCandidates.length === 0) {
            const descPlaces = nlp(description).places().out('array');
            if (descPlaces && descPlaces.length > 0) {
                for (const place of descPlaces) {
                    candidates.push({ name: place, source: 'nlp', placement: 'description' });
                }
                bestCandidates = computeScored(candidates);
            }
        }
    }

    if (bestCandidates.length > 0) {
        return { 
            match: bestCandidates[0].name, 
            candidates: bestCandidates.map(c => c.name) 
        };
    }

    const scanCountries = (text: string) => {
        const words = text.split(/[\s,.;:!?()\[\]"']+/).filter(w => w.length > 0);
        for (let i = 0; i < words.length; i++) {
            for (let len = Math.min(4, words.length - i); len >= 1; len--) {
                const slice = words.slice(i, i + len).join(' ');
                const cleaned = cleanCandidate(slice);
                const key = normalizeAccents(cleaned.toLowerCase());
                if (geoCountries[key]) {
                    const display = toTitleCase(key);
                    return { match: display, candidates: [display] };
                }
            }
        }
        return null;
    };

    const countryMatch = scanCountries(title) || scanCountries(description);
    if (countryMatch) return countryMatch;

    const scanContinents = (text: string) => {
        const words = text.split(/[\s,.;:!?()\[\]"']+/).filter(w => w.length > 0);
        for (let i = 0; i < words.length; i++) {
            for (let len = Math.min(4, words.length - i); len >= 1; len--) {
                const slice = words.slice(i, i + len).join(' ');
                const cleaned = cleanCandidate(slice);
                const key = normalizeAccents(cleaned.toLowerCase());
                if (CONTINENT_FALLBACKS[key]) {
                    const display = toTitleCase(key);
                    return { match: display, candidates: [display] };
                }
            }
        }
        return null;
    };

    const continentMatch = scanContinents(title) || scanContinents(description);
    if (continentMatch) return continentMatch;

    // pass 7: last-resort news source defaults
    const combinedText = (title + ' ' + description).toLowerCase();
    for (const [source, location] of Object.entries(NEWS_SOURCE_DEFAULTS)) {
        if (new RegExp(`\\b${source}\\b`).test(combinedText)) {
            const display = toTitleCase(location);
            return { match: display, candidates: [display] };
        }
    }

    return { match: null, candidates: [] };
}

// Aliases: when a short landmark name is found, return the canonical full name
const LANDMARK_DISPLAY_ALIASES: Record<string, string> = {
    'hormuz': 'Strait of Hormuz',
    'bab el-mandeb': 'Bab El-Mandeb',
    'kiryat shmona': 'Qiryat Shemona',
};

export async function geocodeLocation(
    placeName: string
): Promise<{ lat: number; lon: number; displayName: string } | null> {
    ensureInitialized();
    const key = normalizeAccents(placeName.toLowerCase().trim());
    const known = KNOWN_LOCATIONS[key];
    if (known) {
        // use canonical display alias if one exists
        const displayName = LANDMARK_DISPLAY_ALIASES[key] || placeName;
        return { lat: known.lat, lon: known.lon, displayName };
    }
    return null;
}
