import geoData from '../../../data/geonames.json';
import {
    LANDMARKS,
    CONTINENT_FALLBACKS,
    OVERRIDE_LOCATIONS,
} from './constants';
import { normalizeAccents } from './utils';

export interface LocationEntry {
    lat: number;
    lon: number;
    pop: number;
    type: 'city' | 'admin1' | 'country' | 'landmark';
    cc?: string;
    id?: string;
    name?: string;
    admin1Code?: string;
    manual?: boolean;
}

interface GeoCity { lat: number; lon: number; pop: number; cc: string }
interface GeoRegion { lat: number; lon: number; cc: string }
interface GeoDataShape {
    cities: Record<string, GeoCity>;
    cityCandidates?: Record<string, string>;
    cityCandidateNames?: Record<string, string>;
    admin1: Record<string, GeoRegion>;
    admin1Meta?: Record<string, string>;
    admin1Candidates?: Record<string, string>;
    admin1CandidateNames?: Record<string, string>;
    countries?: Record<string, GeoRegion>;
}

const rawGeoData = geoData as unknown as GeoDataShape;
const geoCities = rawGeoData.cities;
const geoAdmin1 = rawGeoData.admin1;
const geoCountries = rawGeoData.countries || {};

let isInitialized = false;
// Location names come from untrusted article text. A normal object inherits keys
// such as "constructor" and "toString", which can be mistaken for gazetteer
// entries when accessed dynamically. Null-prototype dictionaries ensure that an
// unknown location always behaves like a missing key.
export const KNOWN_LOCATIONS: Record<string, LocationEntry> = Object.create(null);
export const LOCATION_CANDIDATES: Record<string, LocationEntry[]> = Object.create(null);
export const MULTI_WORD_LOC_SET: Set<string> = new Set();

const ADMIN_SUFFIX_STRIP = /\s+(state|province|department|oblast|governorate|prefecture|county|district|region|krai|raion|emirate|wilayah|republic)$/i;

function displayNameFromKey(key: string): string {
    return key.split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}

function candidateIdentity(entry: LocationEntry): string {
    if (entry.id?.startsWith('city:')) {
        return `city:${entry.cc || ''}:${entry.lat}:${entry.lon}`;
    }
    return entry.id || `${entry.type}:${entry.cc || ''}:${entry.admin1Code || ''}:${entry.lat}:${entry.lon}`;
}

function registerCandidate(key: string, entry: LocationEntry, prepend = false) {
    const normalizedKey = normalizeAccents(key.toLowerCase().trim());
    const candidates = LOCATION_CANDIDATES[normalizedKey] || [];
    const identity = candidateIdentity(entry);
    if (!candidates.some(candidate => candidateIdentity(candidate) === identity)) {
        if (prepend) candidates.unshift(entry);
        else candidates.push(entry);
        LOCATION_CANDIDATES[normalizedKey] = candidates;
    }
}

function parseCityCandidates(key: string): LocationEntry[] {
    const compact = rawGeoData.cityCandidates?.[key];
    if (!compact) {
        const city = geoCities[key];
        return city ? [{
            ...city,
            id: `city:${key}`,
            name: displayNameFromKey(key),
            type: 'city',
        }] : [];
    }

    return compact.split('|').map(serialized => {
        const [encodedId, rawLat, rawLon, encodedPopulation, cc, admin1] = serialized.split(',');
        return {
            id: `geonames:${parseInt(encodedId, 36)}`,
            name: rawGeoData.cityCandidateNames?.[encodedId] || displayNameFromKey(key),
            lat: Number(rawLat),
            lon: Number(rawLon),
            pop: parseInt(encodedPopulation, 36),
            cc,
            admin1Code: admin1 ? `${cc}.${admin1}` : undefined,
            type: 'city' as const,
        };
    });
}

function parseAdmin1Candidates(key: string): LocationEntry[] {
    const compact = rawGeoData.admin1Candidates?.[key];
    if (compact) {
        return compact.split('|').map(serialized => {
            const [encodedId, rawLat, rawLon, cc, code] = serialized.split(',');
            return {
                id: `geonames:${parseInt(encodedId, 36)}`,
                name: rawGeoData.admin1CandidateNames?.[encodedId] || displayNameFromKey(key),
                lat: Number(rawLat),
                lon: Number(rawLon),
                pop: 0,
                cc,
                admin1Code: code,
                type: 'admin1' as const,
            };
        });
    }

    const region = geoAdmin1[key];
    if (!region) return [];
    const code = rawGeoData.admin1Meta?.[key];
    return [{
        ...region,
        id: code ? `admin1:${code}` : `admin1:${key}`,
        name: displayNameFromKey(key),
        admin1Code: code,
        pop: 0,
        type: 'admin1',
    }];
}

/**
 * Populates the compatibility dictionary and the ambiguity-preserving candidate
 * index. KNOWN_LOCATIONS keeps its historical one-entry shape for callers that
 * only need membership/type checks; resolution uses LOCATION_CANDIDATES.
 */
export function ensureInitialized() {
    if (isInitialized) return;

    for (const key of Object.keys(geoCities)) {
        if (key.length <= 2) continue;
        const candidates = parseCityCandidates(key);
        for (const candidate of candidates) registerCandidate(key, candidate);
        if (candidates[0]) KNOWN_LOCATIONS[key] = candidates[0];
    }

    for (const key of Object.keys(geoAdmin1)) {
        if (key.length <= 2) continue;
        const candidates = parseAdmin1Candidates(key);
        for (const candidate of candidates) registerCandidate(key, candidate);

        const preferredCode = rawGeoData.admin1Meta?.[key];
        const preferred = candidates.find(candidate => candidate.admin1Code === preferredCode) || candidates[0];
        const existing = KNOWN_LOCATIONS[key];
        if (preferred && (!existing || existing.pop <= 500000)) {
            KNOWN_LOCATIONS[key] = preferred;
        }

        const strippedKey = key.replace(ADMIN_SUFFIX_STRIP, '').trim();
        if (strippedKey !== key && strippedKey.length > 2) {
            for (const candidate of candidates) registerCandidate(strippedKey, candidate);
            const existingStripped = KNOWN_LOCATIONS[strippedKey];
            if (preferred && (!existingStripped || existingStripped.type === 'admin1')) {
                KNOWN_LOCATIONS[strippedKey] = preferred;
            }
        }
    }

    for (const [name, data] of Object.entries(geoCountries)) {
        if (name.length <= 2) continue;
        const entry: LocationEntry = {
            ...data,
            id: `country:${data.cc}`,
            name: displayNameFromKey(name),
            pop: 0,
            type: 'country',
        };
        registerCandidate(name, entry);
        KNOWN_LOCATIONS[name] = entry;
    }

    for (const [name, data] of Object.entries(OVERRIDE_LOCATIONS)) {
        const entry: LocationEntry = {
            ...data,
            id: `override:${name}`,
            name: displayNameFromKey(name),
            pop: 0,
            manual: true,
        };
        registerCandidate(name, entry, true);
        KNOWN_LOCATIONS[name] = entry;
    }

    const REGION_SUFFIX = /\b(oblast|region|province|department|krai|raion|governorate)$/i;
    for (const [name, coords] of Object.entries(LANDMARKS)) {
        const entryType = REGION_SUFFIX.test(name) ? 'admin1' : 'landmark';
        const entry: LocationEntry = {
            ...coords,
            id: `landmark:${name}`,
            name: displayNameFromKey(name),
            pop: 0,
            type: entryType,
            manual: true,
        };
        registerCandidate(name, entry, true);
        KNOWN_LOCATIONS[name] = entry;
    }

    for (const [name, coords] of Object.entries(CONTINENT_FALLBACKS)) {
        const entry: LocationEntry = {
            ...coords,
            id: `region:${name}`,
            name: displayNameFromKey(name),
            pop: 0,
            type: 'landmark',
            manual: true,
        };
        registerCandidate(name, entry, true);
        KNOWN_LOCATIONS[name] = entry;
    }

    for (const key of Object.keys(LOCATION_CANDIDATES)) {
        if (key.includes(' ')) MULTI_WORD_LOC_SET.add(key);
    }

    isInitialized = true;
}

export function getLocationCandidates(candidate: string): LocationEntry[] {
    ensureInitialized();
    const key = normalizeAccents(candidate.toLowerCase().trim());
    return LOCATION_CANDIDATES[key] || [];
}

export function getDefaultLocationCandidate(candidate: string): LocationEntry | null {
    const candidates = getLocationCandidates(candidate);
    const manual = candidates.find(entry => entry.manual);
    if (manual) return manual;
    if (candidates.length === 1) return candidates[0];
    return null;
}

export function getDominantLocationCandidate(candidate: string): LocationEntry | null {
    const candidates = getLocationCandidates(candidate);
    const manual = candidates.find(entry => entry.manual);
    if (manual) return manual;
    if (candidates.length === 1) return candidates[0];

    const populated = candidates
        .filter(entry => entry.type === 'city' && entry.pop > 0)
        .sort((a, b) => b.pop - a.pop);
    const winner = populated[0];
    const runnerUp = populated[1];
    if (winner && winner.pop >= 100000 && (!runnerUp || winner.pop >= runnerUp.pop * 5)) {
        return winner;
    }
    return null;
}

export function disambiguate(candidate: string): string {
    ensureInitialized();
    const key = candidate.toLowerCase().trim();
    if (LOCATION_CANDIDATES[key]) return candidate;

    const normalized = normalizeAccents(key);
    if (normalized !== key && LOCATION_CANDIDATES[normalized]) {
        return normalizeAccents(candidate);
    }
    return candidate;
}

/**
 * Assigns a specificity priority score. Lower scores represent more granular locations.
 */
export function locationPriority(key: string): number {
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
