import type { DbEvent } from '@/types';
import { getLocationCandidates } from '@/lib/geocoding/dictionary';
import { calculateDistance, MAX_MERGE_DISTANCE_KM, SIMILARITY_THRESHOLD_PROXIMITY, SIMILARITY_THRESHOLD_STRICT } from '@/lib/utils/vectorize';
import { reportIdentityKey } from '@/lib/utils/reportIdentity';
import { isRecurringTemplatePair, normalizeTitleFingerprint } from './utils/content';

type StoryEvidence = Pick<DbEvent, 'title' | 'description' | 'url' | 'published_at' | 'primary_discovered_at' | 'latitude' | 'longitude' | 'location_name'>;
type LocationEvidence = Pick<DbEvent, 'latitude' | 'longitude' | 'location_name'>;

const BROAD_REGIONS = /^(?:africa|asia|europe|north america|south america|oceania|antarctica|middle east|world|global)$/i;
const SPORTS = [
  /\b(?:football|soccer)\b/i, /\bvolleyball\b/i, /\bbasketball\b/i,
  /\bbaseball\b/i, /\bcricket\b/i, /\brugby\b/i, /(?<!table\s)\btennis\b/i,
  /\bbadminton\b/i, /\bhockey\b/i, /\bswimming\b/i, /\barchery\b/i,
  /\bfencing\b/i, /\bcycling\b/i, /\bwrestling\b/i, /\btable tennis\b/i,
];
const COMPETITIONS = [/\basian games\b/i, /\bolympic(?:s| games)?\b/i, /\bworld cup\b/i, /\bworld championships?\b/i];
const TARGETS = [
  /\b(?:hospital|medical cent(?:er|re))\b/i, /\b(?:school|kindergarten)\b/i,
  /\bwarehouse\b/i, /\b(?:apartment|residential|homes?|houses?)\b/i,
  /\b(?:factory|plant|refinery)\b/i, /\b(?:airport|airfield)\b/i,
  /\b(?:port|harbou?r)\b/i,
];
const INCIDENT_SITES = TARGETS.map(target => new RegExp([
  `${target.source}\\s+(?:(?:major|massive|chemical|industrial|deadly|fatal|missile|drone|rocket|bomb|gas)\\s+){0,2}(?:fire|blaze|explosion|blast|attack|strike)\\b`,
  `\\b(?:fire|blaze|explosion|blast|strike|attack)\\b.{0,35}\\b(?:at|in|on|hits?|strikes?|struck|targets?|targeted|damages?|destroys?)\\s+[^,.;:]{0,50}${target.source}`,
  `${target.source}\\s+(?:(?:was|is)\\s+)?(?:hit|struck|attacked|bombed|shelled|damaged|destroyed|burns|ablaze)\\b`,
].join('|'), 'i'));
const INCIDENT = /\b(?:fire|blaze|explosion|blast|strike|missile|earthquake|shooting|attack)\b/i;
const FOLLOW_UP = /\b(?:death toll|toll (?:rises|rose)|aftermath|survivors?|funerals?|investigat(?:ion|ors?|es?)|days? after|following|previous|earlier|last week's|update)\b|\b(?:dies|died|succumbs?|injured)\b.{0,100}\b(?:after|later|from (?:his|her|their|the) injuries)\b/i;
const WEEKDAYS = /\b(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b/gi;
const QUIZ = /^(?:(?:daily|weekly)\s+)?(?:quiz|trivia|crossword)(?:\s*(?:[:|—-]|$)|\s+(?:on|about|time|answers?|clues?)\b)/i;
const COMPETITION_REPORT = /\b(?:beats?|defeats?|wins?|won|match|tournament|competition|final|semifinal|quarterfinal|gold|silver|bronze|medal|champion(?:ship)?|victor(?:y|ies))\b/i;
const AGREEMENT_REPORT = /\b(?:sign(?:s|ed)?|agree(?:s|d|ment)?|pact|deal|accord|treaty)\b/i;

function explicitCountries(title: string): Set<string> {
  const countries = new Set<string>();
  const words = title.match(/[\p{L}\p{N}]+/gu) ?? [];
  for (let start = 0; start < words.length; start++) {
    for (let length = 1; length <= 4 && start + length <= words.length; length++) {
      for (const place of getLocationCandidates(words.slice(start, start + length).join(' '))) {
        if (place.type === 'country' && place.cc) countries.add(place.cc);
      }
    }
  }
  return countries;
}

function describesMarketSession(title: string): boolean {
  return /\b(?:shares|stocks|kospi|nikkei|sensex|wall street)\b/i.test(title) &&
    /\b(?:close[sd]?|open[s]?|end[s]?|finish(?:es)?|slump[s]?|gain[s]?|surge[s]?|rise[s]?|fall[s]?|rebound[s]?)\b/i.test(title);
}

function explicitlyNamesLocation(event: StoryEvidence): boolean {
  const name = event.location_name?.split(',')[0].trim();
  if (!name) return false;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b(?:in|at|near)\\s+(?:the city of\\s+)?${escaped}\\b`, 'i')
    .test(`${event.title}. ${event.description ?? ''}`);
}

function explicitIncidentDays(text: string): Set<string> {
  const days = new Set<string>();
  for (const sentence of text.split(/[.!?;]+/)) {
    // A later reporting action has its own date, not a new incident date.
    if (/\b(?:names?|released|identified|announced|funerals?|investigat(?:ion|ors?|es?)|survivors?)\b/i.test(sentence)) continue;
    if (!/\b(?:fire|blaze|earthquake|attack|strike|shooting|explosion|blast|exploded|struck|hit|erupted|occurred|broke out)\b/i.test(sentence)) continue;
    for (const day of sentence.match(WEEKDAYS) ?? []) days.add(day.toLowerCase());
  }
  return days;
}

function disjointExplicitValues(first: string, second: string, patterns: RegExp[]): boolean {
  const a = patterns.map((pattern, index) => pattern.test(first) ? index : -1).filter(index => index >= 0);
  const b = patterns.map((pattern, index) => pattern.test(second) ? index : -1).filter(index => index >= 0);
  return a.length > 0 && b.length > 0 && !a.some(index => b.includes(index));
}

/** Coordinates only unlock the local threshold when they represent a known local place. */
export function hasPreciseLocation(event: LocationEvidence): boolean {
  if (!Number.isFinite(event.latitude) || !Number.isFinite(event.longitude) || !event.location_name) return false;
  const names = [event.location_name, event.location_name.split(',')[0].trim()];
  return names.some(name => !BROAD_REGIONS.test(name) && getLocationCandidates(name).some(place =>
    (place.type === 'city' || place.type === 'landmark') &&
    calculateDistance(event.latitude!, event.longitude!, place.lat, place.lon) <= 3,
  ));
}

export function sharesPreciseLocation(first: LocationEvidence, second: LocationEvidence): boolean {
  return hasPreciseLocation(first) && hasPreciseLocation(second) &&
    calculateDistance(first.latitude!, first.longitude!, second.latitude!, second.longitude!) <= MAX_MERGE_DISTANCE_KM;
}

export function passesSemanticThreshold(first: LocationEvidence, second: LocationEvidence, similarity: number): boolean {
  return similarity >= SIMILARITY_THRESHOLD_STRICT ||
    (similarity >= SIMILARITY_THRESHOLD_PROXIMITY && sharesPreciseLocation(first, second));
}

/** Explicit contradictions override a high embedding score; absent details are not contradictions. */
export function hasConflictingStoryEvidence(first: StoryEvidence, second: StoryEvidence): boolean {
  if (reportIdentityKey(first.url) === reportIdentityKey(second.url)) return false;
  if (isRecurringTemplatePair(first.title, second.title)) return true;
  if (QUIZ.test(first.title) !== QUIZ.test(second.title)) return true;

  const sportsContext = COMPETITION_REPORT.test(first.title) && COMPETITION_REPORT.test(second.title) &&
    SPORTS.some(pattern => pattern.test(first.title) || pattern.test(second.title));
  if (sportsContext) {
    if (disjointExplicitValues(first.title, second.title, SPORTS)) return true;
    if (disjointExplicitValues(first.title, second.title, COMPETITIONS)) return true;
    if (disjointExplicitValues(first.title, second.title, [/\bmen(?:'s)?\b/i, /\bwomen(?:'s)?\b/i])) return true;
  }

  if (AGREEMENT_REPORT.test(first.title) && AGREEMENT_REPORT.test(second.title)) {
    const a = explicitCountries(first.title);
    const b = explicitCountries(second.title);
    // Two explicitly named counterparties on each side identify a bilateral
    // agreement. Missing names or larger multilateral sets are not contradictions.
    if (a.size === 2 && b.size === 2 && [...a].some(country => !b.has(country))) return true;
  }

  const firstIncident = INCIDENT.test(first.title);
  const secondIncident = INCIDENT.test(second.title);
  if (firstIncident && secondIncident && disjointExplicitValues(first.title, second.title, INCIDENT_SITES)) return true;

  const exactTitle = normalizeTitleFingerprint(first.title) === normalizeTitleFingerprint(second.title);
  const canCompareLocations = (hasPreciseLocation(first) && hasPreciseLocation(second)) ||
    (exactTitle && explicitlyNamesLocation(first) && explicitlyNamesLocation(second));
  if ((exactTitle || (firstIncident && secondIncident)) && canCompareLocations &&
    first.latitude != null && first.longitude != null && second.latitude != null && second.longitude != null &&
    calculateDistance(first.latitude, first.longitude, second.latitude, second.longitude) > MAX_MERGE_DISTANCE_KM) return true;

  // Only reject explicit, different event days for immediate incident reports.
  // Follow-ups commonly describe an earlier incident and must remain eligible.
  const firstText = `${first.title}. ${first.description ?? ''}`;
  const secondText = `${second.title}. ${second.description ?? ''}`;
  const gap = Math.abs(Date.parse(first.primary_discovered_at ?? first.published_at) - Date.parse(second.primary_discovered_at ?? second.published_at));
  if (gap >= 18 * 60 * 60 * 1000 && describesMarketSession(first.title) && describesMarketSession(second.title) &&
    (first.primary_discovered_at ?? first.published_at).slice(0, 10) !== (second.primary_discovered_at ?? second.published_at).slice(0, 10)) return true;
  if (gap > 18 * 60 * 60 * 1000 && firstIncident && secondIncident && !FOLLOW_UP.test(firstText) && !FOLLOW_UP.test(secondText)) {
    const a = explicitIncidentDays(firstText);
    const b = explicitIncidentDays(secondText);
    if (a.size === 1 && b.size === 1 && ![...a].some(day => b.has(day))) return true;
  }

  // Publication age alone is not an incident boundary: long-running episodes
  // and later casualty updates can legitimately return to an active cluster.
  return false;
}
