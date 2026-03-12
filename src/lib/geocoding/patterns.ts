/**
 * Regex patterns for location extraction.
 */

// regex for standard datelines (e.g. "WASHINGTON (Reuters) - ")
export const DATELINE_PATTERN = /^(?:\[[^\]]+\]\s*)?([A-Z][A-Za-z\s]+?)\s*(?:\([^)]+\))?\s*(?:-|—|–|:)\s+/;

// Optimized module-level regexes to avoid re-compilation
export const EMOJI_STRIP = /[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{200D}\u{20E3}\u{E0020}-\u{E007F}\u{1F1E0}-\u{1F1FF}\u{2702}-\u{27B0}\u{FE0E}]/gu;
export const METADATA_COUNTRY_REGEX = /\bCountry:\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){0,3})/;

// "City, State" or "City, Country" comma-pair pattern
export const COMMA_PAIR_PATTERN = /([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*),\s*([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*)/g;

// Unicode-aware letter class for location capture groups
const L = '[a-zA-Z\u00C0-\u024F]'; // a single letter including accented
const LOC = `[A-Z\u00C0-\u024F]${L}+(?:\\s+[A-Z\u00C0-\u024F]${L}+){0,3}`; // multi-word location

// regex patterns to pull "in Place", "from Place", "bombards Place", etc.
export const LOCATION_PATTERNS = [
    new RegExp(`\\b[Ii]n\\s+(${LOC})`, 'g'),
    new RegExp(`\\b[Ii]n\\s+[Tt]he\\s+(${LOC})`, 'g'),
    new RegExp(`\\b[Ff]rom\\s+(${LOC})`, 'g'),
    new RegExp(`\\b[Nn]ear\\s+(${LOC})`, 'g'),
    new RegExp(`\\b[Aa]cross\\s+(${LOC})`, 'g'),
    new RegExp(`\\b[Oo]ff\\s+(?:[Tt]he\\s+[Cc]oast\\s+[Oo]f\\s+)?(${LOC})`, 'g'),
    new RegExp(`\\b[Tt]o\\s+(${LOC})`, 'g'),
    new RegExp(`\\b[Aa]t\\s+(${LOC})`, 'g'),
    new RegExp(`\\b[Tt]owards?\\s+(${LOC})`, 'g'),
    new RegExp(`\\b[Ww]ith\\s+(${LOC})`, 'g'),
    new RegExp(`\\b[Oo]ver\\s+(${LOC})`, 'g'),
    new RegExp(`\\b[Oo]n\\s+(${LOC})`, 'g'),
    new RegExp(`\\b(?:[Cc]ity|[Tt]own|[Pp]rovince|[Ss]tate|[Rr]egion|[Vv]illage|[Cc]enter|[Cc]entre)\\s+[Oo]f\\s+(${LOC})`, 'g'),

    // Present-tense action verbs
    new RegExp(`\\b[Hh]its?\\s+(${LOC})`, 'g'),
    new RegExp(`\\b[Ss]trikes?\\s+(${LOC})`, 'g'),
    new RegExp(`\\b[Aa]ttacks?\\s+(?:[Oo]n\\s+)?(${LOC})`, 'g'),
    new RegExp(`\\b[Ff]ighting\\s+in\\s+(${LOC})`, 'g'),
    new RegExp(`\\b[Ww]ar\\s+in\\s+(${LOC})`, 'g'),
    new RegExp(`\\b[Cc]risis\\s+in\\s+(${LOC})`, 'g'),
    new RegExp(`\\b[Ii]nvades?\\s+(${LOC})`, 'g'),
    new RegExp(`\\b[Oo]ccupied\\s+(${LOC})`, 'g'),
    new RegExp(`\\b[Bb]ombards?\\s+(${LOC})`, 'g'),
    new RegExp(`\\b[Ss]hells?\\s+(${LOC})`, 'g'),
    new RegExp(`\\b[Tt]argets?\\s+(${LOC})`, 'g'),
    new RegExp(`\\b[Ss]eizes?\\s+(${LOC})`, 'g'),
    new RegExp(`\\b[Cc]aptures?\\s+(${LOC})`, 'g'),
    new RegExp(`\\b[Rr]aids?\\s+(?:[Oo]n\\s+)?(${LOC})`, 'g'),
    new RegExp(`\\b[Bb]esieges?\\s+(${LOC})`, 'g'),
    new RegExp(`\\b[Ff]lees?\\s+to\\s+(${LOC})`, 'g'),
    new RegExp(`\\b[Dd]eploys?\\s+to\\s+(${LOC})`, 'g'),

    // Past-tense variants
    new RegExp(`\\b[Aa]ttacked\\s+in\\s+(?:the\\s+)?(${LOC})`, 'g'),
    new RegExp(`\\b[Tt]argeted\\s+(?:in\\s+)?(?:the\\s+)?(${LOC})`, 'g'),
    new RegExp(`\\bagainst\\s+(${LOC})`, 'g'),
    new RegExp(`\\b(?:mayor|governor|leader)\\s+of\\s+(${LOC})`, 'g'),
    new RegExp(`\\b[Ss]helled\\s+(${LOC})`, 'g'),
    new RegExp(`\\b[Bb]ombed\\s+(${LOC})`, 'g'),
];

export const ACTION_TARGET_PATTERNS = [
    new RegExp(`\\b(?:strikes?|struck)\\s+(?:on|in|against)\\s+(${LOC})`, 'g'),
    new RegExp(`\\b(?:attack|attacked|attacks)\\s+(?:on|in|against)\\s+(${LOC})`, 'g'),
    new RegExp(`\\b(?:fired|fires?|launches?|launched)\\s+(?:at|on|into|towards?)\\s+(${LOC})`, 'g'),
    new RegExp(`\\b(?:missile|rocket|drone)\\s+(?:attack|strike)s?\\s+(?:on|against|in)\\s+(${LOC})`, 'g'),
    new RegExp(`\\b(?:hit|hits|hitting)\\s+(?:a\\s+)?(?:.*?\\s+)?(?:in|near)\\s+(${LOC})`, 'g'),
    new RegExp(`\\b(?:bombed|bombing|bombs?)\\s+(${LOC})`, 'g'),
    new RegExp(`\\b(?:war|conflict)\\s+(?:on|in|with|against)\\s+(${LOC})`, 'g'),
    new RegExp(`\\b(?:sanctions?)\\s+(?:on|against)\\s+(${LOC})`, 'g'),
    new RegExp(`\\b(?:invad(?:es?|ed|ing))\\s+(${LOC})`, 'g'),
    new RegExp(`\\b(?:sunk|sank|intercept(?:s|ed|ing)?)\\s+.*?\\b(?:in|near|off)\\s+(${LOC})`, 'g'),
    new RegExp(`(${LOC})\\s+(?:is|are)\\s+under\\s+(?:heavy\\s+)?(?:attack|fire|bombardment|siege)`, 'g'),
    new RegExp(`\\b(?:ambassador|envoy)\\s+to\\s+(${LOC})`, 'g'),
    new RegExp(`\\b(?:war|conflict)\\s+(?:on|in|with|against)\\s+(${LOC})`, 'g'),
    new RegExp(`\\b[Ww]eapons\\s+on\\s+(${LOC})`, 'g'),
    new RegExp(`\\b[Aa]ir\\s+[Ss]trikes?\\s+(?:on|in|against|over)\\s+(${LOC})`, 'g'),
    new RegExp(`\\b(?:intercept(?:s|ed|ing)?)\\s+(${LOC})`, 'g'),
];
