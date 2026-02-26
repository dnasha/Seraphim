import { NewsItem } from './types';
import nlp from 'compromise';

// cache geocode promises to dedupe concurrent requests for the same place
const geoCache = new Map<string, Promise<{ lat: number; lon: number; displayName: string } | null>>();

// dictionary of countries, capitals, and major cities for instant coordinate lookup
const KNOWN_LOCATIONS: Record<string, { lat: number; lon: number }> = {
    // countries
    'ukraine': { lat: 48.38, lon: 31.17 }, 'russia': { lat: 61.52, lon: 105.32 },
    'china': { lat: 35.86, lon: 104.20 }, 'india': { lat: 20.59, lon: 78.96 },
    'japan': { lat: 36.20, lon: 138.25 }, 'germany': { lat: 51.17, lon: 10.45 },
    'france': { lat: 46.23, lon: 2.21 }, 'united kingdom': { lat: 55.38, lon: -3.44 },
    'uk': { lat: 55.38, lon: -3.44 }, 'britain': { lat: 55.38, lon: -3.44 },
    'united states': { lat: 37.09, lon: -95.71 }, 'us': { lat: 37.09, lon: -95.71 },
    'usa': { lat: 37.09, lon: -95.71 }, 'canada': { lat: 56.13, lon: -106.35 },
    'brazil': { lat: -14.24, lon: -51.93 }, 'australia': { lat: -25.27, lon: 133.78 },
    'mexico': { lat: 23.63, lon: -102.55 }, 'italy': { lat: 41.87, lon: 12.57 },
    'spain': { lat: 40.46, lon: -3.75 }, 'south korea': { lat: 35.91, lon: 127.77 },
    'north korea': { lat: 40.34, lon: 127.51 }, 'iran': { lat: 32.43, lon: 53.69 },
    'iraq': { lat: 33.22, lon: 43.68 }, 'syria': { lat: 34.80, lon: 38.99 },
    'turkey': { lat: 38.96, lon: 35.24 }, 'israel': { lat: 31.05, lon: 34.85 },
    'palestine': { lat: 31.95, lon: 35.23 }, 'gaza': { lat: 31.35, lon: 34.31 },
    'egypt': { lat: 26.82, lon: 30.80 }, 'saudi arabia': { lat: 23.89, lon: 45.08 },
    'pakistan': { lat: 30.38, lon: 69.35 }, 'afghanistan': { lat: 33.94, lon: 67.71 },
    'nigeria': { lat: 9.08, lon: 8.68 }, 'south africa': { lat: -30.56, lon: 22.94 },
    'kenya': { lat: -0.02, lon: 37.91 }, 'ethiopia': { lat: 9.15, lon: 40.49 },
    'sudan': { lat: 12.86, lon: 30.22 }, 'congo': { lat: -4.04, lon: 21.76 },
    'somalia': { lat: 5.15, lon: 46.20 }, 'libya': { lat: 26.34, lon: 17.23 },
    'yemen': { lat: 15.55, lon: 48.52 }, 'lebanon': { lat: 33.85, lon: 35.86 },
    'jordan': { lat: 30.59, lon: 36.24 }, 'poland': { lat: 51.92, lon: 19.15 },
    'netherlands': { lat: 52.13, lon: 5.29 }, 'belgium': { lat: 50.50, lon: 4.47 },
    'sweden': { lat: 60.13, lon: 18.64 }, 'norway': { lat: 60.47, lon: 8.47 },
    'denmark': { lat: 56.26, lon: 9.50 }, 'finland': { lat: 61.92, lon: 25.75 },
    'greece': { lat: 39.07, lon: 21.82 }, 'portugal': { lat: 39.40, lon: -8.22 },
    'switzerland': { lat: 46.82, lon: 8.23 }, 'austria': { lat: 47.52, lon: 14.55 },
    'romania': { lat: 45.94, lon: 24.97 }, 'hungary': { lat: 47.16, lon: 19.50 },
    'czech republic': { lat: 49.82, lon: 15.47 }, 'czechia': { lat: 49.82, lon: 15.47 },
    'indonesia': { lat: -0.79, lon: 113.92 }, 'philippines': { lat: 12.88, lon: 121.77 },
    'vietnam': { lat: 14.06, lon: 108.28 }, 'thailand': { lat: 15.87, lon: 100.99 },
    'myanmar': { lat: 21.91, lon: 95.96 }, 'taiwan': { lat: 23.70, lon: 120.96 },
    'malaysia': { lat: 4.21, lon: 101.98 }, 'singapore': { lat: 1.35, lon: 103.82 },
    'argentina': { lat: -38.42, lon: -63.62 }, 'colombia': { lat: 4.57, lon: -74.30 },
    'chile': { lat: -35.68, lon: -71.54 }, 'venezuela': { lat: 6.42, lon: -66.59 },
    'peru': { lat: -9.19, lon: -75.02 }, 'cuba': { lat: 21.52, lon: -77.78 },
    'new zealand': { lat: -40.90, lon: 174.89 }, 'ireland': { lat: 53.14, lon: -7.69 },
    'scotland': { lat: 56.49, lon: -4.20 }, 'wales': { lat: 52.13, lon: -3.78 },
    'morocco': { lat: 31.79, lon: -7.09 }, 'tunisia': { lat: 33.89, lon: 9.54 },
    'algeria': { lat: 28.03, lon: 1.66 }, 'ecuador': { lat: -1.83, lon: -78.18 },
    'bolivia': { lat: -16.29, lon: -63.59 }, 'paraguay': { lat: -23.44, lon: -58.44 },
    'uruguay': { lat: -32.52, lon: -55.77 }, 'costa rica': { lat: 9.75, lon: -83.75 },
    'panama': { lat: 8.54, lon: -80.78 }, 'guatemala': { lat: 15.78, lon: -90.23 },
    'honduras': { lat: 15.20, lon: -86.24 }, 'el salvador': { lat: 13.79, lon: -88.90 },
    'nicaragua': { lat: 12.87, lon: -85.21 }, 'haiti': { lat: 18.97, lon: -72.29 },
    'dominican republic': { lat: 18.74, lon: -70.16 }, 'jamaica': { lat: 18.11, lon: -77.30 },
    'sri lanka': { lat: 7.87, lon: 80.77 }, 'nepal': { lat: 28.39, lon: 84.12 },
    'bangladesh': { lat: 23.68, lon: 90.36 }, 'cambodia': { lat: 12.57, lon: 104.99 },
    'laos': { lat: 19.86, lon: 102.50 }, 'mongolia': { lat: 46.86, lon: 103.85 },
    'uzbekistan': { lat: 41.38, lon: 64.59 }, 'kazakhstan': { lat: 48.02, lon: 66.92 },
    'georgia': { lat: 42.32, lon: 43.36 }, 'armenia': { lat: 40.07, lon: 45.04 },
    'azerbaijan': { lat: 40.14, lon: 47.58 },
    // major cities
    'washington': { lat: 38.91, lon: -77.04 }, 'washington dc': { lat: 38.91, lon: -77.04 },
    'new york': { lat: 40.71, lon: -74.01 }, 'los angeles': { lat: 34.05, lon: -118.24 },
    'chicago': { lat: 41.88, lon: -87.63 }, 'houston': { lat: 29.76, lon: -95.37 },
    'london': { lat: 51.51, lon: -0.13 }, 'paris': { lat: 48.86, lon: 2.35 },
    'berlin': { lat: 52.52, lon: 13.41 }, 'madrid': { lat: 40.42, lon: -3.70 },
    'rome': { lat: 41.90, lon: 12.50 }, 'moscow': { lat: 55.76, lon: 37.62 },
    'kyiv': { lat: 50.45, lon: 30.52 }, 'kiev': { lat: 50.45, lon: 30.52 },
    'beijing': { lat: 39.90, lon: 116.41 }, 'shanghai': { lat: 31.23, lon: 121.47 },
    'tokyo': { lat: 35.68, lon: 139.69 }, 'delhi': { lat: 28.70, lon: 77.10 },
    'mumbai': { lat: 19.08, lon: 72.88 }, 'new delhi': { lat: 28.61, lon: 77.21 },
    'cairo': { lat: 30.04, lon: 31.24 }, 'tehran': { lat: 35.69, lon: 51.39 },
    'baghdad': { lat: 33.31, lon: 44.37 }, 'damascus': { lat: 33.51, lon: 36.29 },
    'jerusalem': { lat: 31.77, lon: 35.23 }, 'tel aviv': { lat: 32.09, lon: 34.78 },
    'riyadh': { lat: 24.69, lon: 46.72 }, 'dubai': { lat: 25.20, lon: 55.27 },
    'istanbul': { lat: 41.01, lon: 28.98 }, 'ankara': { lat: 39.93, lon: 32.87 },
    'kabul': { lat: 34.53, lon: 69.17 }, 'islamabad': { lat: 33.69, lon: 73.04 },
    'seoul': { lat: 37.57, lon: 126.98 }, 'pyongyang': { lat: 39.04, lon: 125.76 },
    'taipei': { lat: 25.03, lon: 121.57 }, 'hong kong': { lat: 22.32, lon: 114.17 },
    'bangkok': { lat: 13.76, lon: 100.50 }, 'hanoi': { lat: 21.03, lon: 105.85 },
    'jakarta': { lat: -6.21, lon: 106.85 }, 'manila': { lat: 14.60, lon: 120.98 },
    'nairobi': { lat: -1.29, lon: 36.82 }, 'lagos': { lat: 6.52, lon: 3.38 },
    'johannesburg': { lat: -26.20, lon: 28.05 }, 'cape town': { lat: -33.93, lon: 18.42 },
    'addis ababa': { lat: 9.02, lon: 38.75 }, 'khartoum': { lat: 15.50, lon: 32.56 },
    'tripoli': { lat: 32.89, lon: 13.18 }, 'beirut': { lat: 33.89, lon: 35.50 },
    'buenos aires': { lat: -34.60, lon: -58.38 }, 'sao paulo': { lat: -23.55, lon: -46.63 },
    'mexico city': { lat: 19.43, lon: -99.13 }, 'bogota': { lat: 4.71, lon: -74.07 },
    'lima': { lat: -12.05, lon: -77.04 }, 'havana': { lat: 23.11, lon: -82.37 },
    'ottawa': { lat: 45.42, lon: -75.70 }, 'toronto': { lat: 43.65, lon: -79.38 },
    'sydney': { lat: -33.87, lon: 151.21 }, 'melbourne': { lat: -37.81, lon: 144.96 },
    'brussels': { lat: 50.85, lon: 4.35 }, 'amsterdam': { lat: 52.37, lon: 4.90 },
    'vienna': { lat: 48.21, lon: 16.37 }, 'warsaw': { lat: 52.23, lon: 21.01 },
    'bucharest': { lat: 44.43, lon: 26.10 }, 'budapest': { lat: 47.50, lon: 19.04 },
    'prague': { lat: 50.08, lon: 14.44 }, 'stockholm': { lat: 59.33, lon: 18.07 },
    'oslo': { lat: 59.91, lon: 10.75 }, 'copenhagen': { lat: 55.68, lon: 12.57 },
    'helsinki': { lat: 60.17, lon: 24.94 }, 'athens': { lat: 37.98, lon: 23.73 },
    'lisbon': { lat: 38.72, lon: -9.14 }, 'zurich': { lat: 47.38, lon: 8.54 },
    'geneva': { lat: 46.20, lon: 6.14 }, 'dublin': { lat: 53.35, lon: -6.26 },
    'san francisco': { lat: 37.77, lon: -122.42 }, 'seattle': { lat: 47.61, lon: -122.33 },
    'boston': { lat: 42.36, lon: -71.06 }, 'miami': { lat: 25.76, lon: -80.19 },
    'atlanta': { lat: 33.75, lon: -84.39 }, 'denver': { lat: 39.74, lon: -104.99 },
    'dallas': { lat: 32.78, lon: -96.80 }, 'phoenix': { lat: 33.45, lon: -112.07 },
    'detroit': { lat: 42.33, lon: -83.05 }, 'philadelphia': { lat: 39.95, lon: -75.17 },
    'pentagon': { lat: 38.87, lon: -77.06 }, 'white house': { lat: 38.90, lon: -77.04 },
    'kremlin': { lat: 55.75, lon: 37.62 }, 'vatican': { lat: 41.90, lon: 12.45 },
    'gaza city': { lat: 31.50, lon: 34.47 }, 'west bank': { lat: 31.95, lon: 35.23 },
    'crimea': { lat: 44.95, lon: 34.10 }, 'donbas': { lat: 48.00, lon: 37.80 },
    'kharkiv': { lat: 49.99, lon: 36.23 }, 'odesa': { lat: 46.48, lon: 30.73 },
    'mariupol': { lat: 47.10, lon: 37.55 }, 'kherson': { lat: 46.64, lon: 32.62 },
    'aleppo': { lat: 36.20, lon: 37.16 }, 'mosul': { lat: 36.34, lon: 43.12 },
    'rafah': { lat: 31.30, lon: 34.25 }, 'khan younis': { lat: 31.35, lon: 34.30 },
    'medellin': { lat: 6.25, lon: -75.56 }, 'cali': { lat: 3.45, lon: -76.52 },
    'cartagena': { lat: 10.39, lon: -75.51 }, 'quito': { lat: -0.18, lon: -78.47 },
    'caracas': { lat: 10.48, lon: -66.90 }, 'santiago': { lat: -33.45, lon: -70.67 },
    'montevideo': { lat: -34.91, lon: -56.16 }, 'asuncion': { lat: -25.26, lon: -57.58 },
    'tbilisi': { lat: 41.72, lon: 44.79 }, 'yerevan': { lat: 40.18, lon: 44.51 },
    'minsk': { lat: 53.90, lon: 27.57 }, 'dhaka': { lat: 23.81, lon: 90.41 },
    'kathmandu': { lat: 27.72, lon: 85.32 }, 'colombo': { lat: 6.93, lon: 79.85 },
    'phnom penh': { lat: 11.56, lon: 104.92 }, 'yangon': { lat: 16.87, lon: 96.20 },
};

// set of all known country names for disambiguation
const COUNTRY_NAMES = new Set([
    'ukraine', 'russia', 'china', 'india', 'japan', 'germany', 'france',
    'united kingdom', 'uk', 'britain', 'united states', 'us', 'usa',
    'canada', 'brazil', 'australia', 'mexico', 'italy', 'spain',
    'south korea', 'north korea', 'iran', 'iraq', 'syria', 'turkey',
    'israel', 'palestine', 'egypt', 'saudi arabia', 'pakistan', 'afghanistan',
    'nigeria', 'south africa', 'kenya', 'ethiopia', 'sudan', 'congo',
    'somalia', 'libya', 'yemen', 'lebanon', 'jordan', 'poland',
    'netherlands', 'belgium', 'sweden', 'norway', 'denmark', 'finland',
    'greece', 'portugal', 'switzerland', 'austria', 'romania', 'hungary',
    'czech republic', 'czechia', 'indonesia', 'philippines', 'vietnam',
    'thailand', 'myanmar', 'taiwan', 'malaysia', 'singapore', 'argentina',
    'colombia', 'chile', 'venezuela', 'peru', 'cuba', 'new zealand',
    'ireland', 'scotland', 'wales', 'morocco', 'tunisia', 'algeria',
    'ecuador', 'bolivia', 'paraguay', 'uruguay', 'costa rica', 'panama',
    'guatemala', 'honduras', 'el salvador', 'nicaragua', 'haiti',
    'dominican republic', 'jamaica', 'sri lanka', 'nepal', 'bangladesh',
    'cambodia', 'laos', 'mongolia', 'uzbekistan', 'kazakhstan',
    'georgia', 'armenia', 'azerbaijan', 'gaza',
]);

// regex patterns to pull "in Place", "from Place", etc. from headlines
const LOCATION_PATTERNS = [
    /\bin\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){0,3})/g,
    /\bfrom\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){0,3})/g,
    /\bnear\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){0,3})/g,
    /\bacross\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){0,3})/g,
    /\bhits?\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){0,3})/g,
    /\bstrikes?\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){0,3})/g,
];

// words that regex might catch but aren't locations
const STOP_WORDS = new Set([
    'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august',
    'september', 'october', 'november', 'december', 'monday', 'tuesday',
    'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'the', 'this',
    'that', 'these', 'those', 'what', 'which', 'who', 'how', 'just',
    'new', 'more', 'most', 'some', 'many', 'much', 'its', 'his', 'her',
    'their', 'our', 'all', 'one', 'two', 'three', 'four', 'five',
    'congress', 'senate', 'parliament', 'reuters', 'associated',
    'press', 'exclusive', 'breaking', 'update', 'live', 'latest',
]);

// given a multi-word candidate like "British Columbia", check if any suffix
// (e.g. "Columbia" or "Colombia") is a known country/city in the dictionary.
// prefer the full match if it's in the dictionary, otherwise try shorter suffixes.
function disambiguate(candidate: string): string {
    const key = candidate.toLowerCase().trim();

    // full phrase is in dictionary — use it as-is
    if (KNOWN_LOCATIONS[key]) return candidate;

    // check if a single word in the phrase is a known country (e.g. "Colombia" from "British Colombia")
    const words = candidate.split(/\s+/);
    for (let i = 1; i < words.length; i++) {
        const suffix = words.slice(i).join(' ');
        const suffixKey = suffix.toLowerCase();
        if (KNOWN_LOCATIONS[suffixKey]) return suffix;
    }

    // no disambiguation needed
    return candidate;
}

// try regex patterns first, then fall back to compromise nlp
export function extractLocation(title: string, description: string): string | null {
    // regex pass on title first (most reliable)
    for (const pattern of LOCATION_PATTERNS) {
        pattern.lastIndex = 0;
        const match = pattern.exec(title);
        if (match) {
            const candidate = match[1].trim();
            if (!STOP_WORDS.has(candidate.toLowerCase()) && candidate.length > 2) {
                return disambiguate(candidate);
            }
        }
    }

    // regex pass on description
    for (const pattern of LOCATION_PATTERNS) {
        pattern.lastIndex = 0;
        const match = pattern.exec(description);
        if (match) {
            const candidate = match[1].trim();
            if (!STOP_WORDS.has(candidate.toLowerCase()) && candidate.length > 2) {
                return disambiguate(candidate);
            }
        }
    }

    // nlp fallback — also disambiguate the result
    const titlePlaces = nlp(title).places().out('array');
    if (titlePlaces && titlePlaces.length > 0) return disambiguate(titlePlaces[0]);

    const descPlaces = nlp(description).places().out('array');
    if (descPlaces && descPlaces.length > 0) return disambiguate(descPlaces[0]);

    return null;
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// try the local dictionary first, hit nominatim only if needed
export async function geocodeLocation(
    placeName: string
): Promise<{ lat: number; lon: number; displayName: string } | null> {
    const key = placeName.toLowerCase().trim();

    // instant dictionary lookup
    const known = KNOWN_LOCATIONS[key];
    if (known) {
        return { lat: known.lat, lon: known.lon, displayName: placeName };
    }

    if (geoCache.has(key)) {
        return geoCache.get(key)!;
    }

    const geocodePromise = (async () => {
        try {
            // if the name matches a known country, bias nominatim toward countries
            const isCountry = COUNTRY_NAMES.has(key);
            const featureParam = isCountry ? '&featuretype=country' : '';
            const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(placeName)}&format=json&limit=1${featureParam}`;

            const res = await fetch(url, {
                headers: { 'User-Agent': 'Seraphim/1.0' },
            });

            if (!res.ok) return null;

            const data = await res.json();
            if (!data || data.length === 0) return null;

            return {
                lat: parseFloat(data[0].lat),
                lon: parseFloat(data[0].lon),
                displayName: data[0].display_name as string,
            };
        } catch (err) {
            console.error(`geocoding failed for "${placeName}":`, err);
            return null;
        }
    })();

    geoCache.set(key, geocodePromise);
    return geocodePromise;
}

// enrich news items with lat/lng, respecting nominatim rate limits
export async function enrichItemsWithLocation(items: NewsItem[]): Promise<NewsItem[]> {
    const enriched: NewsItem[] = [];

    for (const item of items) {
        if (item.latitude !== undefined && item.longitude !== undefined) {
            enriched.push(item);
            continue;
        }

        const placeName = extractLocation(item.title, item.description);
        if (!placeName) {
            enriched.push(item);
            continue;
        }

        const key = placeName.toLowerCase().trim();
        const isDictionaryHit = KNOWN_LOCATIONS[key] !== undefined;
        const isCached = geoCache.has(key);

        const geo = await geocodeLocation(placeName);

        // only sleep when we actually hit the nominatim api
        if (!isDictionaryHit && !isCached) {
            await sleep(250);
        }

        if (geo) {
            enriched.push({
                ...item,
                latitude: geo.lat,
                longitude: geo.lon,
                locationName: placeName,
            });
        } else {
            enriched.push(item);
        }
    }

    return enriched;
}
