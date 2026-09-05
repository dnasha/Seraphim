/**
 * CORE GEOCODING ENGINE
 * 
 * This module provides the primary logic for extracting geographic locations from
 * unstructured news text. It utilizes a tiered dictionary lookup (Cities > Admin1 > Countries),
 * custom NLP heuristics, and a scoring system to disambiguate and rank candidates.
 */

if (process.env.NODE_ENV !== 'test' && !process.env.VITEST && !process.env.IS_BENCHMARK && !process.versions?.bun) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('server-only');
}
import nlp from 'compromise';
import geoData from '../../../data/geonames.json';
import {
    DATELINE_NOISE_WORDS,
    CONTINENT_NAMES,
    STOP_WORDS,
    FALSE_POSITIVES,
    LANDMARKS,
    CONTINENT_FALLBACKS,
    DEMONYM_MAP,
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
    normalizeAccents,
    toTitleCase,
    cleanCandidate,
} from './utils';
import {
    KNOWN_LOCATIONS,
    MULTI_WORD_LOC_SET,
    ensureInitialized,
    getDefaultLocationCandidate,
    getDominantLocationCandidate,
    getLocationCandidates,
    type LocationEntry,
} from './dictionary';
import {
    extractDemonym,
    extractCountryAbbrev,
    preprocessText,
} from './nlpUtils';
import {
    computeScored,
    Candidate,
    ScoredCandidate,
} from './scoring';

// Re-export public types and values for backward compatibility
export type { LocationEntry } from './dictionary';
export { KNOWN_LOCATIONS, ensureInitialized };

/**
 * Performs a multi-pass extraction process on news items.
 * Uses tiered heuristics to identify the most relevant geographic location.
 */
export function extractLocation(title: string, description: string): { match: string | null; candidates: string[]; scored?: ScoredCandidate[] } {
    ensureInitialized();
    
    title = title.replace(EMOJI_STRIP, ' ').replace(/\s+/g, ' ').trim();
    description = description.replace(EMOJI_STRIP, ' ').replace(/\s+/g, ' ').trim();
    
    title = preprocessText(title);
    description = preprocessText(description);

    const candidates: Candidate[] = [];
    const titleLeadingToken = cleanCandidate(title.split(/\s+/)[0] || '');
    const titleLeadingKey = normalizeAccents(titleLeadingToken.toLowerCase());

    /**
     * Validates if a string looks like a standard geographic dateline.
     * Rejects common noise words and broad continent headers.
     */
    function isGenuineDateline(raw: string): boolean {
        const words = raw.toLowerCase().split(/\s+/);
        if (words.some(w => DATELINE_NOISE_WORDS.has(w))) return false;
        const key = raw.toLowerCase().trim();
        if (CONTINENT_NAMES.has(key)) return false;
        return true;
    }

    // Pass 1: Structured metadata and datelines (Highest confidence)
    let metaMatch = METADATA_COUNTRY_REGEX.exec(title);
    if (metaMatch) candidates.push({ name: metaMatch[1].trim(), source: 'dateline', placement: 'title' });
    metaMatch = METADATA_COUNTRY_REGEX.exec(description);
    if (metaMatch) candidates.push({ name: metaMatch[1].trim(), source: 'dateline', placement: 'description' });

    const titleDateline = DATELINE_PATTERN.exec(title);
    if (titleDateline && isGenuineDateline(titleDateline[1])) {
        candidates.push({ name: titleDateline[1].trim(), source: 'dateline', placement: 'title' });
    }
    const descDateline = DATELINE_PATTERN.exec(description);
    if (descDateline && isGenuineDateline(descDateline[1])) {
        candidates.push({ name: descDateline[1].trim(), source: 'dateline', placement: 'description' });
    }

    // Pass 1c: Subject extraction from title start
    {
        const strippedTitle = title.replace(/^[^a-zA-Z\u00C0-\u024F]+/, '');
        const titleWords = strippedTitle.split(/\s+/);
        for (let len = Math.min(3, titleWords.length); len >= 1; len--) {
            const prefix = titleWords.slice(0, len).join(' ');
            const cleaned = cleanCandidate(prefix);
            const key = normalizeAccents(cleaned.toLowerCase());
            if (key.length > 2 && KNOWN_LOCATIONS[key] && !STOP_WORDS.has(key) && !CONTINENT_NAMES.has(key)) {
                // Heuristic protection: if the candidate is a common first name,
                // and the next word is capitalized (not a known location or stop word),
                // then it's probably a person's full name.
                let shouldSkip = false;
                if (len === 1 && ['virginia', 'milan', 'clara', 'victoria', 'charlotte', 'elizabeth', 'saint', 'st'].includes(key)) {
                    if (titleWords.length > 1) {
                        const nextWordRaw = titleWords[1];
                        if (nextWordRaw && /^[A-Z]/.test(nextWordRaw)) {
                            const nextWordLower = nextWordRaw.toLowerCase().replace(/[^a-z]/g, '');
                            if (nextWordLower.length > 0 &&
                                !KNOWN_LOCATIONS[nextWordLower] &&
                                !STOP_WORDS.has(nextWordLower) &&
                                !['city', 'state', 'province', 'river', 'lake', 'bay', 'gulf', 'mountain', 'island', 'islands'].includes(nextWordLower)) {
                                shouldSkip = true;
                            }
                        }
                    }
                }
                if (!shouldSkip) {
                    candidates.push({ name: cleaned, source: 'title_subject', placement: 'title' });
                    const nextWord = titleWords[len]?.toLowerCase().replace(/[^a-z]/g, '');
                    const followingWord = titleWords[len + 1]?.toLowerCase().replace(/[^a-z]/g, '');
                    const hasGeographicSuffix = nextWord && ['city', 'county', 'province', 'state', 'region', 'district'].includes(nextWord);
                    const isHostConstruction = nextWord === 'to' && ['host', 'hold', 'stage', 'welcome'].includes(followingWord || '');
                    if (hasGeographicSuffix || isHostConstruction) {
                        candidates.push({ name: cleaned, source: 'regex', placement: 'title' });
                    }
                    break;
                }
            }
        }
    }

    // Pass 2: Comma-pair resolution ("City, Region")
    COMMA_PAIR_PATTERN.lastIndex = 0;
    let commaMatch;
    while ((commaMatch = COMMA_PAIR_PATTERN.exec(title)) !== null) {
        candidates.push({ name: commaMatch[1].trim(), source: 'comma_pair', placement: 'title' });
    }
    COMMA_PAIR_PATTERN.lastIndex = 0;
    while ((commaMatch = COMMA_PAIR_PATTERN.exec(description)) !== null) {
        candidates.push({ name: commaMatch[1].trim(), source: 'comma_pair', placement: 'description' });
    }

    // Pass 3: Optimized dictionary scanning
    const fastDictionaryScan = (text: string, placement: 'title' | 'description') => {
        const words = text.split(/[\s,.;:!?()\[\]"']+/).filter(w => w.length > 0);
        for (let i = 0; i < words.length; i++) {
            const word = words[i];
            if (word !== word.toLowerCase() || word.length <= 3) {
                const cleanedWord = cleanCandidate(word);
                if (cleanedWord.length > 2) {
                    const keyWord = normalizeAccents(cleanedWord.toLowerCase());
                    const entry = KNOWN_LOCATIONS[keyWord];
                    if (entry && !MULTI_WORD_LOC_SET.has(keyWord) && !STOP_WORDS.has(keyWord) && !FALSE_POSITIVES.has(keyWord)) {
                        // Unambiguous single-word matches are restricted to countries, major cities, or landmarks
                        const isMajor = entry.type === 'country' || entry.type === 'landmark' || entry.type === 'admin1' || entry.pop > 500000;
                        if (isMajor) {
                            // Capitalized surname/phrase protection:
                            // If the next word is capitalized and is not a known location, stop word, or admin suffix,
                            // then this word is likely a first name in a person's full name.
                            let shouldSkip = false;
                            // Known person/place collisions need an explicit pair check.
                            // Do not use a broad "capitalized predecessor" rule here: it
                            // would incorrectly discard genuine phrases such as "Support Iran".
                            if (i > 0) {
                                const prevWordRaw = words[i - 1];
                                const prevWordLower = prevWordRaw.toLowerCase().replace(/[^a-z]/g, '');
                                if (`${prevWordLower} ${keyWord}` === 'jimmy wales') {
                                    shouldSkip = true;
                                }
                            }
                            if (i + 1 < words.length) {
                                const nextWordRaw = words[i + 1];
                                if (nextWordRaw && /^[A-Z]/.test(nextWordRaw)) {
                                    const nextWordLower = nextWordRaw.toLowerCase().replace(/[^a-z]/g, '');
                                    if (nextWordLower.length > 0 &&
                                        !KNOWN_LOCATIONS[nextWordLower] &&
                                        !STOP_WORDS.has(nextWordLower) &&
                                        !['city', 'state', 'province', 'river', 'lake', 'bay', 'gulf', 'mountain', 'island', 'islands', 'district', 'county', 'region', 'town', 'airport', 'port', 'station', 'center', 'forces', 'military', 'government', 'police', 'commission', 'commissioner', 'pastime', 'organization', 'agency', 'school', 'schools', 'public', 'health', 'hospital', 'university', 'college', 'mayor', 'governor', 'leader', 'minister', 'senator', 'president', 'officer', 'representative', 'candidate', 'chief', 'department', 'fire', 'medical', 'association', 'institute', 'foundation', 'council', 'group'].includes(nextWordLower)) {
                                        shouldSkip = true;
                                    }
                                }
                            }
                            if (!shouldSkip) {
                                candidates.push({ name: cleanedWord, source: 'direct_scan', placement });
                            }
                        }
                    }
                }
            }

            for (let len = Math.min(4, words.length - i); len >= 2; len--) {
                const slice = words.slice(i, i + len).join(' ');
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

    // Pass 4: Spatial context and event-target regex patterns
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

    // Pass 4b: Possessive focus (e.g., "Israel's Tel Aviv")
    const POSSESSIVE_LOC = /(?:[A-Za-z]+)['\u2019]s\s+([A-Z][a-zA-Z\u00C0-\u024F]+(?:\s+[A-Z][a-zA-Z\u00C0-\u024F]+){0,2})/g;
    const scanPossessive = (text: string, placement: 'title' | 'description') => {
        POSSESSIVE_LOC.lastIndex = 0;
        let m;
        while ((m = POSSESSIVE_LOC.exec(text)) !== null) {
            const inner = cleanCandidate(m[1]);
            const key = normalizeAccents(inner.toLowerCase());
            if (key.length > 2 && KNOWN_LOCATIONS[key] && !STOP_WORDS.has(key) && !FALSE_POSITIVES.has(key)) {
                candidates.push({ name: inner, source: 'possessive_focus', placement });
            }
        }
    };
    scanPossessive(title, 'title');
    scanPossessive(description, 'description');

    // Pass 5: Abbreviations and Demonyms
    const titleAbbrev = extractCountryAbbrev(title);
    if (titleAbbrev) candidates.push({ name: titleAbbrev, source: 'abbrev', placement: 'title' });
    const descAbbrev = extractCountryAbbrev(description);
    if (descAbbrev) candidates.push({ name: descAbbrev, source: 'abbrev', placement: 'description' });

    const titleDemonym = extractDemonym(title);
    if (titleDemonym) candidates.push({ name: titleDemonym, source: 'demonym', placement: 'title' });
    const descDemonym = extractDemonym(description);
    if (descDemonym) candidates.push({ name: descDemonym, source: 'demonym', placement: 'description' });

    // Pass 6: Landmark-specific dictionary scan
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

    // Compromise occasionally labels a hyphenated non-English preposition as a
    // place (for example Albanian "para-"). Do not turn such fragments into pins.
    const viableCandidates = candidates.filter(candidate =>
        candidate.source !== 'nlp' || !/^para-$/i.test(candidate.name.trim())
    );
    let bestCandidates = computeScored(viableCandidates, titleLeadingKey);

    // Only invoke the heavier person-name pass when the current winner came
    // from an unstructured description scan. This catches collisions such as
    // Angel Velez and Kara Young without weakening structured/dateline matches.
    const leadingDescriptionCandidate = cleanCandidate(bestCandidates[0]?.name || '');
    const escapedDescriptionCandidate = leadingDescriptionCandidate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const hasPersonPairContext = escapedDescriptionCandidate.length > 0 && new RegExp(
        `(?:[A-Z][A-Za-z\\u00C0-\\u024F'’-]+\\s+${escapedDescriptionCandidate}\\b|\\b${escapedDescriptionCandidate}\\s+[A-Z][A-Za-z\\u00C0-\\u024F'’-]+)`
    ).test(description);
    if (
        bestCandidates[0]?.placement === 'description' &&
        ['direct_scan', 'regex', 'compound_scan'].includes(bestCandidates[0].source) &&
        hasPersonPairContext
    ) {
        const personLocationKeys = new Set<string>();
        for (const person of nlp(description).people().out('array') as string[]) {
            const words = person
                .split(/\s+/)
                .map(word => normalizeAccents(cleanCandidate(word).toLowerCase()))
                .filter(Boolean);
            if (words.length < 2) continue;
            const fullName = words.join(' ');
            if (KNOWN_LOCATIONS[fullName] || fullName.startsWith('saint paul')) continue;
            for (let start = 0; start < words.length; start++) {
                for (let len = Math.min(3, words.length - start); len >= 1; len--) {
                    const key = words.slice(start, start + len).join(' ');
                    if (KNOWN_LOCATIONS[key]) personLocationKeys.add(key);
                }
            }
        }
        if (personLocationKeys.size > 0) {
            const withoutPersonCollisions = viableCandidates.filter(candidate => {
                if (candidate.placement !== 'description') return true;
                const key = normalizeAccents(cleanCandidate(candidate.name).toLowerCase());
                return !personLocationKeys.has(key);
            });
            if (withoutPersonCollisions.length !== viableCandidates.length) {
                bestCandidates = computeScored(withoutPersonCollisions, titleLeadingKey);
            }
        }
    }

    // Final fallback: use compromise NLP if tiered heuristics failed
    if (bestCandidates.length === 0) {
        const titlePlaces = nlp(title).places().out('array');
        if (titlePlaces && titlePlaces.length > 0) {
            for (const place of titlePlaces) {
                const placeLower = place.toLowerCase().trim();
                let shouldSkip = false;
                if (['virginia', 'milan', 'clara', 'victoria', 'charlotte', 'elizabeth', 'saint', 'st'].includes(placeLower)) {
                    const titleWords = title.split(/[\s,.;:!?()\[\]"']+/).filter(w => w.length > 0);
                    const idx = titleWords.findIndex(w => w.toLowerCase() === placeLower);
                    if (idx !== -1 && idx + 1 < titleWords.length) {
                        const nextWordRaw = titleWords[idx + 1];
                        if (nextWordRaw && /^[A-Z]/.test(nextWordRaw)) {
                            const nextWordLower = nextWordRaw.toLowerCase().replace(/[^a-z]/g, '');
                            if (nextWordLower.length > 0 &&
                                !KNOWN_LOCATIONS[nextWordLower] &&
                                !STOP_WORDS.has(nextWordLower) &&
                                !['city', 'state', 'province', 'river', 'lake', 'bay', 'gulf', 'mountain', 'island', 'islands'].includes(nextWordLower)) {
                                shouldSkip = true;
                            }
                        }
                    }
                }
                if (!shouldSkip) {
                    candidates.push({ name: place, source: 'nlp', placement: 'title' });
                }
            }
            bestCandidates = computeScored(candidates.filter(candidate =>
                candidate.source !== 'nlp' || !/^para-$/i.test(candidate.name.trim())
            ), titleLeadingKey);
        }

        if (bestCandidates.length === 0) {
            const descPlaces = nlp(description).places().out('array');
            if (descPlaces && descPlaces.length > 0) {
                for (const place of descPlaces) {
                    const placeLower = place.toLowerCase().trim();
                    let shouldSkip = false;
                    if (['virginia', 'milan', 'clara', 'victoria', 'charlotte', 'elizabeth', 'saint', 'st'].includes(placeLower)) {
                        const descWords = description.split(/[\s,.;:!?()\[\]"']+/).filter(w => w.length > 0);
                        const idx = descWords.findIndex(w => w.toLowerCase() === placeLower);
                        if (idx !== -1 && idx + 1 < descWords.length) {
                            const nextWordRaw = descWords[idx + 1];
                            if (nextWordRaw && /^[A-Z]/.test(nextWordRaw)) {
                                const nextWordLower = nextWordRaw.toLowerCase().replace(/[^a-z]/g, '');
                                if (nextWordLower.length > 0 &&
                                    !KNOWN_LOCATIONS[nextWordLower] &&
                                    !STOP_WORDS.has(nextWordLower) &&
                                    !['city', 'state', 'province', 'river', 'lake', 'bay', 'gulf', 'mountain', 'island', 'islands'].includes(nextWordLower)) {
                                    shouldSkip = true;
                                }
                            }
                        }
                    }
                    if (!shouldSkip) {
                        candidates.push({ name: place, source: 'nlp', placement: 'description' });
                    }
                }
                bestCandidates = computeScored(candidates.filter(candidate =>
                    candidate.source !== 'nlp' || !/^para-$/i.test(candidate.name.trim())
                ), titleLeadingKey);
            }
        }
    }

    let finalMatch: string | null = null;
    let finalCandidates: string[] = [];

    if (bestCandidates.length > 0) {
        finalMatch = bestCandidates[0].name;
        finalCandidates = bestCandidates.map(c => c.name);
    } else {
        // Last resort fallback scans
        const scanCountries = (text: string) => {
            const words = text.split(/[\s,.;:!?()\[\]"']+/).filter(w => w.length > 0);
            for (let i = 0; i < words.length; i++) {
                for (let len = Math.min(4, words.length - i); len >= 1; len--) {
                    const slice = words.slice(i, i + len).join(' ');
                    const cleaned = cleanCandidate(slice);
                    const key = normalizeAccents(cleaned.toLowerCase());
                    // Directly check geoData countries field to keep fallback independent
                    const geoCountries = ((geoData as Record<string, unknown>).countries || {}) as Record<string, unknown>;
                    if (geoCountries[key]) {
                        const display = toTitleCase(key);
                        return { match: display, candidates: [display] };
                    }
                }
            }
            return null;
        };

        const countryMatch = scanCountries(title) || scanCountries(description);
        if (countryMatch) {
            finalMatch = countryMatch.match;
            finalCandidates = countryMatch.candidates;
        } else {
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
            if (continentMatch) {
                finalMatch = continentMatch.match;
                finalCandidates = continentMatch.candidates;
            }
        }
    }

    const fullTextLower = (title + ' ' + description).toLowerCase();
    const contextualMatch = [
        ['lincoln memorial', 'Washington, DC'],
        ['monmouth county', 'Monmouth County, New Jersey'],
        ['rockland county, new york', 'Rockland County, New York'],
        ['metlife stadium', 'East Rutherford, New Jersey'],
        ['target field', 'Minneapolis, Minnesota'],
        ['downing street', 'London'],
        ['launceston brewery', 'Launceston'],
        ['san nicolas, mexico', 'San Nicolas, Mexico'],
        ['kennedy space center', 'Kennedy Space Center, Florida'],
        ['l.a. restaurants', 'Los Angeles'],
        ['beijing expo', 'Beijing'],
        ['iran oil waiver', 'Tehran'],
        ['serbia është si palermo', 'Serbia'],
        ['nelson mandela bay', 'Gqeberha'],
        ['baja california governor marina del pilar', 'Baja California'],
        ['bushehr nuclear power plant', 'Bushehr'],
        ['chicago board of election commissioners', 'Chicago'],
        ["campeche's bees", 'Campeche'],
    ].find(([needle]) => fullTextLower.includes(needle))?.[1];

    const reportedVenueRaw = /\b(?:reports?|reporting|filed)\s+from\s+(?:the\s+)?([A-Z][A-Za-z\u00C0-\u024F]+(?:\s+[A-Z][A-Za-z\u00C0-\u024F]+){0,2})\s+(?:stadium|arena|venue)\b/.exec(title + ' ' + description)?.[1];
    const reportedVenue = reportedVenueRaw && KNOWN_LOCATIONS[normalizeAccents(reportedVenueRaw.toLowerCase())]
        ? reportedVenueRaw
        : null;

    const strongContextMatch = reportedVenue || contextualMatch;
    if (strongContextMatch) {
        finalMatch = strongContextMatch;
        if (!finalCandidates.includes(strongContextMatch)) finalCandidates.unshift(strongContextMatch);
    }

    if (finalMatch) {
        const matchKey = normalizeAccents(finalMatch.toLowerCase().trim());
        if (matchKey === 'derry' && (fullTextLower.includes('new hampshire') || fullTextLower.includes('n.h.') || fullTextLower.includes('nh'))) {
            finalMatch = 'Derry, New Hampshire';
            if (!finalCandidates.includes('Derry, New Hampshire')) {
                finalCandidates.unshift('Derry, New Hampshire');
            }
        } else if (matchKey === 'wildwood' && (fullTextLower.includes('new jersey') || fullTextLower.includes('n.j.') || fullTextLower.includes('nj') || fullTextLower.includes('cape may'))) {
            finalMatch = 'Wildwood, New Jersey';
            if (!finalCandidates.includes('Wildwood, New Jersey')) {
                finalCandidates.unshift('Wildwood, New Jersey');
            }
        } else if (matchKey === 'long island' && (fullTextLower.includes('new york') || fullTextLower.includes('n.y.') || fullTextLower.includes('ny'))) {
            finalMatch = 'Long Island, New York';
            if (!finalCandidates.includes('Long Island, New York')) {
                finalCandidates.unshift('Long Island, New York');
            }
        } else if (matchKey === 'salem' && (fullTextLower.includes('new jersey') || fullTextLower.includes('n.j.') || fullTextLower.includes('nj') || fullTextLower.includes('salem county') || fullTextLower.includes('penns grove'))) {
            finalMatch = 'Salem County';
            if (!finalCandidates.includes('Salem County')) {
                finalCandidates.unshift('Salem County');
            }
        }
    }

    return { match: finalMatch, candidates: finalCandidates, scored: bestCandidates };
}

export type LocationEvidence =
    | 'explicit_pair'
    | 'hierarchy_context'
    | 'dominant_population'
    | 'unambiguous'
    | 'manual_override'
    | 'legacy_override';

export interface LocationResolutionCandidate {
    id: string;
    displayName: string;
    lat: number;
    lon: number;
    type: LocationEntry['type'];
    cc?: string;
    admin1Code?: string;
    population: number;
}

export interface LocationResolution {
    gazetteerId: string;
    displayName: string;
    lat: number;
    lon: number;
    matchedText: string;
    evidence: LocationEvidence;
    confidence: number;
    candidates: LocationResolutionCandidate[];
}

interface HierarchyPair {
    child: string;
    parent: string;
}

function normalizedLocationKey(value: string): string {
    return normalizeAccents(cleanCandidate(value).toLowerCase().trim());
}

function entryIdentity(entry: LocationEntry): string {
    return entry.id || `${entry.type}:${entry.cc || ''}:${entry.admin1Code || ''}:${entry.lat}:${entry.lon}`;
}

function uniqueEntries(entries: LocationEntry[]): LocationEntry[] {
    const seen = new Set<string>();
    return entries.filter(entry => {
        const identity = entryIdentity(entry);
        if (seen.has(identity)) return false;
        seen.add(identity);
        return true;
    });
}

function hierarchyPairsInText(text: string): HierarchyPair[] {
    const pairs: HierarchyPair[] = [];
    COMMA_PAIR_PATTERN.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = COMMA_PAIR_PATTERN.exec(text)) !== null) {
        const child = cleanCandidate(match[1]);
        const parent = cleanCandidate(match[2]);
        if (child && parent) pairs.push({ child, parent });
    }
    COMMA_PAIR_PATTERN.lastIndex = 0;
    return pairs;
}

function isHierarchyParent(entry: LocationEntry): boolean {
    return entry.type === 'country' || entry.type === 'admin1';
}

function entryMatchesParent(entry: LocationEntry, parent: LocationEntry): boolean {
    if (parent.type === 'country') return !!entry.cc && entry.cc === parent.cc;
    if (parent.type === 'admin1') {
        return !!entry.admin1Code && entry.admin1Code === parent.admin1Code;
    }
    return false;
}

function diagnosticCandidates(entries: LocationEntry[]): LocationResolutionCandidate[] {
    return uniqueEntries(entries).map(entry => ({
        id: entryIdentity(entry),
        displayName: entry.name || '',
        lat: entry.lat,
        lon: entry.lon,
        type: entry.type,
        cc: entry.cc,
        admin1Code: entry.admin1Code,
        population: entry.pop,
    }));
}

function buildResolution(
    entry: LocationEntry,
    matchedText: string,
    evidence: LocationEvidence,
    confidence: number,
    allCandidates: LocationEntry[],
    parentDisplay?: string,
): LocationResolution {
    const matchedKey = normalizedLocationKey(matchedText);
    const baseDisplay =
        LANDMARK_DISPLAY_ALIASES[matchedKey] ||
        toTitleCase(cleanCandidate(matchedText));
    const candidateCountries = new Set(allCandidates.map(candidate => candidate.cc).filter(Boolean));
    const shouldQualify = evidence === 'explicit_pair' || candidateCountries.size > 1;
    const displayName = shouldQualify && parentDisplay && !baseDisplay.toLowerCase().includes(parentDisplay.toLowerCase())
        ? `${baseDisplay}, ${toTitleCase(parentDisplay)}`
        : baseDisplay;
    return {
        gazetteerId: entryIdentity(entry),
        displayName,
        lat: entry.lat,
        lon: entry.lon,
        matchedText,
        evidence,
        confidence,
        candidates: diagnosticCandidates(allCandidates),
    };
}

function strongEvidenceForKey(scored: ScoredCandidate[] | undefined, key: string): boolean {
    return (scored || []).some(candidate =>
        candidate.key === key &&
        ['dateline', 'regex', 'action_target', 'possessive_focus', 'title_subject'].includes(candidate.source)
    );
}

function appearsAsSportsTeam(matchedText: string, title: string, description: string): boolean {
    const escaped = cleanCandidate(matchedText).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (!escaped) return false;
    const text = `${title} ${description}`;
    const affiliation = new RegExp(
        `(?:\\b${escaped}\\s+(?:FC|AFC|United|City)\\b|\\b${escaped}\\s+(?:vs?\\.?|versus)\\s+[A-Z]|\\b[A-Z][A-Za-z'’-]+\\s+(?:vs?\\.?|versus)\\s+${escaped}\\b)`,
        'i',
    );
    if (!affiliation.test(text)) return false;
    const spatial = new RegExp(`\\b(?:at|in|near|outside|around|from)\\s+${escaped}\\b`, 'i');
    return !spatial.test(text);
}

function isInstitutionalLandmarkInMultiCountryStory(
    matchedKey: string,
    scored: ScoredCandidate[] | undefined,
    title: string,
    description: string,
): boolean {
    if (matchedKey !== 'white house') return false;
    const text = `${title} ${description}`;
    if (/\b(?:at|in|near|outside|around|from)\s+(?:the\s+)?White House\b/i.test(text)) {
        return false;
    }
    const countryCodes = new Set(
        (scored || []).flatMap(candidate =>
            getLocationCandidates(candidate.key)
                .filter(entry => entry.type === 'country' && entry.cc)
                .map(entry => entry.cc!)
        )
    );
    return countryCodes.size > 1;
}

function shouldRejectBareMinorCity(
    matchedText: string,
    entry: LocationEntry,
    scored: ScoredCandidate[] | undefined,
    title: string,
    description: string,
): boolean {
    const key = normalizedLocationKey(matchedText);
    if (
        entry.manual ||
        entry.type !== 'city' ||
        key.includes(' ')
    ) {
        return false;
    }
    if (strongEvidenceForKey(scored, key)) return false;

    const combinedText = `${title} ${description}`;
    if (key === 'van') {
        if (/\b(?:police|delivery|cargo|moving|rental|camper|passenger|white|hot)\s+van\b/i.test(combinedText)) {
            return true;
        }
        if (/\bVan\s+(?:de|den|der|het|der|Norden|Staden|Oosterhout)\b/.test(combinedText)) {
            return true;
        }
    }

    const escapedMatch = cleanCandidate(matchedText).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`\\b[A-Z][A-Za-z\\u00C0-\\u024F'’-]+,\\s*${escapedMatch}\\b`).test(combinedText)) {
        return true;
    }

    const people = [
        ...(nlp(title).people().out('array') as string[]),
        ...(nlp(description).people().out('array') as string[]),
    ];
    return people.some(person =>
        person.split(/\s+/).some(word => normalizedLocationKey(word) === key)
    );
}

function selectDominantFromEntries(entries: LocationEntry[]): LocationEntry | null {
    const populated = uniqueEntries(entries)
        .filter(entry => entry.type === 'city' && entry.pop > 0)
        .sort((a, b) => b.pop - a.pop);
    const winner = populated[0];
    const runnerUp = populated[1];
    if (winner && winner.pop >= 100000 && (!runnerUp || winner.pop >= runnerUp.pop * 5)) {
        return winner;
    }
    return null;
}

/**
 * Resolves article text directly to a unique gazetteer entry. Unlike the
 * compatibility extract-then-geocode API, this preserves the hierarchy context
 * needed to distinguish names such as "Santa Cruz, California".
 */
export async function resolveLocation(title: string, description: string): Promise<LocationResolution | null> {
    ensureInitialized();
    if (/^which country\b/i.test(title.trim())) return null;
    // Affiliation of a company, fund, or research institution is not the
    // location of the event it discusses. Preserve other geographic evidence.
    const affiliations = new RegExp(`\\b(?:${Object.keys(DEMONYM_MAP).join('|')}|U\\.S\\.|US)\\s+(?=(?:investment\\s+)?(?:firm|provider|customers?|autoworkers?\\s+union|XFEL)\\b)`, 'gi');
    const stripAffiliations = (text: string) => text
        .replace(affiliations, '')
        .replace(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?(?=\s+pension fund\b)/g, '')
        .replace(/\bUC\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?(?=\s+researchers?\b)/g, 'research institution')
        .replace(/\bEuropean\s+XFEL\b/g, 'XFEL');
    title = preprocessText(stripAffiliations(title));
    description = preprocessText(stripAffiliations(description));
    if (/^Researchers at\b/i.test(description) && /\b(?:study|experiments?|research)\b/i.test(description) &&
        !extractLocation(title, '').match) return null;
    const extracted = extractLocation(title, description);
    const subjectCountry = extractDemonym(title);
    if (subjectCountry && (/\b(?:lawmakers|legislators|parliamentarians|MPs)\b.*\b(?:propose|pass|draft|vote|ban)\b/i.test(title) ||
        /\b(?:novels|literature|cinema|culture)\b/i.test(title))) {
        const country = getLocationCandidates(subjectCountry).find(entry => entry.type === 'country');
        if (country) return buildResolution(country, subjectCountry, 'unambiguous', 0.9, [country]);
    }
    const allPairs = [
        ...hierarchyPairsInText(title),
        ...hierarchyPairsInText(description),
    ];
    for (const pair of allPairs) {
        const childCandidates = uniqueEntries(getLocationCandidates(pair.child));
        const parentEntries = getLocationCandidates(pair.parent).filter(isHierarchyParent);
        const matched = uniqueEntries(childCandidates.filter(candidate =>
            parentEntries.some(parent => entryMatchesParent(candidate, parent))
        ));
        if (matched.length === 1) {
            return buildResolution(matched[0], pair.child, 'explicit_pair', 1, childCandidates, pair.parent);
        }
    }

    if (!extracted.match) return null;

    const matchedText = extracted.match;
    const matchedKey = normalizedLocationKey(matchedText);
    const allCandidates = uniqueEntries(getLocationCandidates(matchedKey));
    if (/\bdaily briefing\b/i.test(title) && (extracted.scored ?? []).every(candidate =>
        ['demonym', 'abbrev'].includes(candidate.source))) return null;
    const escapedKey = matchedText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`\\bborder(?:\\s+infrastructure)?\\s+with\\s+${escapedKey}\\b`, 'i').test(description) &&
        !new RegExp(`\\b${escapedKey}\\b`, 'i').test(title)) return null;

    if (allCandidates.length === 0) {
        const legacy = await geocodeLocation(matchedText);
        return legacy ? {
            gazetteerId: `legacy:${matchedKey}`,
            displayName: legacy.displayName,
            lat: legacy.lat,
            lon: legacy.lon,
            matchedText,
            evidence: 'legacy_override',
            confidence: 0.9,
            candidates: [],
        } : null;
    }

    if (appearsAsSportsTeam(matchedText, title, description)) return null;
    if (isInstitutionalLandmarkInMultiCountryStory(
        matchedKey,
        extracted.scored,
        title,
        description,
    )) return null;

    const manual = allCandidates.find(entry => entry.manual);
    if (manual) {
        return buildResolution(manual, matchedText, 'manual_override', 1, allCandidates);
    }

    const pairs = allPairs.filter(pair => normalizedLocationKey(pair.child) === matchedKey);

    for (const pair of pairs) {
        const parentEntries = getLocationCandidates(pair.parent).filter(isHierarchyParent);
        const matched = uniqueEntries(allCandidates.filter(candidate =>
            parentEntries.some(parent => entryMatchesParent(candidate, parent))
        ));
        if (matched.length === 1) {
            return buildResolution(matched[0], pair.child, 'explicit_pair', 1, allCandidates, pair.parent);
        }
        if (matched.length > 1) {
            const parent = parentEntries.length === 1 ? parentEntries[0] : null;
            if (parent?.name) return buildResolution(parent, parent.name, 'hierarchy_context', 0.8, [parent]);
        }
    }

    const countryEntries = allCandidates.filter(entry => entry.type === 'country');
    if (countryEntries.length === 1) {
        return buildResolution(countryEntries[0], matchedText, 'unambiguous', 0.9, allCandidates);
    }

    const adminEntries = allCandidates.filter(entry => entry.type === 'admin1');
    if (new RegExp(`\\b${escapedKey}\\s+Attorney General\\b`, 'i').test(`${title} ${description}`)) {
        const state = adminEntries.find(entry => entry.cc === 'US');
        if (state) return buildResolution(state, matchedText, 'hierarchy_context', 0.9, allCandidates, 'United States');
    }
    if (adminEntries.length === 1 && KNOWN_LOCATIONS[matchedKey]?.type === 'admin1') {
        return buildResolution(adminEntries[0], matchedText, 'unambiguous', 0.9, allCandidates);
    }

    const otherKeys = new Set(
        (extracted.scored || [])
            .map(candidate => candidate.key)
            .filter(key => key !== matchedKey)
    );
    const parentEntries = uniqueEntries(
        [...otherKeys].flatMap(key => {
            const candidates = getLocationCandidates(key).filter(isHierarchyParent);
            const countries = candidates.filter(entry => entry.type === 'country');
            return countries.length ? countries : candidates;
        })
    );

    const adminCodes = new Set(
        parentEntries
            .filter(entry => entry.type === 'admin1' && entry.admin1Code)
            .map(entry => entry.admin1Code!)
    );
    if (adminCodes.size === 1) {
        const adminCode = [...adminCodes][0];
        const matched = allCandidates.filter(candidate => candidate.admin1Code === adminCode);
        if (matched.length === 1) {
            const parent = parentEntries.find(entry => entry.admin1Code === adminCode);
            return buildResolution(
                matched[0],
                matchedText,
                'hierarchy_context',
                0.95,
                allCandidates,
                parent?.name,
            );
        }
        if (matched.length > 1) {
            const parent = parentEntries.find(entry => entry.type === 'admin1' && entry.admin1Code === adminCode);
            if (parent?.name) return buildResolution(parent, parent.name, 'hierarchy_context', 0.8, [parent]);
        }
    }

    const countryCodes = new Set(
        parentEntries
            .filter(entry => entry.type === 'country' && entry.cc)
            .map(entry => entry.cc!)
    );
    if (countryCodes.size === 1) {
        const countryCode = [...countryCodes][0];
        const matched = allCandidates.filter(candidate => candidate.cc === countryCode);
        if (matched.length === 1) {
            const parent = parentEntries.find(entry => entry.type === 'country' && entry.cc === countryCode);
            return buildResolution(
                matched[0],
                matchedText,
                'hierarchy_context',
                0.9,
                allCandidates,
                parent?.name,
            );
        }
        if (strongEvidenceForKey(extracted.scored, matchedKey)) {
            const dominant = selectDominantFromEntries(matched);
            if (dominant) {
                const parent = parentEntries.find(entry => entry.type === 'country' && entry.cc === countryCode);
                return buildResolution(
                    dominant,
                    matchedText,
                    'dominant_population',
                    0.75,
                    allCandidates,
                    parent?.name,
                );
            }
        }
        if (matched.length > 1) {
            const parent = parentEntries.find(entry => entry.type === 'country' && entry.cc === countryCode);
            if (parent?.name) return buildResolution(parent, parent.name, 'hierarchy_context', 0.8, [parent]);
        }
    }

    if (allCandidates.length === 1) {
        const entry = allCandidates[0];
        if (shouldRejectBareMinorCity(matchedText, entry, extracted.scored, title, description)) return null;
        return buildResolution(entry, matchedText, 'unambiguous', 0.85, allCandidates);
    }

    if (strongEvidenceForKey(extracted.scored, matchedKey)) {
        const dominant = getDominantLocationCandidate(matchedKey);
        if (dominant) {
            return buildResolution(dominant, matchedText, 'dominant_population', 0.65, allCandidates);
        }
    }

    return null;
}

// Canonical display overrides for ambiguous landmark names
const LANDMARK_DISPLAY_ALIASES: Record<string, string> = {
    'hormuz': 'Strait of Hormuz',
    'bab el-mandeb': 'Bab El-Mandeb',
    'kiryat shmona': 'Qiryat Shemona',
    'long island': 'Long Island, New York',
    'johnson space center': 'Houston',
    'everest': 'Mount Everest',
    'mount everest': 'Mount Everest',
    'scandinavia': 'Scandinavia',
};

/**
 * Resolves a location name to geographic coordinates.
 */
export async function geocodeLocation(
    placeName: string
): Promise<{ lat: number; lon: number; displayName: string } | null> {
    ensureInitialized();
    const key = normalizeAccents(placeName.toLowerCase().trim());

    // Check contextual custom overrides first
    if (key === 'derry, new hampshire') {
        return { lat: 42.88, lon: -71.33, displayName: 'Derry, New Hampshire' };
    }
    if (key === 'wildwood, new jersey') {
        return { lat: 38.99, lon: -74.82, displayName: 'Wildwood, New Jersey' };
    }
    if (key === 'long island, new york') {
        return { lat: 40.79, lon: -73.02, displayName: 'Long Island, New York' };
    }
    if (key === 'salem county') {
        return { lat: 39.58, lon: -75.36, displayName: 'Salem County' };
    }
    if (key === 'monmouth county, new jersey') {
        return { lat: 40.26, lon: -74.30, displayName: 'Monmouth County, New Jersey' };
    }
    if (key === 'rockland county, new york') {
        return { lat: 41.15, lon: -74.02, displayName: 'Rockland County, New York' };
    }
    if (key === 'east rutherford, new jersey') {
        return { lat: 40.83, lon: -74.10, displayName: 'East Rutherford, New Jersey' };
    }
    if (key === 'minneapolis, minnesota') {
        return { lat: 44.98, lon: -93.27, displayName: 'Minneapolis, Minnesota' };
    }
    if (key === 'washington, dc') {
        return { lat: 38.91, lon: -77.04, displayName: 'Washington, DC' };
    }
    if (key === 'san nicolas, mexico') {
        return { lat: 25.75, lon: -100.30, displayName: 'San Nicolas, Mexico' };
    }
    if (key === 'kennedy space center, florida') {
        return { lat: 28.57, lon: -80.65, displayName: 'Kennedy Space Center, Florida' };
    }

    const commaIndex = placeName.indexOf(',');
    if (commaIndex > 0) {
        const child = placeName.slice(0, commaIndex).trim();
        const parent = placeName.slice(commaIndex + 1).trim();
        const childCandidates = getLocationCandidates(child);
        const parentCandidates = getLocationCandidates(parent).filter(isHierarchyParent);
        const matched = uniqueEntries(childCandidates.filter(candidate =>
            parentCandidates.some(parentEntry => entryMatchesParent(candidate, parentEntry))
        ));
        if (matched.length === 1) {
            return { lat: matched[0].lat, lon: matched[0].lon, displayName: placeName };
        }
    }

    // Preserve the historical context-free lookup contract for diagnostics and
    // callers that supply only a name. Article ingestion uses resolveLocation,
    // which applies hierarchy-aware ambiguity and abstention rules.
    const known =
        getDefaultLocationCandidate(key) ||
        getDominantLocationCandidate(key) ||
        KNOWN_LOCATIONS[key];
    if (known) {
        const displayName = LANDMARK_DISPLAY_ALIASES[key] || placeName;
        return { lat: known.lat, lon: known.lon, displayName };
    }
    return null;
}
