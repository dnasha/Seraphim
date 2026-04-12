# Seraphim — Project Knowledge

## What Is This?

Seraphim is a real-time OSINT news aggregator that geocodes headlines and plots them on an interactive world map. It pulls articles from RSS feeds and the GNews API, extracts geographic locations from the text using NLP + regex heuristics, and displays everything in a Leaflet/OpenStreetMap map with a filterable sidebar.

## Tech Stack

| Layer              | Technology                                                                              |
| ------------------ | --------------------------------------------------------------------------------------- |
| Framework          | **Next.js 16** (App Router)                                                             |
| Language           | **TypeScript**                                                                          |
| Frontend           | **React 19**, vanilla CSS (no Tailwind)                                                 |
| Database           | **Supabase** (PostgreSQL + PostGIS)                                                     |
| Runtime            | **Bun** (for the scraper worker)                                                        |
| Map                | **Leaflet 1.9** + **react-leaflet 5** on **OpenStreetMap** tiles                        |
| NLP                | **compromise** (lightweight NLP for place-name extraction)                              |
| RSS Parsing        | **rss-parser**                                                                          |
| News API           | **GNews** (optional, requires `GNEWS_API_KEY`)                                          |
| Geodata            | **GeoNames** (cities5000.txt + admin1CodesASCII.txt → compiled to `data/geonames.json`) |
| Geocoding Fallback | **Photon / Komoot API** (OSM-based, no API key needed)                                  |
| Fonts              | Inter, Playfair Display (Google Fonts)                                                  |

## Project Structure

```
newsscraper/
├── data/
│   ├── cities5000.txt          # GeoNames raw city data (~14 MB)
│   ├── admin1CodesASCII.txt    # GeoNames admin1 regions
│   └── geonames.json           # Compiled geodata (~4.7 MB)
├── scripts/
│   ├── benchmark-pipeline.mjs  # Pipeline performance testing script
│   ├── build-geodata.mjs       # Parses GeoNames files → geonames.json
│   ├── evaluate-accuracy.mjs   # Live regression test against human-graded data
│   └── test-scrape.mjs         # Visual diagnostic for all fetchers
├── src/
│   ├── app/
│   │   ├── api/news/route.ts   # GET /api/news — Supabase proxy
│   │   └── page.tsx            # Main page — uses hooks for state
│   ├── components/
│   │   ├── map/                # NewsMap, MapSettings, MapConstants
│   │   ├── EventSidebar.tsx    # Scrollable list of news cards
│   │   └── FilterBar.tsx       # Source/Category UI toggles
│   ├── scraper/
│   │   ├── index.ts            # Bun Scraping Worker (Entry Point)
│   │   ├── fetchers/           # Modular fetchers (rss, gnews, social)
│   │   └── utils/
│   │       └── date.ts         # Robust ISO 8601 normalization
│   ├── data/
│   │   └── sources.ts          # Centralized RSS and Reddit source lists
│   ├── hooks/
│   │   ├── useNewsData.ts      # Fetching from /api/news
│   │   └── useNewsFilter.ts    # Client-side useMemo filtering
│   ├── lib/
│   │   ├── geocoding/          # NLP engine (engine, patterns, constants, enricher)
│   │   └── types.ts            # Global interfaces
│   └── types/
│       ├── index.ts            # DB Mapping: DbEvent <-> NewsItem
│       └── css.d.ts            # Ambient declarations
├── package.json
└── tsconfig.json
```

## Data Pipeline

```
RSS Feeds / GNews API / Social Feeds (Concurrent Fetching)
        │
        ▼
   Geocoding Pipeline (enrichItemsWithLocation)
        │
        ▼
    Standalone Scraper (Bun) ──> Upsert to Supabase (events table)
                                     │ (Every 30 mins)
                                     ▼
                           /api/news/route.ts (Next.js)
                                     │ (15m Server Cache + Edge CDN)
                                     ▼
                           Client-Side Filtering (useMemo)
```

        ├── 1. extractLocation(title, description)
        │       ├── Dateline regex  (e.g. "KYIV (Reuters) — " or "Albania: ...")
        │       ├── Comma-pair      (e.g. "Austin, Texas")
        │       ├── Action-Target Regex (e.g. "strikes on Yemen") — High Priority
        │       ├── Sliding-Window Dictionary Scan (O(N) multi-word lookup)
        │       ├── compromise NLP  (fallback if regex/scan finds nothing)
        │       ├── Country Abbrev  ("U.S.", "U.K." — handles hyphens)
        │       └── Demonym fallback ("Iranians" → Iran — handles plurals)
        │
        ├── 2. normalizeLocation()
        │       ├── Accent Normalization (São Paulo → Sao Paulo)
        │       └── Title Case (london → London, washington dc → Washington DC)
        │
        ├── 3. geocodeLocation(placeName)
        │       └── KNOWN_LOCATIONS dictionary lookup (instant, ~78K cities + 4K admin1 + 209 countries)
        │           Note: Photon API fallback is permanently disabled to prevent rate-limit bottlenecks.
        │
        └── 4. Jitter applied to overlapping coordinates

```

## Geocoding System (lib/geocoding/) — Key Design Decisions

The geocoding system is modularized for maintainability:
- **engine.ts**: Core extraction and dictionary lookup logic.
- **enricher.ts**: High-level wrapper that enriches NewsItems and applies jitter.
- **constants.ts**: Landmarks, Demonyn maps, Stop words, and scoring weights.
- **patterns.ts**: Regex patterns for datelines and Action-Target extraction.
- **utils.ts**: Pure string normalization and cleaning functions.

### Location Dictionary Load Order

The `KNOWN_LOCATIONS` dictionary is loaded in a specific priority order where later entries overwrite earlier ones:

1. **Cities** from `geonames.json` (population-weighted — largest city wins on name collision)
2. **Admin1 regions** (states/provinces) — won't overwrite a city with >500K pop
3. **Countries** from `geonames.json` (209 entries) — always overwrite to ensure country names resolve correctly
4. **Landmarks** (hardcoded — Pentagon, Kremlin, Gaza City, Crimea, Strait of Hormuz, Middle East, etc.) — highest priority override

### Candidate Scoring

Candidates are scored and sorted by two axes:

- **Source priority**: action_target (-2) > dateline (0) > regex/comma (1/2) > nlp (6)
- **Type priority**: landmark (0) > mega-city (>1M pop) (2) > country (4) > city (6) > admin1 (8)
- **Context Penalties**: 
    - **Superpowers**: "United States" and "United Kingdom" receive a +10 penalty to prioritize the *target* of an action over the actor.
    - **Continents**: Generic matches like "Africa" receive a +20 penalty to ensure they only win if nothing specific is found.

This means countries beat obscure same-named cities, but event-specific targets (like "Yemen") always beat participating actors (like "U.S. strikes").

### Robust Extraction & Normalization

- **Hyphenation Support**: Tokenizers for demonyms and abbreviations now split on both whitespace and hyphens, preventing items like "U.S.-backed" from losing the "U.S." location.
- **Plural Demonyms**: The system intelligently handles plurals (e.g., "Iranians", "Russians") by attempting to match the stem against the demonym map.
- **Direct Country Scan**: As a last-resort safety net of the extraction pipeline, the system performs a boundary-aware regex scan for known country names.
- **Date Normalization (`ensureIsoDate`)**: All incoming date strings (including non-standard formats like ICG CrisisWatch's "Friday, April 10, 2026 - 16:35") are normalized to valid ISO 8601 strings to prevent database parsing errors.
- **UTF-8 Cleaning**: Descriptions and titles are stripped of incomplete surrogate pairs to prevent Postgres JSONB encoding failures.

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

## UI Architecture

The UI uses a modular component-based architecture with logic extracted into custom hooks:
- **Hooks**:
    - `useNewsData`: Manages global news state, fetching, and 15-minute background polling (silent refresh).
    - `useNewsFilter`: Manages filtering state and performs `useMemo`-based filtering of the news dataset.
- **Components**:
    - `EventSidebar`: Displays the news feed and statistics.
    - `FilterBar`: Contains UI controls for sources, categories, and search.
    - `NewsMap`: Multi-layered Leaflet map with marker synchronization.
    - `ThemeToggle`: Reusable dark/light mode switcher.

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
- **Markers**: Large circle icons (**26px** normal / **36px** active) with category-specific white SVG glyphs.
  - **Surgical Selection**: Uses a stable **44px** container for both states to prevent anchor point jumping.
  - **Premium Highlighting**: Selected markers feature a "sonar pulse" CSS animation and vibrant color-matched glow.
  - **Direct DOM Updates**: Marker highlights use direct CSS class manipulation (Ref-based) for instant, flicker-free feedback.
- **Clustering**: `leaflet.markercluster` groups nearby pins. **Off by default**.
  - **Performance**: Uses `chunkedLoading: true` and `removeOutsideVisibleBounds: true` to prevent UI lag with large datasets.
  - **Race Conditions**: Uses `zoomToShowLayer` with specialized coordinate biasing to ensure popups aren't cut off by animations.
- **Performance Optimization**:
  - **GPU Acceleration**: Uses `preferCanvas: true` for the map and `will-change` CSS hints for the sidebar and containers.
  - **Layer Isolation**: Implements `backface-visibility: hidden` and `cubic-bezier` transitions to offload animations to the GPU.
  - **Memoization**: The high-density sidebar news list is aggressively memoized to prevent re-renders during map pans and pin clicks.
  - **Data Resilience**: Implements strict nullish checks for geographic coordinates to prevent Leaflet runtime crashes on unmapped articles.
- **Interaction**:
  - **Smooth Zoom System**: Leaflet's built-in `scrollWheelZoom` is disabled and replaced with a custom `requestAnimationFrame` lerp loop that calls Leaflet's internal `_move()` per frame and `_moveEnd()` once on settle. This eliminates the debounce-then-snap bounce on trackpads. Zoom buttons also route through this system for smooth animated zoom. Key details:
    - **Tile Preservation**: `_move()` fires `zoom` event → tile CSS transforms + marker repositioning. `_moveEnd()` fires `moveend` → final tile loading. Tiles are never blank during zoom.
    - **Anti-Jitter**: During smooth zoom, Leaflet's `_getNewPixelOrigin` and `latLngToLayerPoint` are temporarily monkey-patched to remove `._round()` calls that cause 1px random-direction wobble. Rounding is restored on settle for pixel-perfect final positions.
    - **Zoom-to-Cursor**: Anchor lat/lng is captured once at gesture start; the map center is computed each frame to keep that world coordinate under the cursor.
    - **Custom Zoom Buttons**: The default `L.control.zoom` is replaced with custom buttons that feed into the same smooth zoom loop, anchored to map center.
  - **Fly To Animation**: Flies map to pin with an 800ms "smooth" transition and 140px vertical offset.
  - **Map Boundary Framing**: Auto-frames on data refresh, ignoring extreme latitudes (<-60) to maintain focus.
  - **Deselection**: Clicking the map background or re-clicking a selected card deselects the item and closes popups.

## Filtering & Controls

- **Source Filtering**: UI explicitly splits sources into **News** (RSS), **Reddit**, **X**, **Telegram**, and **Bonus** (GNews). Each has a distinct brand color (e.g., Orange for Reddit).
- **Time & Location**:
  - **Time**: Limits results (1D, 3D, 1W, 1M, All).
  - **Mapped Only**: High-visibility green toggle (default: **ON**) to isolate geolocated news.
- **Categories**: Multi-select pill filters with category icons (Globe, Triangle, Flag, etc.) matching the map pins.
- **Search**: Debounced keyword search input at the bottom of the filter stack.
- **Refresh**: Manual cache override button with a spinning animation during load (controlled via `fetchNews(true)` in `useNewsData`).

### RSS Feeds (curated in `src/data/sources.ts`)

Includes robust region metadata and categorized curation.

| Category   | Sources                                                                                                                                                                                                                                                        |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| World      | BBC World, Al Jazeera, NYT World, DW News, France 24, SCMP, BBC Africa, BBC Middle East, CNA Asia, Times of Israel, Al Arabiya English, MercoPress LatAm, War on the Rocks, Foreign Affairs, CFR, Chatham House, ECFR, The Diplomat, Geopolitical Futures, RNZ World, The Hindu, Politico Europe, Middle East Eye, The Rio Times, AllAfrica News |
| Crisis     | USGS Earthquakes, ReliefWeb, ISW Daily Updates, ICG CrisisWatch, ACLED, Reddit CombatFootage, Reddit CredibleDefense, Reddit UkraineWarVideoReport, Reddit GlobalConflict |
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

| Platform | Accounts / Channels                                                                                                                                                                                                                                                                                                                                                                                                |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Telegram | LiveUkraine, bloomberg, War Translated, NEXTA, Kyiv Independent, Intel Slava Z, OSINTdefender, Middle East Eye                                                                                                                                                                                 |
| X        | @GeoConfirmed, @OSINTtechnical, @Liveuamap, @IntelCrab, @AuroraIntel, @ELINTNews, @DefMon3, @RALee85, @clashreport, @OAlexanderDK, @KofmanMichael, @sentdefender, @IDF, @IsraelWarRoom, @GeoFront5                                                                                                                                                                  |

Items arrive with `sourceType: 'social'`, `sourceType: 'rss'`, or `sourceType: 'gnews'` and are dynamically categorized in the UI by matching the source string or type.

## Environment Variables

| Variable                    | Required | Description                                    |
| --------------------------- | -------- | ---------------------------------------------- |
| `SUPABASE_URL`              | **Yes**  | Your Supabase Project URL                      |
| `SUPABASE_SERVICE_ROLE_KEY` | **Yes**  | Service role key for bypass-RLS scraper writes |
| `GNEWS_API_KEY`              | No       | GNews API key for additional news source       |

## Running Locally

```bash
npm install
npm run dev               # Starts Next.js dev server
bun run src/scraper/index.ts  # Runs the ingestion worker manually
```

## Common Tasks

| Task                   | Command / Location                                                 |
| ---------------------- | ------------------------------------------------------------------ |
| Run ingestion worker   | `bun run src/scraper/index.ts` (Requires env vars)                 |
| Run pipeline benchmark | `npx tsx scripts/benchmark-pipeline.mjs`                           |
| Run accuracy test      | `npx tsx scripts/evaluate-accuracy.mjs`                            |
| Add a new RSS/Reddit feed | Append to `src/data/sources.ts`                                 |
| Add a new landmark     | Add to `LANDMARKS` in `src/lib/geocoding/constants.ts`             |
| Add a stop word        | Add to `STOP_WORDS` in `src/lib/geocoding/constants.ts`            |
| Rebuild geodata        | `node scripts/build-geodata.mjs`                                   |
| Adjust cache TTL       | Change `CACHE_TTL` in `src/app/api/news/route.ts` (default: 15 min) |

## Known Gotchas

- **JSON import size**: `geonames.json` is ~4.7 MB. Loaded at module init in `lib/geocoding/engine.ts`.
- **Client-Side Filtering**: For performance, the API returns a wide set of items which the client then filters via `useMemo` in `useNewsFilter`. This allows instant source/category toggling without network latency.
- **Geocode is server-only**: Never import `lib/geocoding/` client-side.
- **Rate limiting**: External Photon API fallback is disabled; we rely entirely on the local dictionary + heuristics for speed.
- **Map Framing**: Framing logic ignores latitudes < -60 (Antarctica) when calculating bounds to prevent zooming out too far on refresh.
- **Coordinate jitter**: Golden-angle spiral jitter is applied to prevent pin stacking.
- **Egress Optimization**: The API uses selective `SELECT` queries to omit unused fields (like `tags`) and heavyweight data from the initial payload.
- **Edge Caching**: `route.ts` serves `Cache-Control` headers for Edge CDN caching, drastically reducing database read volume and latency for concurrent users.
- **Polling Strategy**: Background polling uses silent cached fetches every 15 minutes, while the manual refresh button explicitly overrides the server cache with `?refresh=true`.
