import {
    STOP_WORDS,
    FALSE_POSITIVES,
    ADMIN_SUFFIX_PATTERN,
    SUPERPOWER_KEYS,
    CONTINENT_NAMES,
} from './constants';
import {
    KNOWN_LOCATIONS,
    disambiguate,
    locationPriority,
} from './dictionary';
import {
    cleanCandidate,
    normalizeAccents,
    toTitleCase,
} from './utils';

export interface Candidate {
    name: string;
    source: 'dateline' | 'comma_pair' | 'regex' | 'direct_scan' | 'nlp' | 'demonym' | 'abbrev' | 'action_target' | 'compound_scan' | 'title_subject' | 'possessive_focus';
    placement: 'title' | 'description';
}

export interface ScoredCandidate {
    name: string;
    key: string;
    source: string;
    placement: 'title' | 'description';
    score: number;
    cc?: string;
}

/**
 * Ranks candidates using a weighted scoring model.
 * Factors include: placement (Title vs Description), source confidence,
 * location type (Specificity), and hierarchical relationship.
 */
export function computeScored(
    candidateList: Candidate[],
    titleLeadingKey: string
): ScoredCandidate[] {
    const scored: ScoredCandidate[] = [];

    for (const { name: raw, source, placement } of candidateList) {
        const candidate = cleanCandidate(raw);

        if (!candidate || candidate.length <= 2) continue;
        if (STOP_WORDS.has(candidate.toLowerCase())) continue;
        if (FALSE_POSITIVES.has(candidate.toLowerCase())) continue;

        const loc = disambiguate(candidate);
        let key = normalizeAccents(loc.toLowerCase());

        // Handle administrative suffixes (e.g., "Gaza Strip" vs "Gaza")
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
            
            // Partial phrase matching to handle compound names vs person names
            for (let len = words.length - 1; len >= 1; len--) {
                const sub = words.slice(0, len).join(' ');
                if (sub.length > 2 && !STOP_WORDS.has(sub) && !FALSE_POSITIVES.has(sub) && KNOWN_LOCATIONS[sub]) {
                    // Heuristic: reject if the following word looks like a capitalized surname
                    const nextWordRaw = rawWords[len];
                    if (nextWordRaw && /^[A-Z]/.test(nextWordRaw)) {
                        const nextWordLower = nextWordRaw.toLowerCase().replace(/[^a-z]/g, '');
                        if (!KNOWN_LOCATIONS[nextWordLower] && 
                            !['city', 'state', 'province', 'river', 'lake', 'bay', 'gulf', 'mountain', 'island', 'islands', 'district', 'county', 'region', 'town', 'airport', 'port', 'station', 'center', 'forces', 'military', 'government', 'police', 'commission', 'organization', 'agency', 'school', 'schools', 'public', 'health', 'hospital', 'university', 'college', 'mayor', 'governor', 'leader', 'minister', 'senator', 'president', 'officer', 'representative', 'candidate', 'chief', 'department', 'fire', 'medical', 'association', 'institute', 'foundation', 'council', 'group'].includes(nextWordLower)) {
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

        // Reject noise words in topic headers
        const lowKey = raw.toLowerCase();
        if (lowKey.endsWith(' war') || lowKey.endsWith(' update') ||
            lowKey.endsWith(' report') || lowKey.endsWith(' brief') ||
            lowKey.endsWith(' briefing') || lowKey.endsWith(' talks') ||
            lowKey.endsWith(' negotiations') || lowKey.endsWith(' deal')) {
            if (source !== 'dateline') continue;
        }

        const finalEntry = KNOWN_LOCATIONS[key];

        // A lone place-name at the beginning of a headline can just as easily be
        // a person or organization (for example, "Burnham ..."). The title
        // subject pass is only a hint: require separate geographic evidence.
        // A direct dictionary scan is not independent because it sees the same token.
        if (
            !key.includes(' ') &&
            key === titleLeadingKey &&
            finalEntry?.type !== 'landmark' &&
            finalEntry?.type !== 'country' &&
            (source === 'title_subject' || (source === 'direct_scan' && placement === 'title'))
        ) {
            const corroborated = candidateList.some((other) => {
                if (other.source === 'title_subject' || other.source === 'direct_scan') return false;
                const otherKey = normalizeAccents(cleanCandidate(other.name).toLowerCase());
                return otherKey === key;
            });
            if (!corroborated) continue;
        }
        const displayName = toTitleCase(key);
        
        // Placement weight
        const wPlacement = placement === 'title' ? 0 : 12;
        
        // Source confidence weight
        // action_target gets full bonus only for specific locations (cities/landmarks).
        // Country-level action targets ("attack on Iran") get reduced credit because
        // they don't pinpoint a specific place and cause country-swap regressions
        // in multi-nation geopolitical articles.
        let wSource = 0;
        const isCountryLevel = finalEntry?.type === 'country' || finalEntry?.type === 'admin1';
        switch(source) {
            case 'possessive_focus': wSource = -15; break;
            case 'action_target': wSource = isCountryLevel ? -5 : -20; break;
            case 'dateline': wSource = -15; break;
            case 'title_subject': wSource = -8; break;
            case 'compound_scan': wSource = 0; break;
            case 'comma_pair': wSource = 0; break;
            case 'regex': wSource = -12; break;
            case 'demonym': case 'abbrev': wSource = placement === 'title' ? 8 : 14; break;
            case 'direct_scan': wSource = placement === 'title' ? 6 : 12; break;
            case 'nlp': wSource = 15; break;
        }
        
        // specificity weight
        const wType = locationPriority(key);
        
        // Regional and entity-type penalties
        const continentPenalty = CONTINENT_NAMES.has(key) ? 40 : 0;
        const regionPenalty = (key === 'middle east' || key === 'west asia' || key === 'southeast asia') ? 25 : 0;
        // Apply superpower penalty to all sources including action_target when country-level.
        // Only exempt action_target for city/landmark targets (e.g., "missile hits Kyiv").
        const superpowerPenalty = (SUPERPOWER_KEYS.has(key) && !(source === 'action_target' && !isCountryLevel)) ? 20 : 0;

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

    // Hierarchical Boosting: cities/landmarks within a mentioned country/region get priority
    const foundCountries = new Set(scored.filter(s => KNOWN_LOCATIONS[s.key]?.type === 'country').map(s => s.cc));
    const foundAdmin1CCs = new Set(scored.filter(s => KNOWN_LOCATIONS[s.key]?.type === 'admin1').map(s => KNOWN_LOCATIONS[s.key]?.cc));
    for (const s of scored) {
        const entry = KNOWN_LOCATIONS[s.key];
        if (!entry) continue;
        if ((entry.type === 'city' || entry.type === 'landmark') && s.cc && foundCountries.has(s.cc)) {
            s.score -= 10;
        }
        if (entry.type === 'city' && entry.cc && foundAdmin1CCs.has(entry.cc) && !foundCountries.has(entry.cc)) {
            s.score -= 8;
        }
    }

    // Superpower Balancing: prevent generic description noise from overshadowing title subjects
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
                bestTitleCountry.score -= 15;
                break;
            }
        }
    }

    // Multi-country dampening: when 2+ distinct countries are found in the title,
    // action_target country-level picks are penalized because the article is likely
    // about international relations, not a local event.
    const titleCountryKeys = new Set(
        scored.filter(s => s.placement === 'title' && KNOWN_LOCATIONS[s.key]?.type === 'country').map(s => s.key)
    );
    if (titleCountryKeys.size >= 2) {
        for (const s of scored) {
            if (s.source === 'action_target' && KNOWN_LOCATIONS[s.key]?.type === 'country') {
                s.score += 15; // penalize action_target country picks in multi-country articles
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
