/*
  Geocoding Constants and Lookup Maps
  This file defines the static dictionaries and regex patterns used by the 
  geocoding engine to extract and resolve geographic locations from text.
  
  Contains manual overrides, demonym mappings, noise filters, and stop words
  optimized for international news and conflict reporting.
*/

/**
 * High-priority point-of-interest mapping.
 * Used for specific landmarks or regions that require precise coordinates 
 * not always found in standard city databases.
 */
export const LANDMARKS: Record<string, { lat: number; lon: number }> = {
    'pentagon': { lat: 38.87, lon: -77.06 }, 'white house': { lat: 38.90, lon: -77.04 },
    'kremlin': { lat: 55.75, lon: 37.62 }, 'vatican': { lat: 41.90, lon: 12.45 },
    'gaza city': { lat: 31.50, lon: 34.47 }, 'west bank': { lat: 31.95, lon: 35.23 },
    'brussels': { lat: 50.85, lon: 4.35 }, 'sicily': { lat: 37.60, lon: 14.01 },
    'bahrain': { lat: 26.07, lon: 50.55 }, 'minab': { lat: 27.15, lon: 57.08 },
    'yemen': { lat: 15.55, lon: 48.52 }, 'morocco': { lat: 31.79, lon: -7.09 },
    'crimea': { lat: 44.95, lon: 34.10 }, 'donbas': { lat: 48.00, lon: 37.80 },
    'kharkiv': { lat: 49.99, lon: 36.23 }, 'odesa': { lat: 46.48, lon: 30.73 },
    'mariupol': { lat: 47.10, lon: 37.55 }, 'kherson': { lat: 46.64, lon: 32.62 },
    'aleppo': { lat: 36.20, lon: 37.16 }, 'mosul': { lat: 36.34, lon: 43.12 },
    'rafah': { lat: 31.30, lon: 34.25 }, 'khan younis': { lat: 31.35, lon: 34.30 },
    'kyiv': { lat: 50.45, lon: 30.52 }, 'kiev': { lat: 50.45, lon: 30.52 },
    'washington dc': { lat: 38.91, lon: -77.04 },
    'washington': { lat: 38.91, lon: -77.04 },
    'mediterranean': { lat: 35.0, lon: 18.0 },
    'mediterranean sea': { lat: 35.0, lon: 18.0 },
    'caspian sea': { lat: 41.0, lon: 50.0 },
    'darfur': { lat: 13.5, lon: 24.0 },
    'north darfur': { lat: 15.5, lon: 25.0 },
    'kurdistan': { lat: 37.0, lon: 43.0 },
    'falkland islands': { lat: -51.7, lon: -59.0 },
    'falklands': { lat: -51.7, lon: -59.0 },
    'siberia': { lat: 60.0, lon: 105.0 },
    'isfahan': { lat: 32.65, lon: 51.66 },
    'esfahan': { lat: 32.65, lon: 51.66 },
    'middle east': { lat: 29.29, lon: 41.05 },
    'west asia': { lat: 29.29, lon: 41.05 },
    'sanaa': { lat: 15.35, lon: 44.21 }, "sana'a": { lat: 15.35, lon: 44.21 },
    'sana': { lat: 15.35, lon: 44.21 },
    'strait of hormuz': { lat: 26.57, lon: 56.25 },
    'suez canal': { lat: 30.46, lon: 32.35 },
    'bab el-mandeb': { lat: 12.58, lon: 43.33 },
    'taiwan strait': { lat: 24.00, lon: 119.00 },
    'strait of malacca': { lat: 2.50, lon: 101.50 },
    'south china sea': { lat: 12.00, lon: 113.00 },
    'black sea': { lat: 43.00, lon: 35.00 },
    'red sea': { lat: 20.00, lon: 38.50 },
    'baltic sea': { lat: 57.00, lon: 19.00 },
    'persian gulf': { lat: 26.00, lon: 51.00 },
    'amazon rainforest': { lat: -3.46, lon: -62.21 },
    'gaza': { lat: 31.5, lon: 34.45 },
    'golan heights': { lat: 33.00, lon: 35.75 },
    'arctic': { lat: 71.0, lon: 25.0 },
    'antarctic': { lat: -82.0, lon: 0.0 },
    'antarctica': { lat: -82.0, lon: 0.0 },
    'southeast asia': { lat: 5.0, lon: 110.0 },
    'west coast': { lat: 37.77, lon: -122.42 },
    'east coast': { lat: 40.71, lon: -74.01 },
    'northern israel': { lat: 32.95, lon: 35.53 },
    'southern israel': { lat: 30.85, lon: 34.75 },
    'central israel': { lat: 31.95, lon: 34.90 },
    'northern gaza': { lat: 31.55, lon: 34.50 },
    'southern gaza': { lat: 31.30, lon: 34.30 },
    'dr congo': { lat: -4.04, lon: 21.76 },
    'kiryat shmona': { lat: 33.21, lon: 35.57 },
    'qiryat shemona': { lat: 33.21, lon: 35.57 },
    /** conflict-relevant locations not in GeoNames cities5000 */
    'bint jbeil': { lat: 33.12, lon: 35.43 },
    'negev': { lat: 30.85, lon: 34.75 },
    'chernobyl': { lat: 51.27, lon: 30.22 },
    'bashkortostan': { lat: 54.23, lon: 56.06 },
    'hormuz': { lat: 26.57, lon: 56.25 },
    'jenin': { lat: 32.46, lon: 35.30 },
    'nablus': { lat: 32.22, lon: 35.26 },
    'ramallah': { lat: 31.90, lon: 35.20 },
    'zaporizhzhia': { lat: 47.84, lon: 35.14 },
    'zaporizhia': { lat: 47.84, lon: 35.14 },
    'mykolaiv': { lat: 46.97, lon: 31.99 },
    'sumy': { lat: 50.91, lon: 34.80 },
    'dnipro': { lat: 48.46, lon: 35.04 },
    'yerevan': { lat: 40.18, lon: 44.51 },
    'tbilisi': { lat: 41.69, lon: 44.83 },
    'aden': { lat: 12.78, lon: 45.03 },
    'hodeida': { lat: 14.80, lon: 42.95 },
    'hodeidah': { lat: 14.80, lon: 42.95 },
    'luhansk': { lat: 48.57, lon: 39.34 },
    'donetsk': { lat: 48.02, lon: 37.80 },
    'bakhmut': { lat: 48.60, lon: 38.00 },
    'avdiivka': { lat: 48.14, lon: 37.75 },
    'kharkiv oblast': { lat: 49.99, lon: 36.23 },
    'zaporizhzhia oblast': { lat: 47.84, lon: 35.14 },
    'kursk oblast': { lat: 51.73, lon: 36.19 },
    'belgorod oblast': { lat: 50.60, lon: 36.59 },
    'cherkasy oblast': { lat: 49.44, lon: 31.99 },
    'kharkov': { lat: 49.99, lon: 36.23 },
    'niger': { lat: 17.61, lon: 8.08 },
    'mali': { lat: 17.57, lon: -3.99 },
    'burkina faso': { lat: 12.36, lon: -1.53 },
    'sahel': { lat: 15.00, lon: 2.00 },
    /** islands and overseas territories */
    'bermuda': { lat: 32.32, lon: -64.76 },
    /** bodies of water and straits */
    'gulf of oman': { lat: 24.50, lon: 58.50 },
    /** conflict-zone towns in Lebanon */
    'qantara': { lat: 33.27, lon: 35.45 },
    'majdal zoun': { lat: 33.16, lon: 35.29 },
    'taybeh': { lat: 33.18, lon: 35.46 },
    'tiberias': { lat: 32.79, lon: 35.53 },
    'kostyantynivka': { lat: 48.52, lon: 37.70 },
    'cape verde': { lat: 16.53, lon: -23.04 },
    /** Northern Ireland towns */
    'dunmurry': { lat: 54.55, lon: -5.99 },
};

/**
 * Centroid coordinates for continents.
 * Used when only a continent is mentioned without more specific detail.
 */
export const CONTINENT_FALLBACKS: Record<string, { lat: number; lon: number }> = {
    'europe': { lat: 54.5, lon: 15.2 },
    'africa': { lat: 8.7, lon: 20.9 },
    'asia': { lat: 34.0, lon: 100.0 },
    'oceania': { lat: -25.0, lon: 135.0 },
    'north america': { lat: 40.0, lon: -100.0 },
    'south america': { lat: -15.0, lon: -60.0 },
};

export const CONTINENT_NAMES = new Set(Object.keys(CONTINENT_FALLBACKS));

/**
 * Maps adjectives describing people or things from a country to the canonical country name.
 * Essential for resolving phrases like "Russian forces" to Russia.
 */
export const DEMONYM_MAP: Record<string, string> = {
    'american': 'united states', 'chinese': 'china', 'russian': 'russia',
    'indian': 'india', 'japanese': 'japan', 'german': 'germany', 'deutschland': 'germany',
    'french': 'france', 'british': 'united kingdom', 'canadian': 'canada',
    'brazilian': 'brazil', 'australian': 'australia', 'mexican': 'mexico',
    'italian': 'italy', 'spanish': 'spain', 'korean': 'south korea',
    'iranian': 'iran', 'iraqi': 'iraq', 'syrian': 'syria',
    'turkish': 'turkey', 'israeli': 'israel', 'palestinian': 'palestine',
    'egyptian': 'egypt', 'saudi': 'saudi arabia', 'pakistani': 'pakistan',
    'afghan': 'afghanistan', 'nigerian': 'nigeria', 'kenyan': 'kenya',
    'ethiopian': 'ethiopia', 'sudanese': 'sudan', 'somali': 'somalia',
    'libyan': 'libya', 'yemeni': 'yemen', 'lebanese': 'lebanon',
    'jordanian': 'jordan', 'polish': 'poland', 'dutch': 'netherlands',
    'belgian': 'belgium', 'swedish': 'sweden', 'norwegian': 'norway',
    'danish': 'denmark', 'finnish': 'finland', 'greek': 'greece',
    'portuguese': 'portugal', 'swiss': 'switzerland', 'austrian': 'austria',
    'romanian': 'romania', 'hungarian': 'hungary', 'czech': 'czech republic',
    'indonesian': 'indonesia', 'filipino': 'philippines', 'vietnamese': 'vietnam',
    'thai': 'thailand', 'taiwanese': 'taiwan', 'malaysian': 'malaysia',
    'singaporean': 'singapore', 'argentinian': 'argentina', 'colombian': 'colombia',
    'chilean': 'chile', 'venezuelan': 'venezuela', 'peruvian': 'peru',
    'cuban': 'cuba', 'irish': 'ireland', 'scottish': 'scotland',
    'welsh': 'wales', 'moroccan': 'morocco', 'tunisian': 'tunisia',
    'algerian': 'algeria', 'ecuadorian': 'ecuador', 'bolivian': 'bolivia',
    'ukrainian': 'ukraine', 'georgian': 'georgia', 'armenian': 'armenia',
    'uruguayan': 'uruguay', 'paraguayan': 'paraguay', 'bahraini': 'bahrain',
    'qatari': 'qatar', 'kuwaiti': 'kuwait', 'omani': 'oman',
    'congolese': 'democratic republic of the congo', 'tanzanian': 'tanzania',
    'ugandan': 'uganda', 'rwandan': 'rwanda', 'cameroonian': 'cameroon',
    'senegalese': 'senegal', 'ghanaian': 'ghana', 'ivorian': 'ivory coast',
    'mozambican': 'mozambique', 'zimbabwean': 'zimbabwe', 'zambian': 'zambia',
    'namibian': 'namibia', 'botswanan': 'botswana', 'malawian': 'malawi',
    'nepalese': 'nepal', 'sri lankan': 'sri lanka', 'burmese': 'myanmar',
    'cambodian': 'cambodia', 'laotian': 'laos',
    'siberian': 'siberia', 'crimean': 'crimea', 'arctic': 'arctic',
    'antarctic': 'antarctica', 'caribbean': 'caribbean',
    'balkan': 'balkans', 'scandinavian': 'scandinavia',
    'bavarian': 'germany', 'catalan': 'spain', 'tibetan': 'china',
    'asian': 'asia', 'european': 'europe', 'african': 'africa',
};

/**
 * Resolution for common country abbreviations and regional aliases.
 */
export const COUNTRY_ABBREV_MAP: Record<string, string> = {
    'u.s.': 'united states', 'u.s.a.': 'united states', 'u.s': 'united states',
    'us': 'united states', 'america': 'united states',
    'u.k.': 'united kingdom', 'u.k': 'united kingdom', 'uk': 'united kingdom',
    'u.a.e.': 'united arab emirates', 'uae': 'united arab emirates',
    'u.n.': '__skip__',
    'e.u.': '__skip__',
    'eu': '__skip__',
    'd.c.': 'washington dc',
    'nk': 'north korea',
    'usa': 'united states', 'l.a.': 'los angeles', 'l.a': 'los angeles',
    'ca': 'california',
    'ny': 'new york',
    'nyc': 'new york',
    'tx': 'texas',
    'ga': 'georgia',
    'va': 'virginia',
    'fl': 'florida',
    'nj': 'new jersey', 'n.j.': 'new jersey', 'n.j': 'new jersey',
    'n.y.': 'new york', 'n.y': 'new york',
};

/**
 * Words commonly found in datelines that should be stripped to avoid
 * confusion with geographic locations.
 */
export const DATELINE_NOISE_WORDS = new Set([
    'live', 'updates', 'update', 'breaking', 'latest', 'analysis',
    'opinion', 'editorial', 'exclusive', 'recap', 'roundup', 'review',
    'briefing', 'explainer', 'report', 'summary', 'watch', 'alert',
    'blog', 'tracker', 'results', 'polls', 'podcast', 'newsletter',
    'centcom', 'eucom', 'africom', 'indopacom', 'southcom', 'northcom',
    'brief', 'briefing', 'coverage', 'thread', 'timeline',
]);

/**
 * General stop words that are frequently mistaken for locations
 * or add no geographic value to the extraction process.
 */
export const STOP_WORDS = new Set([
    'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august',
    'september', 'october', 'november', 'december', 'monday', 'tuesday',
    'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
    'spring', 'summer', 'fall', 'winter',
    'the', 'this', 'that', 'these', 'those', 'what', 'which', 'who', 'how',
    'just', 'new', 'more', 'most', 'some', 'many', 'much', 'its', 'his', 'her',
    'their', 'our', 'all', 'one', 'two', 'three', 'four', 'five',
    'congress', 'senate', 'parliament', 'reuters', 'associated',
    'press', 'exclusive', 'breaking', 'update', 'live', 'latest',
    'report', 'reports', 'analysis', 'opinion', 'editorial',
    'trump', 'biden', 'putin', 'modi', 'macron', 'scholz', 'zelenskyy',
    'zelensky', 'netanyahu', 'xi', 'obama', 'pope', 'elon', 'musk',
    'democrats', 'republicans', 'nato', 'opec', 'who', 'fbi', 'cia',
    'deal', 'record', 'back', 'first', 'second', 'third', 'over',
    'after', 'before', 'major', 'global', 'world', 'international',
    'north', 'south', 'east', 'west', 'northern', 'southern', 'eastern', 'western', 'central', 'says', 'say', 'said',
    'each', 'every', 'both', 'other', 'another', 'such',
    'high', 'higher', 'low', 'lower', 'big', 'small', 'long',
    'war', 'peace', 'crisis', 'today', 'yesterday', 'tomorrow',
    'government', 'president', 'minister', 'prime', 'general',
    'military', 'army', 'force', 'forces', 'troops', 'police',
    'court', 'supreme', 'justice', 'law', 'bill', 'act',
    'company', 'companies', 'stocks', 'market', 'markets',
    'people', 'officials', 'sources', 'leaders', 'workers',
    'nasa', 'esa', 'spacex', 'jaxa', 'isro', 'roscosmos',
    'un', 'united nations', 'imf', 'interpol',
    'centcom', 'eucom', 'africom', 'indopacom', 'southcom', 'northcom',
    'socom', 'transcom', 'stratcom', 'cybercom', 'spacecom',
    'moon', 'sun', 'venus', 'mars', 'jupiter', 'saturn', 'mercury',
    'neptune', 'uranus', 'pluto', 'earth', 'lunar', 'solar',
    'asteroid', 'comet', 'nebula', 'galaxy', 'orbit', 'spacecraft',
    'island', 'islands', 'peninsula', 'continent', 'region', 'area',
    'coast', 'mountain', 'river', 'lake', 'ocean', 'sea', 'bay', 'gulf',
    'morning', 'evening', 'daily', 'weekly', 'year', 'war', 'spring',
    'ray', 'categorized', 'classified', 'unclassified', 'secret', 'top secret',
    'confirmed', 'unconfirmed', 'verified', 'unverified',
    'footage', 'video', 'photo', 'image', 'satellite',
    'ambassador', 'envoy', 'diplomat', 'official', 'minister',
    'talks', 'negotiations', 'ceasefire', 'truce', 'peace',
    'deal', 'agreement', 'framework', 'outline',
    'sirens', 'missile', 'rocket', 'drone', 'uav',
    'interdicted', 'seized', 'captured', 'sunk', 'intercepted',
    'university', 'student', 'students', 'professor', 'faculty', 'campus',
]);

/**
 * Specific names or phrases that trigger geographic matches but are almost 
 * always used in a non-geographic context in news headlines.
 */
export const FALSE_POSITIVES = new Set([
    'date', 'blair', 'tufts', 'tufts university',
    'the atlantic', 'turning point usa', "america's pastime", 'federal',
    'paris hilton', 'jackson hole', 'georgia tech',
    'chelsea clinton', 'chelsea handler', 'virginia woolf',
    'arsenal', 'chelsea fc', 'manchester united', 'manchester city',
    'real madrid', 'bayern munich', 'juventus', 'napoli',
    'tottenham', 'everton', 'wolverhampton', 'newcastle united',
    'amazon', 'apple', 'oracle', 'adobe', 'cisco',
    'liveuamap', 'nitter', 'osint',
    'geoconfirmed', 'intelcrab', 'auroraintel', 'osinttechnical',
    'research roundup', 'audio long read', 'author correction',
    'weekend of war', 'morning edition', 'evening update',
    'daily briefing', 'weekly roundup', 'year in review',
    'gulf war', 'cold war', 'world war', 'civil war', 'arab spring',
    'iron dome', 'iron curtain', 'enterprise software', 'morning report',
    'evening report', 'special report', 'market update', 'daily dispatch',
    'breaking news', 'live coverage', 'press release', 'intelligence brief',
    'nine', 'union', 'claudia', 'victor', 'corona', 'lima bean',
    'independence', 'liberty', 'justice', 'hope', 'faith', 'harmony',
    'florence nightingale', 'victoria sponge', 'palm beaches',
    'uss indianapolis', 'uss carney', 'uss gerald r ford', 'uss eisenhower',
    'hms diamond', 'hms queen elizabeth', 'hms prince of wales',
    'man', 'king', 'buy', 'poll', 'powell', 'blackrock', 'pentagon',
    'nako', 'victoria', 'usa', 'real', 'charlotte', 'murphy', 'bar', 'ray', 'chamber', 'valverde',
    'can', 'meta', 'sam', 'post', 'battle', 'eagle', 'enterprise',
    'nigel', 'kim', 'pacific', 'aung san', 'golders green',
    'sanchez', 'harvard', 'irani', 'free',
    // Names and brands that repeatedly collide with place records. Precision wins:
    // a true event location needs context beyond these bare terms.
    'brooks', 'saba', 'hilton', 'lalo', 'best', 'new horizons',
    'konstantinovka', 'hawthorne',
]);

/**
 * Keywords that identify global superpowers, used for weighted scoring
 * in geographic resolution.
 */
export const SUPERPOWER_KEYS = new Set(['united states', 'united kingdom', 'washington', 'washington dc', 'china', 'russia', 'iran', 'beijing', 'moscow', 'tehran']);

/**
 * High-priority manual overrides for common geographic naming collisions.
 * Checked before general dictionary lookup to resolve ambiguity.
 * Example: Georgia is prioritized as a country rather than the US state.
 */
export const OVERRIDE_LOCATIONS: Record<string, { lat: number; lon: number; type: 'country' | 'admin1' | 'city' }> = {
    'georgia': { lat: 42.3154, lon: 43.3569, type: 'country' },
    'ocean county': { lat: 39.87, lon: -74.26, type: 'admin1' },
    'launceston': { lat: -41.43, lon: 147.14, type: 'city' },
    'san nicolas': { lat: 25.75, lon: -100.30, type: 'city' },
    'kennedy space center': { lat: 28.57, lon: -80.65, type: 'city' },
    'east rutherford': { lat: 40.83, lon: -74.10, type: 'city' },
    'minneapolis': { lat: 44.98, lon: -93.27, type: 'city' },
    'london': { lat: 51.51, lon: -0.13, type: 'city' },
};

/** 
 * Regex patterns for pre-processing text to remove non-geographic noise.
 */

/** Strips common media outlet names from the end of headlines */
export const MEDIA_ATTRIBUTION_SUFFIX = /\s*[-–—|]\s*(?:BBC|CNN|Reuters|AP|AFP|Al Jazeera|Fox News|NBC|CBS|ABC|NPR|Guardian|Telegraph|NYT|New York Times|Washington Post|Wall Street Journal|WaPo|WSJ|Financial Times|FT|Bloomberg|Politico|The Hill|Axios|Vox|Vice|BuzzFeed|Daily Mail|Daily Mirror|The Sun|Sky News|DW|Deutsche Welle|France 24|RFI|SCMP|South China Morning Post|Haaretz|Times of Israel|Jerusalem Post|Arab News|Middle East Eye|Al Monitor|Al-Monitor|Bellingcat|Coda Story|RFERL|Radio Free Europe|Radio Liberty|War on the Rocks|Geopolitical Futures|OSINTdefender|IntelSlava|liveukraine_media|Defence One|Defense One|thecradle|Philenews|airlive|Marine Insight|BulgarianMilitary|Yahoo|MSN|Brucke|Ukrinform|Ukrainska Pravda|Kyiv Independent|UNIAN|Sky News Arabia|Al Arabiya English|Al Arabiya|Press TV|PressTV|Tasnim|IRNA|Mehr News|Newsweek|Time Magazine|The Atlantic|Foreign Policy|Foreign Affairs|Chatham House|ISW|Institute for the Study of War|War Monitor|Military Summary|The Drive|The Aviationist|Jane|Janes|PopularMechanics|Popular Mechanics|Wired|Ars Technica|The Verge|TechCrunch|Engadget|9to5Mac|MacRumors)\s*$/;

/** Removes social media calls to action and subscription links */
export const SOCIAL_MEDIA_TRAILER = /(?:Subscribe to @\S+|Subscribe to Live:\s*\S+|Subscribe here:\s*\S+|🪐\s*Subscribe|Follow us|Join our|Telegram|t\.me|Links:\s|@\w+\s*Chat room|appeared first on).*/i;

/** Corrects fused hashtags that combine an acronym and a full name */
export const HASHTAG_FUSED_PATTERN = /#([A-Z]{1,4})([A-Z][a-z])/g;

/** Identifies administrative region suffixes in multiple languages */
export const ADMIN_SUFFIX_PATTERN = /\b(Oblast|Region|Province|District|Prefecture|County|Governorate|Emirate|Wilayah|Krai|Raion|Republic)\b/gi;
