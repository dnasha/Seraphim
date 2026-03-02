#!/usr/bin/env node
/**
 * build-geodata.mjs
 * 
 * Parses GeoNames data files (cities5000.txt, admin1CodesASCII.txt) and
 * produces a compact data/geonames.json with population-weighted cities,
 * admin1 regions, and a comprehensive list of all countries.
 * 
 * Run: node scripts/build-geodata.mjs
 */

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');

// ── Comprehensive ISO 3166-1 alpha-2 → Country name(s) mapping ──────────────
// Maps every country code to an array of [name, lat, lon] entries.
// Coordinates are canonical centroids for each country.
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
    'CD': [['democratic republic of the congo', -4.04, 21.76], ['congo', -4.04, 21.76], ['drc', -4.04, 21.76]],
    'CF': [['central african republic', 6.61, 20.94]],
    'CG': [['republic of the congo', -0.23, 15.83]],
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
    // Territories / regions often in news
    'HK': [['hong kong', 22.32, 114.17]],
    'PR': [['puerto rico', 18.22, -66.59]],
    'GZ': [['gaza', 31.35, 34.31]],
};

// ── Parse cities5000.txt ────────────────────────────────────────────────────
console.log('Reading cities5000.txt...');
const citiesRaw = readFileSync(join(DATA_DIR, 'cities5000.txt'), 'utf-8');
const citiesLines = citiesRaw.split('\n').filter(l => l.trim());

const cityMap = new Map();
const admin1Centroids = new Map();

for (const line of citiesLines) {
    const cols = line.split('\t');
    if (cols.length < 15) continue;

    const name = (cols[1] || '').trim();
    const asciiName = (cols[2] || '').trim();
    const lat = parseFloat(cols[4]);
    const lon = parseFloat(cols[5]);
    const countryCode = (cols[8] || '').trim();
    const admin1Code = (cols[10] || '').trim();
    const population = parseInt(cols[14], 10) || 0;

    if (!name || name.length <= 2 || isNaN(lat) || isNaN(lon)) continue;

    const key = (asciiName || name).toLowerCase();

    const existing = cityMap.get(key);
    if (!existing || population > existing.pop) {
        cityMap.set(key, { lat, lon, pop: population, cc: countryCode });
    }

    const nameKey = name.toLowerCase();
    if (nameKey !== key) {
        const existingName = cityMap.get(nameKey);
        if (!existingName || population > existingName.pop) {
            cityMap.set(nameKey, { lat, lon, pop: population, cc: countryCode });
        }
    }

    if (admin1Code) {
        const a1key = `${countryCode}.${admin1Code}`;
        const existA1 = admin1Centroids.get(a1key);
        if (!existA1 || population > existA1.pop) {
            admin1Centroids.set(a1key, { lat, lon, pop: population });
        }
    }
}

console.log(`  Parsed ${cityMap.size} unique city names`);

// ── Parse admin1CodesASCII.txt ──────────────────────────────────────────────
console.log('Reading admin1CodesASCII.txt...');
const admin1Raw = readFileSync(join(DATA_DIR, 'admin1CodesASCII.txt'), 'utf-8');
const admin1Lines = admin1Raw.split('\n').filter(l => l.trim());

const admin1Map = new Map();

for (const line of admin1Lines) {
    const cols = line.split('\t');
    if (cols.length < 3) continue;

    const code = (cols[0] || '').trim();
    const name = (cols[1] || '').trim();
    const asciiName = (cols[2] || '').trim();

    if (!code || !name) continue;

    const countryCode = code.split('.')[0];
    const centroid = admin1Centroids.get(code);
    if (!centroid) continue;

    const key = (asciiName || name).toLowerCase();

    // Don't overwrite a very large city with an admin1 region
    const existingCity = cityMap.get(key);
    if (existingCity && existingCity.pop > 500000) continue;

    admin1Map.set(key, { lat: centroid.lat, lon: centroid.lon, cc: countryCode, name });

    const nameKey = name.toLowerCase();
    if (nameKey !== key) {
        const existingCity2 = cityMap.get(nameKey);
        if (!existingCity2 || existingCity2.pop <= 500000) {
            admin1Map.set(nameKey, { lat: centroid.lat, lon: centroid.lon, cc: countryCode, name });
        }
    }
}

console.log(`  Parsed ${admin1Map.size} admin1 regions`);

// ── Build countries from comprehensive mapping ──────────────────────────────
console.log('Building country data...');
const countriesOut = {};
let countryCount = 0;

for (const [cc, entries] of Object.entries(COUNTRY_DATA)) {
    for (const [name, lat, lon] of entries) {
        if (name.length <= 2) continue;
        countriesOut[name] = { lat: Math.round(lat * 100) / 100, lon: Math.round(lon * 100) / 100, cc };
        countryCount++;
    }
}

console.log(`  ${countryCount} country name entries`);

// ── Build output ────────────────────────────────────────────────────────────
const cities = {};
for (const [key, val] of cityMap.entries()) {
    if (key.length <= 2) continue;
    cities[key] = { lat: Math.round(val.lat * 100) / 100, lon: Math.round(val.lon * 100) / 100, pop: val.pop, cc: val.cc };
}

const admin1 = {};
for (const [key, val] of admin1Map.entries()) {
    if (key.length <= 2) continue;
    admin1[key] = { lat: Math.round(val.lat * 100) / 100, lon: Math.round(val.lon * 100) / 100, cc: val.cc };
}

const output = { cities, admin1, countries: countriesOut };
const outPath = join(DATA_DIR, 'geonames.json');
writeFileSync(outPath, JSON.stringify(output));

const sizeKB = Math.round(readFileSync(outPath).length / 1024);
console.log(`\nWrote ${outPath} (${sizeKB} KB)`);
console.log(`  ${Object.keys(cities).length} cities, ${Object.keys(admin1).length} admin1 regions, ${Object.keys(countriesOut).length} country names`);
