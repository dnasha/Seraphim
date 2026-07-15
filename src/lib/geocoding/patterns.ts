/**
 * EXTRACTION PATTERNS
 * 
 * This module defines the regular expressions used by the geocoding engine
 * to identify geographic entities and event contexts. Patterns are categorized
 * by their confidence level and intended extraction phase.
 */

/**
 * Standard journalistic datelines (e.g., "WASHINGTON (Reuters) - ").
 * These provide extremely high confidence for the primary location of a report.
 */
export const DATELINE_PATTERN = /^(?:\[[^\]]+\]\s*)?([A-Z][A-Za-z\s]+?)\s*(?:\([^)]+\))?\s*(?:-|—|–|:)\s+/;

export const EMOJI_STRIP = /[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{200D}\u{20E3}\u{E0020}-\u{E007F}\u{1F1E0}-\u{1F1FF}\u{2702}-\u{27B0}\u{FE0E}]/gu;
export const METADATA_COUNTRY_REGEX = /\bCountry:\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){0,3})/;

/**
 * Common comma-separated pairs (e.g., "Kyiv, Ukraine").
 * Used to resolve ambiguous city names via their parent region.
 */
export const COMMA_PAIR_PATTERN = /([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*),\s*([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*)/g;

// Unicode-aware letter class for robust location capture
const L = '[a-zA-Z\u00C0-\u024F]';
const LOC = `[A-Z\u00C0-\u024F]${L}+(?:\\s+[A-Z\u00C0-\u024F]${L}+){0,3}`;

/**
 * General spatial context patterns (e.g., "in [Location]", "near [Location]").
 * These are used as a secondary pass to capture locations mentioned within
 * sentences when structured datelines are missing.
 */
export const LOCATION_PATTERNS = [
    new RegExp(`\\b[Ii]n\\s+(${LOC})`, 'g'),
    new RegExp(`\\b[Ii]n\\s+[Tt]he\\s+(${LOC})`, 'g'),
    new RegExp(`\\b[Ff]rom\\s+(${LOC})`, 'g'),
    new RegExp(`\\b[Nn]ear\\s+(${LOC})`, 'g'),
    new RegExp(`\\b[Aa]round\\s+(${LOC})`, 'g'),
    new RegExp(`\\b[Aa]cross\\s+(${LOC})`, 'g'),
    new RegExp(`\\b[Oo]ff\\s+(?:[Tt]he\\s+[Cc]oast\\s+[Oo]f\\s+)?(${LOC})`, 'g'),
    new RegExp(`\\b[Tt]o\\s+(${LOC})`, 'g'),
    new RegExp(`\\b[Aa]t\\s+(${LOC})`, 'g'),
    new RegExp(`\\b[Tt]owards?\\s+(${LOC})`, 'g'),
    new RegExp(`\\b[Ww]ith\\s+(${LOC})`, 'g'),
    new RegExp(`\\b[Oo]n\\s+(${LOC})`, 'g'),
    new RegExp(`\\b(?:[Cc]ity|[Tt]own|[Pp]ort|[Pp]rovince|[Ss]tate|[Rr]egion|[Vv]illage|[Cc]enter|[Cc]entre)\\s+[Oo]f\\s+(${LOC})`, 'g'),

    // Event-specific verbs used to identify conflict zones
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

    new RegExp(`\\b[Aa]ttacked\\s+in\\s+(?:the\\s+)?(${LOC})`, 'g'),
    new RegExp(`\\b[Tt]argeted\\s+(?:in\\s+)?(?:the\\s+)?(${LOC})`, 'g'),
    new RegExp(`\\bagainst\\s+(${LOC})`, 'g'),
    new RegExp(`\\b(?:mayor|governor|leader)\\s+of\\s+(${LOC})`, 'g'),
    new RegExp(`\\b[Ss]helled\\s+(${LOC})`, 'g'),
    new RegExp(`\\b[Bb]ombed\\s+(${LOC})`, 'g'),

    new RegExp(`\\b[Oo]ut\\s+[Oo]f\\s+(${LOC})`, 'g'),
    new RegExp(`\\b[Rr]eturning\\s+(?:to|from)\\s+(${LOC})`, 'g'),
    new RegExp(`\\b[Ll]aunched\\s+from\\s+(${LOC})`, 'g'),
    new RegExp(`\\b[Ee]scapes?\\s+from\\s+(${LOC})`, 'g'),
    new RegExp(`\\b[Hh]eading\\s+(?:to|for|towards?)\\s+(${LOC})`, 'g'),

    new RegExp(`\\b[Kk]ills?\\s+(?:\\w+\\s+)?(?:in|near|at)\\s+(${LOC})`, 'g'),
    new RegExp(`\\b[Ww]ounded?\\s+(?:in|near)\\s+(${LOC})`, 'g'),
    new RegExp(`\\b[Dd]ead\\s+(?:in|near)\\s+(${LOC})`, 'g'),
    new RegExp(`\\b[Ee]xplosion\\s+(?:in|near|rocks?)\\s+(${LOC})`, 'g'),
    new RegExp(`\\b[Ee]xplodes?\\s+(?:in|near)\\s+(${LOC})`, 'g'),
    new RegExp(`\\b[Rr]ocks?\\s+(${LOC})`, 'g'),
    new RegExp(`\\b[Ss]hakes?\\s+(${LOC})`, 'g'),
    new RegExp(`\\bdowns?\\s+(?:\\w+\\s+)?(?:over|in|near)\\s+(${LOC})`, 'g'),
    new RegExp(`\\b[Ss]hot\\s+down\\s+over\\s+(${LOC})`, 'g'),
    new RegExp(`\\b[Ii]ntercepts?\\s+(?:\\w+\\s+)?(?:over|in|near)\\s+(${LOC})`, 'g'),

    new RegExp(`\\b[Aa]ttacking\\s+(${LOC})`, 'g'),
    new RegExp(`\\b[Vv]isits?\\s+(${LOC})`, 'g'),
    new RegExp(`\\b[Aa]rrives?\\s+in\\s+(${LOC})`, 'g'),
    new RegExp(`\\b[Mm]eets?\\s+(?:with\\s+)?(?:[A-Z]\\w+\\s+)?in\\s+(${LOC})`, 'g'),

    new RegExp(`\\b[Aa]mid\\s+(?:\\w+\\s+){0,3}(?:in|across)\\s+(${LOC})`, 'g'),
    new RegExp(`\\b(?:reopening|reopens|reopened)\\s+(?:the\\s+)?(${LOC})`, 'g'),
    new RegExp(`\\b(?:blockade|blockading|blockaded)\\s+(?:of|on)?\\s+(${LOC})`, 'g'),
    new RegExp(`\\b(?:sanctions?|sanctioning|sanctioned)\\s+(?:on|against)\\s+(${LOC})`, 'g'),
    new RegExp(`\\b(?:protests?|demonstrations?|unrest|clashes)\\s+in\\s+(${LOC})`, 'g'),
];

/**
 * High-confidence action-target patterns.
 * These are prioritized because they describe the recipient of an action
 * (e.g., "Missile hits Kyiv"), which is usually the intended map subject.
 */
export const ACTION_TARGET_PATTERNS = [
    new RegExp(`\\b(?:semi-final|semifinal|final|match|game)\\s+in\\s+(${LOC})`, 'g'),
    new RegExp(`\\b(?:reports?|reporting|filed)\\s+from\\s+(?:the\\s+)?(${LOC})`, 'g'),
    new RegExp(`\\b(?:left|departed)\\s+for\\s+(${LOC})`, 'g'),
    new RegExp(`\\b(?:could(?:n't|\\s+not)\\s+)?leave\\s+(${LOC})`, 'g'),
    new RegExp(`\\b(?:[Aa]ir\\s+defen[cs]es?|[Ss]ecurity)\\s+(?:activated|deployed|increased|tightened)\\s+around\\s+(${LOC})`, 'g'),
    new RegExp(`\\b(?:strikes?|struck)\\s+(?:on|in|against)\\s+(${LOC})`, 'g'),
    new RegExp(`\\b(?:attack|attacked|attacks)\\s+(?:on|in|against)\\s+(${LOC})`, 'g'),
    new RegExp(`\\b(?:fired|fires?|launches?|launched)\\s+(?:at|on|into|towards?)\\s+(${LOC})`, 'g'),
    new RegExp(`\\b(?:missile|rocket|drone)\\s+(?:attack|strike)s?\\s+(?:on|against|in)\\s+(${LOC})`, 'g'),
    new RegExp(`\\b(?:kills?|killed|injur(?:es?|ed|ing)|casualties)\\s+(?:\\d+\\s+)?(?:in|near|at|across)\\s+(${LOC})`, 'g'),
    new RegExp(`\\b(?:sirens?|explosions?|blasts?)\\s+(?:sounded|heard|reported)\\s+(?:in|near|across)\\s+(${LOC})`, 'g'),
    new RegExp(`\\b(?:hit|hits|hitting|struck)\\s+(?:a\\s+)?(?:.*?\\s+)?(?:in|near)\\s+(${LOC})`, 'g'),
    new RegExp(`\\b(?:war|conflict)\\s+(?:on|in|with|against)\\s+(${LOC})`, 'g'),
    new RegExp(`\\b(?:sanctions?)\\s+(?:on|against)\\s+(${LOC})`, 'g'),
    new RegExp(`\\b(?:invad(?:es?|ed|ing))\\s+(${LOC})`, 'g'),
    new RegExp(`\\b(?:sunk|sank|intercept(?:s|ed|ing)?)\\s+.*?\\b(?:in|near|off)\\s+(${LOC})`, 'g'),
    new RegExp(`(${LOC})\\s+(?:is|are)\\s+under\\s+(?:heavy\\s+)?(?:attack|fire|bombardment|siege)`, 'g'),
    new RegExp(`\\b(?:ambassador|envoy)\\s+to\\s+(${LOC})`, 'g'),
    new RegExp(`\\b[Ww]eapons\\s+on\\s+(${LOC})`, 'g'),
    new RegExp(`\\b[Aa]ir\\s+[Ss]trikes?\\s+(?:on|in|against|over)\\s+(${LOC})`, 'g'),
    new RegExp(`\\b(?:intercept(?:s|ed|ing)?)\\s+(${LOC})`, 'g'),
    new RegExp(`\\b(?:downs?|downed|shot\\s+down)\\s+(?:[Ff]-\\d+|drone|aircraft|jet|plane|helicopter|UAV)\\s+(?:over|in|near)\\s+(${LOC})`, 'g'),
    new RegExp(`\\b(?:kills?|killed)\\s+(?:\\d+\\s+)?(?:in|near|at)\\s+(${LOC})`, 'g'),
    new RegExp(`\\b(?:injur(?:es?|ed|ing))\\s+(?:\\d+\\s+)?(?:in|near|at)\\s+(${LOC})`, 'g'),
    new RegExp(`\\b(?:hits?|struck)\\s+(?:\\w+\\s+)?(?:in|central|southern|northern|eastern|western)\\s+(${LOC})`, 'g'),
    new RegExp(`\\b(?:blockade|blockaded|blockading)\\s+(?:of|on)\\s+(${LOC})`, 'g'),
    new RegExp(`\\b(?:reopen(?:s|ed|ing)?)\\s+(?:the\\s+)?(${LOC})`, 'g'),
    
    /**
     * Actor-Action-Target pattern.
     * Prevents the actor (e.g., "Russian forces") from being extracted instead
     * of the target (e.g., "Kyiv").
     */
    new RegExp(`(?:[A-Z]\\w+(?:i|an|ese|ish)\\s+)?(?:forces?|troops|military|army|navy|jets?)\\s+(?:attack(?:s|ed)?|bomb(?:s|ed)?|strike(?:s)?|struck|shell(?:s|ed)?)\\s+(?:\\w+\\s+)?(?:in|near)?\\s*(${LOC})`, 'g'),
];
