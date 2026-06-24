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
}

interface GeoCity { lat: number; lon: number; pop: number; cc: string }
interface GeoRegion { lat: number; lon: number; cc: string }

const geoCities: Record<string, GeoCity> = (geoData as Record<string, unknown>).cities as Record<string, GeoCity>;
const geoAdmin1: Record<string, GeoRegion> = (geoData as Record<string, unknown>).admin1 as Record<string, GeoRegion>;
const geoCountries: Record<string, GeoRegion> = ((geoData as Record<string, unknown>).countries || {}) as Record<string, GeoRegion>;

let isInitialized = false;
export const KNOWN_LOCATIONS: Record<string, LocationEntry> = {};
export const MULTI_WORD_LOC_SET: Set<string> = new Set();

/**
 * Ensures the location dictionaries are populated from static geodata.
 * Implements a priority-based loading strategy where specific landmarks and
 * high-population cities take precedence over generic administrative regions.
 */
export function ensureInitialized() {
    if (isInitialized) return;

    // Load cities: larger population wins on collision to ensure major hubs are preferred
    for (const [key, city] of Object.entries(geoCities)) {
        if (key.length <= 2) continue;
        KNOWN_LOCATIONS[key] = { lat: city.lat, lon: city.lon, pop: city.pop, type: 'city', cc: city.cc };
    }

    // Load admin1 regions (states/provinces)
    const ADMIN_SUFFIX_STRIP = /\s+(state|province|oblast|governorate|prefecture|county|district|region|krai|raion|emirate|wilayah|republic)$/i;
    for (const [key, region] of Object.entries(geoAdmin1)) {
        if (key.length <= 2) continue;
        const existing = KNOWN_LOCATIONS[key];
        // Protection: do not let a generic region overwrite a major city (> 500k pop)
        if (existing && existing.pop > 500000) continue;
        const entry = { lat: region.lat, lon: region.lon, pop: 0, type: 'admin1' as const, cc: region.cc };
        KNOWN_LOCATIONS[key] = entry;

        // Register the base name without administrative suffix for single-word matching
        const strippedKey = key.replace(ADMIN_SUFFIX_STRIP, '').trim();
        if (strippedKey !== key && strippedKey.length > 2) {
            const existingStripped = KNOWN_LOCATIONS[strippedKey];
            if (!existingStripped || (existingStripped.type === 'admin1' && existingStripped.pop === 0)) {
                KNOWN_LOCATIONS[strippedKey] = entry;
            }
        }
    }

    // Load country centroids
    for (const [name, data] of Object.entries(geoCountries)) {
        if (name.length <= 2) continue;
        KNOWN_LOCATIONS[name] = { lat: data.lat, lon: data.lon, pop: 0, type: 'country', cc: data.cc };
    }

    // Load manual overrides for high-priority or edge-case locations
    for (const [name, data] of Object.entries(OVERRIDE_LOCATIONS)) {
        KNOWN_LOCATIONS[name] = { lat: data.lat, lon: data.lon, pop: 0, type: data.type };
    }

    // Load conflict-specific landmarks (e.g., border crossings, nuclear plants)
    const REGION_SUFFIX = /\b(oblast|region|province|krai|raion|governorate)$/i;
    for (const [name, coords] of Object.entries(LANDMARKS)) {
        const entryType = REGION_SUFFIX.test(name) ? 'admin1' : 'landmark';
        KNOWN_LOCATIONS[name] = { lat: coords.lat, lon: coords.lon, pop: 0, type: entryType as 'landmark' | 'admin1' };
    }

    // Global fallbacks for broad regions
    for (const [name, coords] of Object.entries(CONTINENT_FALLBACKS)) {
        KNOWN_LOCATIONS[name] = { lat: coords.lat, lon: coords.lon, pop: 0, type: 'landmark' };
    }

    const multiWordKeys = Object.keys(KNOWN_LOCATIONS).filter(k => k.includes(' '));
    for (const key of multiWordKeys) {
        MULTI_WORD_LOC_SET.add(key);
    }

    isInitialized = true;
}

/**
 * Normalizes a candidate string and attempts to find a dictionary match.
 * Supports accent normalization (e.g., "Irán" -> "iran").
 */
export function disambiguate(candidate: string): string {
    ensureInitialized();
    const key = candidate.toLowerCase().trim();
    if (KNOWN_LOCATIONS[key]) return candidate;
    
    const normalized = normalizeAccents(key);
    if (normalized !== key && KNOWN_LOCATIONS[normalized]) {
        return normalizeAccents(candidate);
    }
    return candidate;
}

/**
 * Assigns a specificity priority score. Lower scores represent more granular locations.
 * Landmarks (0) > Major Cities (2) > Minor Cities (4) > Countries (6) > Regions (8).
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
