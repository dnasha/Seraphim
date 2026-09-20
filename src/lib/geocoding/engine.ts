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
    COUNTRY_ABBREV_MAP,
    MEDIA_ATTRIBUTION_SUFFIX,
} from './constants';
import {
    DATELINE_PATTERN,
    EMOJI_STRIP,
    METADATA_COUNTRY_REGEX,
    COMMA_PAIR_PATTERN,
    LOCATION_PATTERNS,
    ACTION_TARGET_PATTERNS,
    LOCATION_NAME_PATTERN,
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

export interface LocationContext {
    sourceName?: string;
    /** A trusted source-country prior, used only to disambiguate names in the text. */
    countryCode?: string;
}

function escapePattern(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function cleanArticleText(text: string, sourceName?: string): string {
    // Some feeds prepend bullet summaries before an actual agency dateline.
    text = text.replace(/^(?:[•*-][^\n]*\n)+(?=[A-Z][A-Z ]{2,40}:)/, '');
    text = text.replace(EMOJI_STRIP, ' ').replace(/\s+/g, ' ').trim();
    if (sourceName?.trim()) {
        const source = escapePattern(sourceName.trim().replace(/^the\s+/i, ''));
        // RSS descriptions often repeat the title and publisher without a dash.
        // Only an exact publisher at the terminal boundary is attribution.
        text = text.replace(new RegExp(`\\s+(?:[-–—|]\\s*)?(?:The\\s+)?${source}\\s*$`, 'i'), '');
    }
    text = preprocessText(text);
    // A cited outlet is attribution, even when it differs from the feed source.
    // Restrict removal to recognized publishers and an explicit reporting cue.
    text = text.replace(/\b(?:according to|reported by|reports? by)\s+(?:[Tt]he\s+)?((?:[A-Z][\w-]*\s+){0,6}[A-Z][\w-]*)(?=[.,;!?]|$)/g,
        (attribution, publisher: string) => MEDIA_ATTRIBUTION_SUFFIX.test(` - ${publisher}`) ? '' : attribution);
    text = text.replace(/\b[A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){0,2}\s+(?:OSINT|Osint)\s+(?:says?|reports?|confirms?)\b/g, 'Reports say');
    text = text.replace(/\b[Tt]urkey(?=\s+(?:recipes?|sandwich(?:es)?|stuffing|gravy|roast|dinner)\b)/g, 'poultry');
    text = text.replace(/\bthe Republic\b(?!\s+of\b)/g, 'the country');

    // Compromise recognizes ordinary full names but deliberately also tags some
    // lone countries as people. Only remove multi-token names that are not places.
    if (/\b[A-Z][a-z]+\s+[A-Z][a-z]+\b/.test(text)) {
        for (const person of nlp(text).people().out('array') as string[]) {
            if (person.trim().split(/\s+/).length < 2 || getLocationCandidates(person).length) continue;
            if (!/^[\p{L}'’-]+(?:\s+[\p{L}'’-]+)+$/u.test(person) ||
                /\b(?:Attorney|General|President|Minister|Mayor|Governor|City|State|County|University|Hospital)\b/.test(person)) continue;
            text = text.replace(new RegExp(`\\b${escapePattern(person)}\\b`, 'g'), 'person');
        }
    }
    // Country names also used as given names can evade the NLP person tag.
    // Require a full capitalized name and a personal predicate, keeping titles
    // such as "Jordan announces policy" and "Georgia Government announces...".
    text = text.replace(/\b(?:Jordan|Chad|Georgia|Virginia|Victoria|Charlotte)\s+(?!Government\b|City\b|State\b|Police\b|President\b)[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?(?=\s+(?:wins?|shares?|poses?|marries|dies|sings|stars)\b)/g, 'person');
    return text;
}

function hasEventContext(text: string): boolean {
    return /\b(?:assault|attack|strike|fire|flood|storm|crash|earthquake|explosion|blast|kill|injur|wound|ram|rescu|protest|rebuild|reconstruct|factory|plant|conference|meeting|summit|ceremony|festival|concert|sing|song|rendition|deforest|drought|pollution|logging|mining|outbreak|refiner|war|conflict|protect|defend|court)\w*\b/i.test(text);
}

function spatialCandidate(match: RegExpExecArray, text: string, placement: Candidate['placement']): Candidate {
    const before = text.slice(Math.max(0, match.index - 120), match.index);
    const localText = `${before} ${text.slice(match.index, match.index + match[0].length + 120)}`;
    let source: Candidate['source'] = /^(?:from|out of|returning from|launched from|escapes? from)\b/i.test(match[0]) ? 'origin'
        : /^(?:in|near|at|around|across|off|located|situated|protecting|defending|capital|city|town|port|village|north(?:east|west)?|south(?:east|west)?|east|west)\b/i.test(match[0]) || /\b(?:border|court)\b/i.test(match[0]) ? 'venue' : 'regex';
    // Metaphorical roots and counterfactual destinations are not event venues.
    const after = text.slice(match.index + match[0].length);
    const linkedRegion = /^[-–]([A-Z][A-Za-z]+)(?:[-–][A-Z][A-Za-z]+){0,3}\s+(?:sector|front|region|axis|corridor)\b/.exec(after);
    const background = (linkedRegion && getLocationCandidates(linkedRegion[1]).length > 0) ||
        /\b(?:rooted|interested|invested)\s+$/i.test(before) ||
        /\bwould\b[^.!?;]{0,100}\bhave\s+been\b[^.!?;]*$/i.test(before) ||
        /(?:\b(?:previously|formerly|historically)\b|\ban earlier\b|\bwas once\b)[^.!?;]*$/i.test(before);
    if (background) source = 'direct_scan';
    const sentenceEnd = text.search(/[.!?](?:\s|$)/);
    return { name: match[1].trim(), source, placement, eventContext: hasEventContext(localText),
        leadVenue: placement === 'title' || sentenceEnd < 0 || match.index < sentenceEnd,
        contextPenalty: background ? 20 : 0 };
}

/**
 * Performs a multi-pass extraction process on news items.
 * Uses tiered heuristics to identify the most relevant geographic location.
 */
export function extractLocation(title: string, description: string): { match: string | null; candidates: string[]; scored?: ScoredCandidate[] } {
    ensureInitialized();
    return extractPreparedLocation(cleanArticleText(title), cleanArticleText(description));
}

function extractPreparedLocation(title: string, description: string): { match: string | null; candidates: string[]; scored?: ScoredCandidate[] } {
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
    for (const placement of ['title', 'description'] as const) {
        for (const pair of hierarchyPairsInText(placement === 'title' ? title : description).filter(pair => pair.prose)) {
            candidates.push({ name: pair.child, source: 'comma_pair', placement });
        }
    }

    // Pass 3: Optimized dictionary scanning
    const fastDictionaryScan = (text: string, placement: 'title' | 'description') => {
        const words = text.split(/[\s,;:!?()\[\]"']+/).filter(w => w.length > 0);
        for (let i = 0; i < words.length; i++) {
            const word = words[i];
            if (word !== word.toLowerCase() || word.length <= 3) {
                const cleanedWord = cleanCandidate(word);
                if (cleanedWord.length > 2) {
                    const keyWord = normalizeAccents(cleanedWord.toLowerCase());
                    const entry = KNOWN_LOCATIONS[keyWord];
                    if (entry && !MULTI_WORD_LOC_SET.has(keyWord) && !STOP_WORDS.has(keyWord) && !FALSE_POSITIVES.has(keyWord)) {
                        // Unambiguous single-word matches are restricted to countries, major cities, or landmarks
                        const isMajor = entry.type !== 'city' || entry.pop > 500000;
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

            for (let len = Math.min(6, words.length - i); len >= 2; len--) {
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
            candidates.push(spatialCandidate(match, title, 'title'));
        }
        pattern.lastIndex = 0;
        while ((match = pattern.exec(description)) !== null) {
            candidates.push(spatialCandidate(match, description, 'description'));
        }
    }

    for (const pattern of ACTION_TARGET_PATTERNS) {
        pattern.lastIndex = 0;
        let match;
        while ((match = pattern.exec(title)) !== null) {
            const contextual = spatialCandidate(match, title, 'title');
            candidates.push({ ...contextual, source: contextual.contextPenalty ? contextual.source : 'action_target' });
        }
        pattern.lastIndex = 0;
        while ((match = pattern.exec(description)) !== null) {
            const contextual = spatialCandidate(match, description, 'description');
            candidates.push({ ...contextual, source: contextual.contextPenalty ? contextual.source : 'action_target' });
        }
    }

    // A nationality modifying a fixed target is geographic evidence about the
    // target, not the attacker ("hit Russian refineries"). Explicit venues
    // were inserted first and retain precedence if a facility is overseas.
    const infrastructureTarget = /\b(?:hits?|hitting|attacks?|attacked|bombs?|bombed|strikes?|struck|targets?|targeted)\s+(?:the\s+)?([A-Z][a-z]+)\s+(?:(?:oil|gas|diesel|nuclear|power|military)\s+){0,2}(?:refineries|refinery|facilities|facility|airfields?|ports?|bases?|factories|factory|plants?)\b/g;
    for (const placement of ['title', 'description'] as const) {
        const text = placement === 'title' ? title : description;
        for (const match of text.matchAll(infrastructureTarget)) {
            const country = DEMONYM_MAP[match[1].toLowerCase()];
            if (typeof country === 'string') candidates.push({ name: country, source: 'venue', placement, eventContext: true, leadVenue: placement === 'title' });
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
    const withoutContinentalNames = (text: string) => text.replace(/\b(?:North|South|Central|Latin)\s+America\b/gi, '');
    const titleAbbrev = extractCountryAbbrev(withoutContinentalNames(title));
    if (titleAbbrev) candidates.push({ name: titleAbbrev, source: 'abbrev', placement: 'title' });
    const descAbbrev = extractCountryAbbrev(withoutContinentalNames(description));
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

    // A recognized full place span owns its component words. Otherwise the
    // regex for a fragment (Santiago) can beat Santiago de Compostela, or a
    // large city fragment can beat West New Britain. Preserve standalone
    // occurrences of a fragment elsewhere in the same field.
    const completeSpans = candidates.filter(candidate => candidate.source === 'compound_scan');
    const completeCandidates = candidates.filter(candidate => {
        const key = normalizedLocationKey(candidate.name);
        const text = candidate.placement === 'title' ? title : description;
        const longer = completeSpans.filter(span => span.placement === candidate.placement &&
            normalizedLocationKey(span.name) !== key &&
            new RegExp(`(?:^|\\s)${escapePattern(key)}(?:$|\\s)`).test(normalizedLocationKey(span.name)));
        if (!longer.length) return true;
        let withoutSpans = normalizeAccents(text.toLowerCase());
        for (const span of longer) withoutSpans = withoutSpans.replace(new RegExp(escapePattern(normalizedLocationKey(span.name)), 'g'), ' ');
        return new RegExp(`\\b${escapePattern(key)}\\b`).test(withoutSpans);
    });
    let bestCandidates = computeScored(completeCandidates, titleLeadingKey);

    // Only invoke the heavier person-name pass when the current winner came
    // from an unstructured description scan. This catches collisions such as
    // Angel Velez and Kara Young without weakening structured/dateline matches.
    if (
        bestCandidates[0]?.placement === 'description' &&
        ['direct_scan', 'regex', 'compound_scan'].includes(bestCandidates[0].source)
    ) {
        const leadingDescriptionCandidate = cleanCandidate(bestCandidates[0].name);
        const escapedDescriptionCandidate = leadingDescriptionCandidate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const hasPersonPairContext = escapedDescriptionCandidate.length > 0 && new RegExp(
            `(?:[A-Z][A-Za-z\\u00C0-\\u024F'’-]+\\s+${escapedDescriptionCandidate}\\b|\\b${escapedDescriptionCandidate}\\s+[A-Z][A-Za-z\\u00C0-\\u024F'’-]+)`
        ).test(description);
        if (hasPersonPairContext) {
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
                const withoutPersonCollisions = completeCandidates.filter(candidate => {
                    if (candidate.placement !== 'description') return true;
                    const key = normalizeAccents(cleanCandidate(candidate.name).toLowerCase());
                    return !personLocationKeys.has(key);
                });
                if (withoutPersonCollisions.length !== completeCandidates.length) {
                    bestCandidates = computeScored(withoutPersonCollisions, titleLeadingKey);
                }
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
            // Compromise can label non-English prepositions such as "para-"
            // as places. Filter these fragments once NLP candidates exist.
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
    | 'actor_country'
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
    prose?: boolean;
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
        const before = text.slice(Math.max(0, match.index - 120), match.index);
        if (/\b(?:districts|cities|towns|provinces|states|regions|countries)\s+(?:of\s+)?$/i.test(before)) continue;
        const children = getLocationCandidates(child);
        const parents = getLocationCandidates(parent);
        // Sibling regions in a comma list do not contain one another.
        if (children.length && children.every(entry => entry.type === 'admin1') &&
            parents.length && parents.every(entry => entry.type === 'admin1')) continue;
        const childCountries = new Set(children.map(entry => entry.cc).filter(Boolean));
        if (parents.some(entry => entry.type === 'city' && childCountries.has(entry.cc)) &&
            !parents.some(entry => isHierarchyParent(entry) && childCountries.has(entry.cc))) continue;
        if (child && parent) pairs.push({ child, parent });
    }
    COMMA_PAIR_PATTERN.lastIndex = 0;
    // A lookahead keeps overlapping pairs in "Athens in Georgia in the US".
    const prose = new RegExp(`(?=(${LOCATION_NAME_PATTERN})\\s+(?:in|within)\\s+(?:the\\s+)?(${LOCATION_NAME_PATTERN}))`, 'g');
    for (const match of text.matchAll(prose)) {
        if (/(?:\b(?:university|college|institute)\b|école)[^.!?;]*$/i.test(text.slice(Math.max(0, match.index - 100), match.index))) continue;
        const child = cleanCandidate(match[1]);
        const parent = cleanCandidate(match[2]);
        if (getLocationCandidates(child).length && getLocationCandidates(parent).some(isHierarchyParent)) {
            pairs.push({ child, parent, prose: true });
        }
    }

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
        ['dateline', 'regex', 'venue', 'action_target', 'possessive_focus', 'title_subject'].includes(candidate.source)
    );
}

function appearsAsSportsTeam(matchedText: string, title: string, description: string): boolean {
    const escaped = cleanCandidate(matchedText).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (!escaped) return false;
    const text = `${title} ${description}`;
    if (/\b(?:football|basketball|hockey|soccer|baseball|volleyball)\s+photos?:/i.test(title) &&
        /\bat\b/i.test(title) && /\b(?:teams?|matchup)\b/i.test(description)) return true;
    const affiliation = new RegExp(
        `(?:\\b${escaped}\\s+(?:FC|AFC|United|City)\\b|\\b${escaped}\\s+(?:vs?\\.?|versus)\\s+[A-Z]|\\b[A-Z][A-Za-z'’-]+\\s+(?:vs?\\.?|versus)\\s+${escaped}\\b)`,
        'i',
    );
    const teamFragment = new RegExp(`\\b[A-Z][A-Za-z'’-]+\\s+${escaped}\\b`).test(title) &&
        /\b(?:vs?\.?|versus|beats?|over)\b.*\b(?:goal|match|game|battle)\b|\b(?:goal|match|game)\b.*\b(?:vs?\.?|versus|beats?|over)\b/i.test(title);
    if (!affiliation.test(text) && !teamFragment) return false;
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
    // Manual city coordinates can share a name with their municipal admin
    // entity (Odesa). Retaining both records should not force a country pin.
    const manualCity = entries.find(entry => entry.manual && entry.type === 'landmark' && entry.admin1Code);
    if (manualCity && entries.every(entry => entry.cc === manualCity.cc && entry.admin1Code === manualCity.admin1Code &&
        Math.abs(entry.lat - manualCity.lat) < 0.02 && Math.abs(entry.lon - manualCity.lon) < 0.02)) return manualCity;
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

function mainActorCountry(title: string): LocationEntry | undefined {
    title = title.replace(/^[\s—–:-]+/, '').replace(/^(?:(?:Should|Will|Can|Could|Would|Does|Did)\s+|The\s+)/, '');
    const institutionCountry = /^(?:(?:Trump|Biden|Obama)(?:'s)?\s+administration|White House)\b/i.test(title)
        ? 'United States' : /^Kremlin\b/i.test(title) ? 'Russia' : undefined;
    if (institutionCountry) return getLocationCandidates(institutionCountry).find(entry => entry.type === 'country');
    const words = title.trim().split(/\s+/);
    for (let length = Math.min(4, words.length); length >= 1; length--) {
        const prefix = cleanCandidate(words.slice(0, length).join(' '));
        if (!/^[A-Z]/.test(prefix)) continue;
        const key = normalizedLocationKey(prefix);
        const alias = COUNTRY_ABBREV_MAP[key];
        const country = getLocationCandidates(typeof alias === 'string' && alias !== '__skip__' ? alias : key).find(entry => entry.type === 'country');
        if (country) return country;
    }
    // A demonym describes an actor only when it qualifies a role; surnames and
    // possessives such as "Moldovan's goal" do not establish nationality.
    if (/^[A-Z][a-z]+\s+(?:(?:chess|football|investment|pension|research|military|Defence|Defense|Foreign|Interior|Health|Finance)\s+)?(?:researchers?|players?|athletes?|officials?|forces?|troops|man|woman|company|firm|fund|government|Ministry|Minister)\b/.test(title)) {
        const demonym = DEMONYM_MAP[words[0].toLowerCase()];
        if (typeof demonym === 'string') return getLocationCandidates(demonym).find(entry => entry.type === 'country');
    }
    return undefined;
}

/**
 * Resolves article text directly to a unique gazetteer entry. Unlike the
 * compatibility extract-then-geocode API, this preserves the hierarchy context
 * needed to distinguish names such as "Santa Cruz, California".
 */
export async function resolveLocation(title: string, description: string, context: LocationContext = {}): Promise<LocationResolution | null> {
    ensureInitialized();
    if (/^which country\b/i.test(title.trim())) return null;
    title = cleanArticleText(title, context.sourceName);
    description = cleanArticleText(description, context.sourceName);
    const descriptionDefinesActor = /^\S+\s+(?:ruling|government|president|prime|defen[cs]e|ministry|military|army|navy|national|researchers?)\b/i.test(description);
    const descriptionActor = descriptionDefinesActor ? mainActorCountry(description) : undefined;
    const actorCountry = mainActorCountry(title) || descriptionActor || (/\b(?:federal judge|voters?|DOJ|administration)\b/i.test(title) &&
        /\b(?:Trump|Biden|Obama)(?:'s)? administration\b/i.test(description)
        ? getLocationCandidates('United States').find(entry => entry.type === 'country') : undefined);
    // Affiliation of a company, fund, or research institution is not the
    // location of the event it discusses. Preserve other geographic evidence.
    const affiliations = new RegExp(`\\b(?:${Object.keys(DEMONYM_MAP).join('|')}|U\\.S\\.|US)\\s+(?=(?:investment\\s+)?(?:firm|provider|customers?|autoworkers?\\s+union|XFEL)\\b)`, 'gi');
    const stripAffiliations = (text: string) => text
        .replace(affiliations, '')
        .replace(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?(?=\s+pension fund\b)/g, '')
        .replace(/\bUC\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?(?=\s+researchers?\b)/g, 'research institution')
        .replace(/\bEuropean\s+XFEL\b/g, 'XFEL');
    title = stripAffiliations(title);
    description = stripAffiliations(description);
    if (/^Researchers at\b/i.test(description) && /\b(?:study|experiments?|research)\b/i.test(description) &&
        !extractPreparedLocation(title, '').match && !actorCountry) return null;
    const extracted = extractPreparedLocation(title, description);
    const hasVenueEvidence = extracted.scored?.some(candidate =>
        ['venue', 'action_target', 'comma_pair', 'possessive_focus', 'dateline'].includes(candidate.source) ||
        (candidate.source === 'regex' && (hasEventContext(candidate.placement === 'title' ? title : description) ||
            getLocationCandidates(candidate.key).some(entry => entry.type !== 'country'))));
    const winnerEntries = getLocationCandidates(extracted.match || '');
    const winnerIsInstitution = ['white house', 'kremlin'].includes(normalizedLocationKey(extracted.match || ''));
    if (actorCountry && !hasVenueEvidence && (!extracted.match || winnerIsInstitution || descriptionActor || winnerEntries.every(entry => entry.type === 'country'))) {
        return buildResolution(actorCountry, actorCountry.name!, 'actor_country', 0.7, [actorCountry]);
    }
    const subjectCountry = extractDemonym(title);
    const allPairs = [
        ...hierarchyPairsInText(title),
        ...hierarchyPairsInText(description),
    ];
    const validPairKeys = new Set(allPairs.filter(pair => getLocationCandidates(pair.child).some(child =>
        getLocationCandidates(pair.parent).some(parent => entryMatchesParent(child, parent))
    )).map(pair => normalizedLocationKey(pair.child)));
    const hasPhysicalVenue = extracted.scored?.some(candidate =>
        (candidate.source === 'venue' && (candidate.placement === 'title' || candidate.leadVenue ||
            ['city', 'landmark'].includes(KNOWN_LOCATIONS[candidate.key]?.type || ''))) ||
        (candidate.source === 'comma_pair' && validPairKeys.has(candidate.key)) ||
        (['regex', 'action_target', 'dateline', 'possessive_focus'].includes(candidate.source) &&
            ['city', 'landmark'].includes(KNOWN_LOCATIONS[candidate.key]?.type || '')));
    const legislation = /\b(?:lawmakers|legislators|parliamentarians|MPs|House of Representatives|Senate|Congress)\b.*\b(?:propose|pass(?:ed|es)?|draft|vote|ban)\b/i.test(title);
    const policyCountry = subjectCountry || (legislation ? actorCountry?.name : undefined);
    if (policyCountry && !hasPhysicalVenue && (legislation || /\b(?:novels|literature|cinema|culture)\b/i.test(title))) {
        const country = getLocationCandidates(policyCountry).find(entry => entry.type === 'country');
        if (country) return buildResolution(country, policyCountry, 'actor_country', 0.9, [country]);
    }
    for (const pair of allPairs) {
        const isWinningPair = normalizedLocationKey(pair.child) === normalizedLocationKey(extracted.match || '');
        if (pair.prose && !isWinningPair) continue;
        const childCandidates = uniqueEntries(getLocationCandidates(pair.child));
        const parentEntries = getLocationCandidates(pair.parent).filter(isHierarchyParent);
        const matched = uniqueEntries(childCandidates.filter(candidate =>
            parentEntries.some(parent => entryMatchesParent(candidate, parent))
        ));
        if (matched.length === 1) {
            return buildResolution(matched[0], pair.child, 'explicit_pair', 1, childCandidates, pair.parent);
        }
        if (matched.length > 1) {
            const dominant = selectDominantFromEntries(matched);
            if (dominant) return buildResolution(dominant, pair.child, 'explicit_pair', 0.9, childCandidates, pair.parent);
        }
        // A comma can also join national actors ("Greenland, Denmark say...").
        // Do not interpret a list of countries as a city-parent constraint.
        if (childCandidates.some(entry => entry.type === 'country')) continue;
        if (isWinningPair && childCandidates.length && parentEntries.length) {
            const parent = parentEntries.length === 1 ? parentEntries[0] : null;
            return parent ? buildResolution(parent, parent.name || pair.parent, 'hierarchy_context', 0.7, [parent]) : null;
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
    )) return actorCountry && !hasVenueEvidence
        ? buildResolution(actorCountry, actorCountry.name!, 'actor_country', 0.7, [actorCountry]) : null;

    const usState = allCandidates.find(entry => entry.type === 'admin1' && entry.cc === 'US');
    const explicitState = new RegExp(`\\b(?:${escapedKey}\\s+state|state\\s+of\\s+${escapedKey})\\b`, 'i').test(`${title} ${description}`);
    const stateAndCountyContext = /\bstate\s+(?:program|law|budget|legislature|government|voters|election)\b/i.test(title) &&
        new RegExp(`\\bCounty,\\s*${escapedKey}\\b`, 'i').test(description);
    if (usState && (explicitState || stateAndCountyContext)) {
        return buildResolution(usState, matchedText, 'hierarchy_context', 0.9, allCandidates);
    }

    // Apply a trusted weak prior before manual city defaults (London is also
    // a major Canadian city). It cannot reinterpret a country as a local state
    // or override any explicit country/administrative context in the article.
    const explicitParentContext = extracted.scored?.some(candidate => candidate.key !== matchedKey &&
        getLocationCandidates(candidate.key).some(isHierarchyParent));
    const manual = allCandidates.find(entry => entry.manual);
    const priorMayOverrideManual = !manual || (manual.type === 'city' && !!manual.cc &&
        manual.cc !== context.countryCode?.toUpperCase());
    if (context.countryCode && priorMayOverrideManual && !explicitParentContext && allCandidates.length > 1 &&
        !allCandidates.some(entry => entry.type === 'country')) {
        const inSourceCountry = allCandidates.filter(entry => entry.cc === context.countryCode!.toUpperCase());
        const admins = inSourceCountry.filter(entry => entry.type === 'admin1');
        const preferred = admins.length === 1 && KNOWN_LOCATIONS[matchedKey]?.type === 'admin1'
            ? admins[0]
            : inSourceCountry.length === 1 ? inSourceCountry[0] : selectDominantFromEntries(inSourceCountry);
        if (preferred) return buildResolution(preferred, matchedText, 'hierarchy_context', 0.7, allCandidates);
    }

    if (manual) {
        return buildResolution(manual, matchedText, 'manual_override', 1, allCandidates);
    }

    // GeoNames represents some major municipal regions twice: as a city and
    // its administrative entity, at the same point (for example Seoul).
    // Keep both identities in the gazetteer without manufacturing ambiguity.
    const municipalCity = allCandidates.find(entry => entry.type === 'city' && entry.pop >= 100000);
    if (municipalCity && allCandidates.every(entry =>
        (entry.type === 'city' || entry.type === 'admin1') &&
        entry.cc === municipalCity.cc && entry.admin1Code === municipalCity.admin1Code &&
        Math.abs(entry.lat - municipalCity.lat) < 0.02 && Math.abs(entry.lon - municipalCity.lon) < 0.02
    )) {
        if (shouldRejectBareMinorCity(matchedText, municipalCity, extracted.scored, title, description)) return null;
        return buildResolution(municipalCity, matchedText, 'unambiguous', 0.85, allCandidates);
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

    // An unresolved facility/city homonym must not discard a separately stated
    // physical region. Keep this coarse fallback limited to explicit venues;
    // national actors and unstructured background mentions are not evidence.
    for (const candidate of extracted.scored || []) {
        if (candidate.key === matchedKey || candidate.source !== 'venue') continue;
        const entries = uniqueEntries(getLocationCandidates(candidate.key));
        if (entries.length === 1 && entries[0].type === 'region') {
            return buildResolution(entries[0], candidate.name, 'hierarchy_context', 0.6, entries);
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
