# Seraphim — Project Knowledge

## What Is This?

Seraphim is a real-time OSINT news aggregator that geocodes headlines and plots them on an interactive world map. It pulls articles from RSS feeds and the GNews API, extracts geographic locations from the text using NLP + regex heuristics, and displays everything in a Leaflet/OpenStreetMap map with a filterable sidebar.

## Tech Stack

| Layer              | Technology                                                                              |
| ------------------ | --------------------------------------------------------------------------------------- |
| Framework          | **Next.js 16** (App Router)                                                             |
| Language           | **TypeScript**                                                                          |
| Frontend           | **React 19**, vanilla CSS (no Tailwind)                                                 |
| Map                | **Leaflet 1.9** + **react-leaflet 5** on **OpenStreetMap** tiles                        |
| NLP                | **compromise** (lightweight NLP for place-name extraction)                              |
| RSS Parsing        | **rss-parser**                                                                          |
| News API           | **GNews** (optional, requires `GNEWS_API_KEY` in `.env.local`)                          |
| Geodata            | **GeoNames** (cities5000.txt + admin1CodesASCII.txt → compiled to `data/geonames.json`) |
| Geocoding Fallback | **Photon / Komoot API** (OSM-based, no API key needed)                                  |
| Fonts              | Inter, Playfair Display (Google Fonts)                                                  |

## Project Structure

```
newsscraper/
├── data/
│   ├── cities5000.txt          # GeoNames raw city data (~14 MB)
│   ├── admin1CodesASCII.txt    # GeoNames admin1 regions
│   └── geonames.json           # Compiled geodata (~4.7 MB) — cities, admin1, countries
├── scripts/
│   ├── benchmark-pipeline.mjs  # Pipeline performance testing script
│   └── build-geodata.mjs       # Parses GeoNames files → geonames.json
├── src/
│   ├── app/
│   │   ├── api/news/route.ts   # GET /api/news — aggregates, geocodes, caches, returns items
│   │   ├── globals.css         # All styles (dark/light themes, sidebar, map, popups)
│   │   ├── layout.tsx          # Root layout, fonts, metadata
│   │   └── page.tsx            # Main page — state management, filter/source wiring
│   ├── components/
│   │   ├── NewsMap.tsx          # Leaflet map with colored category pins + popups
│   │   ├── EventSidebar.tsx    # Scrollable list of news cards, synced with map selection
│   │   └── FilterBar.tsx       # Source toggles, category toggles, search input
│   ├── lib/
│   │   ├── geocode.ts          # Location extraction + dictionary lookup + Photon API fallback
│   │   ├── rss.ts              # RSS feed fetcher (curated source list)
│   │   ├── gnews.ts            # GNews API wrapper + OSINT keyword search
│   │   ├── social-feeds.ts     # Telegram + X feeds via RSSHub bridge
│   │   └── types.ts            # NewsItem, NewsResponse, NewsCategory interfaces
│   └── types/
│       └── css.d.ts            # CSS module ambient declarations
├── package.json
├── tsconfig.json
└── next.config.ts
```

## Data Pipeline

```
RSS Feeds / GNews API / Social Feeds (Concurrent Fetching)
        │
        ▼
  /api/news/route.ts ──── 5-min in-memory cache
        │
        ▼
  enrichItemsWithLocation()  (geocode.ts)
        │
        ▼
  Filtering (Source / Time / Search / MappedOnly)
        │
        └── Returns processed items to client
```

        ├── 1. extractLocation(title, description)
        │       ├── Dateline regex  (e.g. "KYIV (Reuters) — " or "Albania: ...")
        │       ├── Comma-pair      (e.g. "Austin, Texas")
        │       ├── Preposition/Verb regex (e.g. "fighting in Aleppo", "fled to Poland")
        │       ├── compromise NLP  (title then description)
        │       ├── Country Abbrev  ("U.S.", "U.K." — handles hyphens)
        │       ├── Demonym fallback ("Iranians" → Iran — handles plurals)
        │       └── Direct Country Name scan boundaries (for hyphenated pairs like "Iran-Israel")
        │
        ├── 2. geocodeLocation(placeName)
        │       └── KNOWN_LOCATIONS dictionary lookup (instant, ~78K cities + 4K admin1 + 209 countries)
        │           Note: The external Photon API fallback was disabled for unverified regex hits to completely eliminate rate-limit bottlenecks.
        │
        └── 3. Jitter applied to overlapping coordinates

```

## Geocoding System (geocode.ts) — Key Design Decisions

### Location Dictionary Load Order

The `KNOWN_LOCATIONS` dictionary is loaded in a specific priority order where later entries overwrite earlier ones:

1. **Cities** from `geonames.json` (population-weighted — largest city wins on name collision)
2. **Admin1 regions** (states/provinces) — won't overwrite a city with >500K pop
3. **Countries** from `geonames.json` (209 entries) — always overwrite to ensure country names resolve correctly
4. **Landmarks** (hardcoded — Pentagon, Kremlin, Gaza City, Crimea, Strait of Hormuz, Middle East, etc.) — highest priority override

### Candidate Scoring

Candidates are scored and sorted by two axes:

- **Source priority**: dateline (0) > comma_pair (1) > regex (2) > nlp (3)
- **Type priority**: landmark (0) > mega-city with >1M pop (1) > country (1.2) > smaller city (1.5) > admin1 (2)
- **Tie-break**: population (larger wins)

This means countries beat obscure same-named cities (e.g., Albania the country beats "Albania" the municipality in Colombia), but mega-cities like Singapore still resolve to their city coordinates.

### Robust Extraction Heuristics

- **Hyphenation Support**: Tokenizers for demonyms and abbreviations now split on both whitespace and hyphens, preventing items like "U.S.-backed" from losing the "U.S." location.
- **Plural Demonyms**: The system intelligently handles plurals (e.g., "Iranians", "Russians") by attempting to match the stem against the demonym map.
- **Direct Country Scan**: As a last-resort safety net of the extraction pipeline, the system performs a boundary-aware regex scan for known country names to catch cases like "Iran-Israel war" that NLP often fragments.

### False Positive Filter

A `FALSE_POSITIVES` set blocks compound phrases and brand/team names (e.g. "Arsenal", "Amazon", "Research roundup"). Generic regions like "Middle East" were previously blocked but are now allowed and mapped to specific coordinates.

**News Source Defaults**: A `NEWS_SOURCE_DEFAULTS` mapping provides fallback locations (e.g., "Washington DC" for NASA) when no geographic context can be extracted from an article.

### Dateline Regex

Captures journalistic-style location prefixes from both titles and descriptions:

```

/^([A-Z][A-Za-z\s]+?)\s*(?:\([^)]+\))?\s*(?:-|—|–|:)\s+/

````

Matches: `KYIV (Reuters) — ...`, `Albania: Femicide cases...`, `WASHINGTON - ...`

## Geodata Build Script (scripts/build-geodata.mjs)

Run manually when GeoNames data files are updated:

```bash
node scripts/build-geodata.mjs
````

**Inputs**: `data/cities5000.txt`, `data/admin1CodesASCII.txt`, hardcoded COUNTRY_DATA (209 entries with ISO codes)

**Output**: `data/geonames.json` containing `{ cities, admin1, countries }`

The raw GeoNames files (`cities5000.txt`, `admin1CodesASCII.txt`) must be downloaded from [geonames.org/export](https://download.geonames.org/export/dump/) and placed in `data/` before building.

## UI Architecture

- **Layout**: Fixed Sidebar (400px) + full-bleed Leaflet map. Sidebar features a premium logo ("Seraphim") and quick actions (Theme toggle, Collapse).
- **Theme**: Dark mode default, with a custom toggle button. Fonts: Cinezel Decorative for the logo, Inter for the UI.
- **Aesthetics**: High-contrast dark theme (#0f1117) with vibrant accent colors for categories:
  - **World**: Red
  - **Crisis**: Dark Red / Warning
  - **Nation**: Blue
  - **Business**: Amber
  - **Tech**: Cyan
- **Cards**: Sidebar cards feature enlarged thumbnails (**88x66px**), right-justified "Read full article" links, and a location pin SVG for mapped items.
- **Map styles**: Standard (Voyager), Dark, Light, Satellite, and Terrain layers — selectable via a floating settings panel (top-right).
- **Settings panel**: Floating card opened by gear icon; includes map style grid + clustering toggle.
- **Markers**: Large circle icons (**27px** normal / **37px** active) with category-specific white SVG glyphs. Active markers pulse and bring their popup to focus.
- **Clustering**: `leaflet.markercluster` groups nearby pins; uses custom-styled circles based on count (Small: Blue, Medium: Red, Large: Dark Red). **Off by default**.
- **Interaction**:
  - **Sidebar Click**: Flies map to pin, zooms in (min zoom 7), and offsets center downward (140px bias) to ensure the popup is fully visible.
  - **Pin Click**: Selects sidebar card, auto-scrolls it to the **top** of the list, and expands the card detail.
  - **Toggles**: Clicking an already active pin or expanded card collapses/deselects it.
  - **Map Click**: Clicking the map background deselects any active item.

## Filtering & Controls

- **Source Filtering**: UI explicitly splits sources into **News** (RSS), **Reddit**, **X**, **Telegram**, and **Bonus** (GNews). Each has a distinct brand color (e.g., Orange for Reddit).
- **Time & Location**:
  - **Time**: Limits results (1D, 3D, 1W, 1M, All).
  - **Mapped Only**: High-visibility green toggle (default: **ON**) to isolate geolocated news.
- **Categories**: Multi-select pill filters with category icons (Globe, Triangle, Flag, etc.) matching the map pins.
- **Search**: Debounced keyword search input at the bottom of the filter stack.
- **Refresh**: Manual cache override button with a spinning animation during load.

### RSS Feeds (curated in `rss.ts`)

Includes robust region metadata and categorized curation.

| Category   | Sources                                                                                                                                                                                                                                                        |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| World      | BBC World, Al Jazeera, NYT World, DW News, France 24, SCMP, BBC Africa, BBC Middle East, CNA Asia, Times of Israel, Al Arabiya English, MercoPress LatAm, War on the Rocks, Bellingcat, RNZ World, Politico Europe, The Hindu, Middle East Eye, AllAfrica News |
| Crisis     | USGS Earthquakes, ReliefWeb, ISW Daily Updates, Reddit CombatFootage (RSS), Reddit CredibleDefense (RSS)                                                                                                                                                       |
| Nation     | NPR US                                                                                                                                                                                                                                                         |
| Business   | CNBC, MarketWatch                                                                                                                                                                                                                                              |
| Technology | Ars Technica, The Verge, BleepingComputer, The Hacker News                                                                                                                                                                                                     |
| Science    | NASA, Nature                                                                                                                                                                                                                                                   |
| Health     | WHO News                                                                                                                                                                                                                                                       |

### GNews API

Requires `GNEWS_API_KEY` in `.env.local`. Optional — app works without it using RSS only.
`fetchOSINTGNews()` runs keyword-driven searches ("geolocated", "satellite imagery", "confirmed strike", etc.) and auto-tags results.

### Social Feeds (`social-feeds.ts`)

Two strategies, no API keys required:

- **Telegram**: HTML scraping of `t.me/s/<channel>` parsed with **Cheerio** (server-side jQuery). Preserves OSINT source links. Runs concurrently across channels.
- **X / Twitter**: Multi-strategy loop resolving completely concurrently (via `Promise.any`):
  1. **Native Syndication API** (Fastest)
  2. **Nitter RSS Mirrors**
  3. **RSSHub Instances**
  4. **Google News RSS**

| Platform | Accounts / Channels                                                                                                                               |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Telegram | LiveUkraine, Geopolitics Live, ISW, DDGeopolitics, Bellingcat, Cyberknow, Faytuks                                                                 |
| X        | @GeoConfirmed, @OSINTtechnical, @Liveuamap, @IntelCrab, @AuroraIntel, @ELINTNews, @DefMon3, @RALee85, @clashreport, @OAlexanderDK, @KofmanMichael |

Items arrive with `sourceType: 'social'`, `sourceType: 'rss'`, or `sourceType: 'gnews'` and are dynamically categorized in the UI by matching the source string or type.

## Environment Variables

| Variable        | Required | Description                              |
| --------------- | -------- | ---------------------------------------- |
| `GNEWS_API_KEY` | No       | GNews API key for additional news source |

## Running Locally

```bash
npm install
npm run dev        # Starts Next.js dev server
```

## Common Tasks

| Task                   | Command / Location                                                 |
| ---------------------- | ------------------------------------------------------------------ |
| Run pipeline benchmark | `node scripts/benchmark-pipeline.mjs`                              |
| Add a new RSS feed     | Append to `RSS_SOURCES` array in `src/lib/rss.ts`                  |
| Add a new landmark     | Add to `LANDMARKS` object in `src/lib/geocode.ts`                  |
| Add a stop word        | Add to `STOP_WORDS` set in `src/lib/geocode.ts`                    |
| Add a demonym          | Add to `DEMONYM_MAP` in `src/lib/geocode.ts`                       |
| Rebuild geodata        | `node scripts/build-geodata.mjs`                                   |
| Add a country          | Add to `COUNTRY_DATA` in `scripts/build-geodata.mjs`, then rebuild |
| Change map tile style  | Edit `MAP_STYLES` in `src/components/NewsMap.tsx`                  |
| Adjust cache TTL       | Change `CACHE_TTL` in `src/app/api/news/route.ts` (default: 5 min) |

## Known Gotchas

- **JSON import size**: `geonames.json` is ~4.7 MB. It's loaded at module init in `geocode.ts`. This is fine for server-side but would be heavy on the client.
- **Geocode is server-only**: `geocode.ts` runs exclusively on the server (API route). Never import it client-side.
- **NewsMap is client-only**: Loaded via `next/dynamic` with `{ ssr: false }` because Leaflet requires the DOM.
- **Rate limiting / Pipeline speed**: We strictly avoid relying on the external Photon API fallback for unknown locations specifically because unresolvable Regex hits (e.g. "Netflix, Hulu" or "MS exec") cause massive cascading rate-limit timeouts that block the pipeline.
- **Coordinate jitter**: When multiple articles map to the same location (e.g., 3 articles about "Ukraine"), golden-angle spiral jitter is applied so pins don't stack.
