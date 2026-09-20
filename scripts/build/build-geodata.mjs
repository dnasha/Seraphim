/*
  Seraphim Geodata Builder
  
  This script processes raw GeoNames datasets (cities5000.txt and admin1CodesASCII.txt)
  along with custom country mappings to produce a optimized JSON database for the
  geocoding extraction pipeline.
  
  The output is saved to 'data/geonames.json' and is designed to be lightweight
  for server-side NLP tasks.
  
  Usage: 
  bun scripts/build/build-geodata.mjs
  OR
  node scripts/build/build-geodata.mjs
*/

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', '..', 'data');

/**
 * ISO 3166-1 alpha-2 country mappings.
 * Each entry provides canonical names, common aliases, and centroid coordinates
 * for high-level geographic resolution.
 */
const COUNTRY_DATA = {
    'AD': [['andorra', 42.55, 1.60]],
    'AE': [['united arab emirates', 23.42, 53.85], ['uae', 23.42, 53.85]],
    'AF': [['afghanistan', 33.94, 67.71]],
    'AG': [['antigua and barbuda', 17.06, -61.80]],
    'AL': [['albania', 41.15, 20.17]],
    'AM': [['armenia', 40.07, 45.04]],
    'AO': [['angola', -11.20, 17.87]],
    'AR': [['argentina', -38.42, -63.62]],
    'AT': [['austria', 47.52, 14.55]],
    'AU': [['australia', -25.27, 133.78]],
    'AZ': [['azerbaijan', 40.14, 47.58]],
    'BA': [['bosnia and herzegovina', 43.92, 17.68], ['bosnia', 43.92, 17.68]],
    'BB': [['barbados', 13.19, -59.54]],
    'BD': [['bangladesh', 23.68, 90.36]],
    'BE': [['belgium', 50.50, 4.47]],
    'BF': [['burkina faso', 12.24, -1.56]],
    'BG': [['bulgaria', 42.73, 25.49]],
    'BH': [['bahrain', 26.07, 50.56]],
    'BI': [['burundi', -3.37, 29.92]],
    'BJ': [['benin', 9.31, 2.32]],
    'BN': [['brunei', 4.54, 114.73]],
    'BO': [['bolivia', -16.29, -63.59]],
    'BR': [['brazil', -14.24, -51.93]],
    'BS': [['bahamas', 25.03, -77.40]],
    'BT': [['bhutan', 27.51, 90.43]],
    'BW': [['botswana', -22.33, 24.68]],
    'BY': [['belarus', 53.71, 27.95]],
    'BZ': [['belize', 17.19, -88.50]],
    'CA': [['canada', 56.13, -106.35]],
    'CD': [['democratic republic of the congo', -4.04, 21.76], ['democratic republic of congo', -4.04, 21.76], ['congo', -4.04, 21.76], ['drc', -4.04, 21.76], ['dr congo', -4.04, 21.76]],
    'CF': [['central african republic', 6.61, 20.94]],
    'CG': [['republic of the congo', -0.23, 15.83], ['republic of congo', -0.23, 15.83]],
    'CH': [['switzerland', 46.82, 8.23]],
    'CI': [['ivory coast', 7.54, -5.55], ['cote d\'ivoire', 7.54, -5.55]],
    'CL': [['chile', -35.68, -71.54]],
    'CM': [['cameroon', 7.37, 12.35]],
    'CN': [['china', 35.86, 104.20]],
    'CO': [['colombia', 4.57, -74.30]],
    'CR': [['costa rica', 9.75, -83.75]],
    'CU': [['cuba', 21.52, -77.78]],
    'CV': [['cape verde', 16.00, -24.01]],
    'CY': [['cyprus', 35.13, 33.43]],
    'CZ': [['czech republic', 49.82, 15.47], ['czechia', 49.82, 15.47]],
    'DE': [['germany', 51.17, 10.45]],
    'DJ': [['djibouti', 11.83, 42.59]],
    'DK': [['denmark', 56.26, 9.50]],
    'DM': [['dominica', 15.41, -61.37]],
    'DO': [['dominican republic', 18.74, -70.16]],
    'DZ': [['algeria', 28.03, 1.66]],
    'EC': [['ecuador', -1.83, -78.18]],
    'EE': [['estonia', 58.60, 25.01]],
    'EG': [['egypt', 26.82, 30.80]],
    'ER': [['eritrea', 15.18, 39.78]],
    'ES': [['spain', 40.46, -3.75]],
    'ET': [['ethiopia', 9.15, 40.49]],
    'FI': [['finland', 61.92, 25.75]],
    'FJ': [['fiji', -17.71, 178.07]],
    'FR': [['france', 46.23, 2.21]],
    'GA': [['gabon', -0.80, 11.61]],
    'GB': [['united kingdom', 55.38, -3.44], ['uk', 55.38, -3.44], ['britain', 55.38, -3.44]],
    'GD': [['grenada', 12.12, -61.68]],
    'GE': [['georgia', 42.32, 43.36]],
    'GH': [['ghana', 7.95, -1.02]],
    // GeoNames 3425505: dependent territory with its own ISO code, not the
    // homonymous settlement in Barbados. https://www.geonames.org/3425505
    'GL': [['greenland', 72, -40], ['kalaallit nunaat', 72, -40]],
    'GM': [['gambia', 13.44, -15.31]],
    'GN': [['guinea', 9.95, -9.70]],
    'GQ': [['equatorial guinea', 1.65, 10.27]],
    'GR': [['greece', 39.07, 21.82]],
    'GT': [['guatemala', 15.78, -90.23]],
    'GW': [['guinea-bissau', 11.80, -15.18]],
    'GY': [['guyana', 4.86, -58.93]],
    'HN': [['honduras', 15.20, -86.24]],
    'HR': [['croatia', 45.10, 15.20]],
    'HT': [['haiti', 18.97, -72.29]],
    'HU': [['hungary', 47.16, 19.50]],
    'ID': [['indonesia', -0.79, 113.92]],
    'IE': [['ireland', 53.14, -7.69]],
    'IL': [['israel', 31.05, 34.85]],
    'IN': [['india', 20.59, 78.96]],
    'IQ': [['iraq', 33.22, 43.68]],
    'IR': [['iran', 32.43, 53.69]],
    'IS': [['iceland', 64.96, -19.02]],
    'IT': [['italy', 41.87, 12.57]],
    'JM': [['jamaica', 18.11, -77.30]],
    'JO': [['jordan', 30.59, 36.24]],
    'JP': [['japan', 36.20, 138.25]],
    'KE': [['kenya', -0.02, 37.91]],
    'KG': [['kyrgyzstan', 41.20, 74.77]],
    'KH': [['cambodia', 12.57, 104.99]],
    'KI': [['kiribati', -3.37, -168.73]],
    'KM': [['comoros', -12.17, 44.27]],
    'KN': [['saint kitts and nevis', 17.36, -62.78]],
    'KP': [['north korea', 40.34, 127.51]],
    'KR': [['south korea', 35.91, 127.77]],
    'KW': [['kuwait', 29.31, 47.48]],
    'KZ': [['kazakhstan', 48.02, 66.92]],
    'LA': [['laos', 19.86, 102.50]],
    'LB': [['lebanon', 33.85, 35.86]],
    'LC': [['saint lucia', 13.91, -60.98]],
    'LI': [['liechtenstein', 47.17, 9.56]],
    'LK': [['sri lanka', 7.87, 80.77]],
    'LR': [['liberia', 6.43, -9.43]],
    'LS': [['lesotho', -29.61, 28.23]],
    'LT': [['lithuania', 55.17, 23.88]],
    'LU': [['luxembourg', 49.82, 6.13]],
    'LV': [['latvia', 56.88, 24.60]],
    'LY': [['libya', 26.34, 17.23]],
    'MA': [['morocco', 31.79, -7.09]],
    'MC': [['monaco', 43.73, 7.42]],
    'MD': [['moldova', 47.41, 28.37]],
    'ME': [['montenegro', 42.71, 19.37]],
    'MG': [['madagascar', -18.77, 46.87]],
    'MK': [['north macedonia', 41.51, 21.75], ['macedonia', 41.51, 21.75]],
    'ML': [['mali', 17.57, -4.00]],
    'MM': [['myanmar', 21.91, 95.96]],
    'MN': [['mongolia', 46.86, 103.85]],
    'MR': [['mauritania', 21.01, -10.94]],
    'MT': [['malta', 35.94, 14.38]],
    'MU': [['mauritius', -20.35, 57.55]],
    'MV': [['maldives', 3.20, 73.22]],
    'MW': [['malawi', -13.25, 34.30]],
    'MX': [['mexico', 23.63, -102.55]],
    'MY': [['malaysia', 4.21, 101.98]],
    'MZ': [['mozambique', -18.67, 35.53]],
    'NA': [['namibia', -22.96, 18.49]],
    'NE': [['niger', 17.61, 8.08]],
    'NG': [['nigeria', 9.08, 8.68]],
    'NI': [['nicaragua', 12.87, -85.21]],
    'NL': [['netherlands', 52.13, 5.29]],
    'NO': [['norway', 60.47, 8.47]],
    'NP': [['nepal', 28.39, 84.12]],
    'NR': [['nauru', -0.52, 166.93]],
    'NZ': [['new zealand', -40.90, 174.89]],
    'OM': [['oman', 21.47, 55.98]],
    'PW': [['palau', 7.51, 134.58]],
    'MH': [['marshall islands', 7.11, 171.18]],
    'FM': [['micronesia', 7.43, 150.55]],
    'PA': [['panama', 8.54, -80.78]],
    'PE': [['peru', -9.19, -75.02]],
    'PG': [['papua new guinea', -6.31, 143.96]],
    'PH': [['philippines', 12.88, 121.77]],
    'PK': [['pakistan', 30.38, 69.35]],
    'PL': [['poland', 51.92, 19.15]],
    'PT': [['portugal', 39.40, -8.22]],
    'PY': [['paraguay', -23.44, -58.44]],
    'PS': [['palestine', 31.95, 35.23]],
    'QA': [['qatar', 25.35, 51.18]],
    'RO': [['romania', 45.94, 24.97]],
    'RS': [['serbia', 44.02, 21.01]],
    'RU': [['russia', 61.52, 105.32]],
    'RW': [['rwanda', -1.94, 29.87]],
    'SA': [['saudi arabia', 23.89, 45.08]],
    'SB': [['solomon islands', -9.65, 160.16]],
    'SC': [['seychelles', -4.68, 55.49]],
    'SD': [['sudan', 12.86, 30.22]],
    'SE': [['sweden', 60.13, 18.64]],
    'SG': [['singapore', 1.35, 103.82]],
    'SI': [['slovenia', 46.15, 14.99]],
    'SK': [['slovakia', 48.67, 19.70]],
    'SL': [['sierra leone', 8.46, -11.78]],
    'SM': [['san marino', 43.94, 12.46]],
    'SN': [['senegal', 14.50, -14.45]],
    'SO': [['somalia', 5.15, 46.20]],
    'SR': [['suriname', 3.92, -56.03]],
    'SS': [['south sudan', 6.88, 31.31]],
    'ST': [['sao tome and principe', 0.19, 6.61]],
    'SV': [['el salvador', 13.79, -88.90]],
    'SY': [['syria', 34.80, 38.99]],
    'SZ': [['eswatini', -26.52, 31.47], ['swaziland', -26.52, 31.47]],
    'TD': [['chad', 15.45, 18.73]],
    'TG': [['togo', 8.62, 1.21]],
    'TH': [['thailand', 15.87, 100.99]],
    'TJ': [['tajikistan', 38.86, 71.28]],
    'TL': [['east timor', -8.87, 125.73], ['timor-leste', -8.87, 125.73]],
    'TM': [['turkmenistan', 38.97, 59.56]],
    'TN': [['tunisia', 33.89, 9.54]],
    'TO': [['tonga', -21.18, -175.20]],
    'TR': [['turkey', 38.96, 35.24], ['turkiye', 38.96, 35.24]],
    'TT': [['trinidad and tobago', 10.69, -61.22]],
    'TV': [['tuvalu', -7.11, 177.65]],
    'TW': [['taiwan', 23.70, 120.96]],
    'TZ': [['tanzania', -6.37, 34.89]],
    'UA': [['ukraine', 48.38, 31.17]],
    'UG': [['uganda', 1.37, 32.29]],
    'US': [['united states', 37.09, -95.71], ['us', 37.09, -95.71], ['usa', 37.09, -95.71]],
    'UY': [['uruguay', -32.52, -55.77]],
    'UZ': [['uzbekistan', 41.38, 64.59]],
    'VA': [['vatican city', 41.90, 12.45]],
    'VC': [['saint vincent and the grenadines', 12.98, -61.29]],
    'VE': [['venezuela', 6.42, -66.59]],
    'VN': [['vietnam', 14.06, 108.28]],
    'VU': [['vanuatu', -15.38, 166.96]],
    'WS': [['samoa', -13.76, -172.10]],
    'XK': [['kosovo', 42.60, 20.90]],
    'YE': [['yemen', 15.55, 48.52]],
    'ZA': [['south africa', -30.56, 22.94]],
    'ZM': [['zambia', -13.13, 27.85]],
    'ZW': [['zimbabwe', -19.02, 29.15]],
    'HK': [['hong kong', 22.32, 114.17]],
    'PR': [['puerto rico', 18.22, -66.59]],
    'GZ': [['gaza', 31.35, 34.31]],
};

/** The runtime uses the same accent/case normalization for every lookup. */
export function normalizeLocationKey(value) {
    return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

/** Generate only orthographic Saint abbreviations, not translations/guesses. */
export function locationAliases(name) {
    const aliases = new Set([normalizeLocationKey(name)]);
    const saint = /\b(?:saint|st\.)[ -]+/gi;
    if (saint.test(name)) {
        aliases.add(normalizeLocationKey(name.replace(saint, 'saint ')));
        aliases.add(normalizeLocationKey(name.replace(saint, 'st. ')));
        aliases.add(normalizeLocationKey(name.replace(saint, 'st ')));
    }
    return [...aliases].filter(key => key.length > 2);
}

const roundCoordinate = value => Math.round(value * 100) / 100;
const displayNameFromKey = key => key.split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');

function register(map, key, entry) {
    const candidates = map.get(key) || [];
    if (!candidates.some(candidate => candidate.id === entry.id)) {
        candidates.push(entry);
        map.set(key, candidates);
    }
}

/**
 * Pure builder for both the CLI and fixture tests. Alternate-name dumps contain
 * airport codes, historical names and unlabelled translations; only reviewed
 * aliases from the supplements are imported, and only when the raw record
 * confirms the alias. Every alias retains all homonymous geographic entities.
 */
export function buildGeodata(citiesRaw, admin1Raw, supplements = {}) {
    const cityCandidateMap = new Map();
    const admin1Centroids = new Map();

    for (const line of citiesRaw.split('\n')) {
        const cols = line.split('\t');
        if (cols.length < 15) continue;
        const id = Number(cols[0]);
        const name = (cols[1] || '').trim();
        const lat = Number(cols[4]);
        const lon = Number(cols[5]);
        if (!Number.isInteger(id) || id <= 0 || name.length <= 2 || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;

        const city = { id, name, lat, lon, pop: Number(cols[14]) || 0, cc: cols[8].trim(), a1: cols[10].trim() };
        const aliases = new Set([...locationAliases(name), ...locationAliases(cols[2] || name)]);
        const rawAliases = new Set((cols[3] || '').split(',').map(normalizeLocationKey));
        for (const alias of supplements.cityAliases?.[id] || []) {
            if (!rawAliases.has(normalizeLocationKey(alias))) {
                throw new Error(`Unverified alias ${alias} for GeoNames ${id}`);
            }
            for (const key of locationAliases(alias)) aliases.add(key);
        }
        for (const key of aliases) register(cityCandidateMap, key, city);

        // Existing regional coordinates use the largest settlement as their
        // representative point. Retain that convention during this data repair.
        if (city.a1) {
            const code = `${city.cc}.${city.a1}`;
            const existing = admin1Centroids.get(code);
            if (!existing || city.pop > existing.pop) admin1Centroids.set(code, city);
        }
    }

    // A small, sourced supplement covers populated-place sections omitted by
    // the cities5000 population filter. These remain ordinary candidates, not
    // global overrides of homonymous cities in other regions.
    for (const supplemental of supplements.cities || []) {
        const { aliases, id, name: displayName, lat, lon, pop, cc, a1 } = supplemental;
        const city = { id, name: displayName, lat, lon, pop, cc, a1 };
        for (const name of [city.name, ...aliases]) {
            for (const key of locationAliases(name)) register(cityCandidateMap, key, city);
        }
    }

    const admin1CandidateMap = new Map();
    for (const line of admin1Raw.split('\n')) {
        const [code, name, asciiName, rawId] = line.trim().split('\t');
        const id = Number(rawId);
        const centroid = admin1Centroids.get(code);
        if (!code || !name || !centroid || !Number.isInteger(id) || id <= 0) continue;
        const region = { id, name, code, lat: centroid.lat, lon: centroid.lon, cc: code.split('.')[0] };
        // A major city and its homonymous region are distinct entities. Keeping
        // both lets the resolver apply an explicit parent instead of losing it.
        for (const key of new Set([...locationAliases(name), ...locationAliases(asciiName || name)])) {
            register(admin1CandidateMap, key, region);
        }
    }

    const cities = Object.create(null);
    const cityCandidates = Object.create(null);
    const cityCandidateNames = Object.create(null);
    for (const [key, candidates] of cityCandidateMap) {
        const values = candidates.sort((a, b) => b.pop - a.pop || a.id - b.id);
        const val = values[0];
        cities[key] = { lat: roundCoordinate(val.lat), lon: roundCoordinate(val.lon), pop: val.pop, cc: val.cc, id: val.id, a1: val.a1 };
        for (const entry of values) {
            // The runtime can derive ordinary title case without another copy
            // of the name; retain native spelling and alias display differences.
            if (displayNameFromKey(key) !== entry.name) cityCandidateNames[entry.id.toString(36)] = entry.name;
        }
        if (values.length > 1) {
            cityCandidates[key] = values.map(entry => [entry.id.toString(36), roundCoordinate(entry.lat), roundCoordinate(entry.lon), entry.pop.toString(36), entry.cc, entry.a1].join(',')).join('|');
        }
    }

    const admin1 = Object.create(null);
    const admin1Meta = Object.create(null);
    const admin1Candidates = Object.create(null);
    const admin1CandidateNames = Object.create(null);
    for (const [key, values] of admin1CandidateMap) {
        const val = values[values.length - 1];
        admin1[key] = { lat: roundCoordinate(val.lat), lon: roundCoordinate(val.lon), cc: val.cc, id: val.id };
        admin1Meta[key] = val.code;
        for (const entry of values) {
            if (displayNameFromKey(key) !== entry.name) admin1CandidateNames[entry.id.toString(36)] = entry.name;
        }
        if (values.length > 1) {
            admin1Candidates[key] = values.map(entry => [entry.id.toString(36), roundCoordinate(entry.lat), roundCoordinate(entry.lon), entry.cc, entry.code].join(',')).join('|');
        }
    }

    const countries = Object.create(null);
    for (const [cc, entries] of Object.entries(COUNTRY_DATA)) {
        const canonicalName = entries[0][0];
        for (const [name, lat, lon] of entries) {
            for (const key of locationAliases(name)) countries[key] = { lat: roundCoordinate(lat), lon: roundCoordinate(lon), cc, name: canonicalName };
        }
    }

    const regions = Object.create(null);
    for (const region of supplements.regions || []) {
        const { aliases, id, name: displayName, type, lat, lon, cc, admin1Code } = region;
        const entry = { id, name: displayName, type, lat, lon, cc, admin1Code };
        for (const name of [entry.name, ...aliases]) {
            for (const key of locationAliases(name)) {
                const candidates = regions[key] || [];
                if (!candidates.some(candidate => candidate.id === entry.id)) candidates.push(entry);
                regions[key] = candidates;
            }
        }
    }

    const broadLandmarks = [...new Set((supplements.broadLandmarks || []).map(normalizeLocationKey))];
    return { cities, cityCandidates, cityCandidateNames, admin1, admin1Meta, admin1Candidates, admin1CandidateNames, countries, regions, broadLandmarks };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
    const output = buildGeodata(
        readFileSync(join(DATA_DIR, 'cities5000.txt'), 'utf-8'),
        readFileSync(join(DATA_DIR, 'admin1CodesASCII.txt'), 'utf-8'),
        JSON.parse(readFileSync(join(DATA_DIR, 'geodata-supplements.json'), 'utf-8')),
    );
    const serialized = JSON.stringify(output);
    const outPath = join(DATA_DIR, 'geonames.json');
    writeFileSync(outPath, serialized);
    console.log(`Wrote ${outPath} (${Math.round(Buffer.byteLength(serialized) / 1024)} KB)`);
    console.log(`${Object.keys(output.cities).length} city names, ${Object.keys(output.admin1).length} admin1 names, ${Object.keys(output.countries).length} country names, ${Object.keys(output.regions).length} regional names`);
}
