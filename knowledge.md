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
RSS Feeds / GNews API / Social Feeds (RSSHub)
        │
        ▼
  /api/news/route.ts ──── 5-min in-memory cache
        │
        ▼
  enrichItemsWithLocation()  (geocode.ts)
        │
        ├── 1. extractLocation(title, description)
        │       ├── Dateline regex  (e.g. "KYIV (Reuters) — " or "Albania: ...")
        │       ├── Comma-pair      (e.g. "Austin, Texas")
        │       ├── Preposition regex (e.g. "fighting in Aleppo")
        │       ├── compromise NLP   (place entity extraction)
        │       └── Demonym fallback  ("Iranian" → Iran)
        │
        ├── 2. geocodeLocation(placeName)
        │       ├── KNOWN_LOCATIONS dictionary lookup (instant, ~75K cities + 4K admin1 + 209 countries)
        │       └── Photon/Komoot API fallback (200ms throttled)
        │
        └── 3. Jitter applied to overlapping coordinates
```

## Geocoding System (geocode.ts) — Key Design Decisions

### Location Dictionary Load Order

The `KNOWN_LOCATIONS` dictionary is loaded in a specific priority order where later entries overwrite earlier ones:

1. **Cities** from `geonames.json` (population-weighted — largest city wins on name collision)
2. **Admin1 regions** (states/provinces) — won't overwrite a city with >500K pop
3. **Countries** from `geonames.json` (209 entries) — always overwrite to ensure country names resolve correctly
4. **Landmarks** (hardcoded — Pentagon, Kremlin, Gaza City, Crimea, etc.) — highest priority

### Candidate Scoring

Candidates are scored and sorted by two axes:

- **Source priority**: dateline (0) > comma_pair (1) > regex (2) > nlp (3)
- **Type priority**: landmark (0) > mega-city with >1M pop (1) > country (1.2) > smaller city (1.5) > admin1 (2)
- **Tie-break**: population (larger wins)

This means countries beat obscure same-named cities (e.g., Albania the country beats "Albania" the municipality in Colombia), but mega-cities like Singapore still resolve to their city coordinates.

### False Positive Filter

A `FALSE_POSITIVES` set blocks compound phrases and brand/team names that NLP incorrectly detects as locations (e.g. "Arsenal", "Amazon", "Research roundup"). Standalone city names (Paris, Chelsea) are intentionally NOT blocked — only clear non-geographic uses.

### Dateline Regex

Captures journalistic-style location prefixes from both titles and descriptions:

```
/^([A-Z][A-Za-z\s]+?)\s*(?:\([^)]+\))?\s*(?:-|—|–|:)\s+/
```

Matches: `KYIV (Reuters) — ...`, `Albania: Femicide cases...`, `WASHINGTON - ...`

## Geodata Build Script (scripts/build-geodata.mjs)

Run manually when GeoNames data files are updated:

```bash
node scripts/build-geodata.mjs
```

**Inputs**: `data/cities5000.txt`, `data/admin1CodesASCII.txt`, hardcoded COUNTRY_DATA (209 entries with ISO codes)

**Output**: `data/geonames.json` containing `{ cities, admin1, countries }`

The raw GeoNames files (`cities5000.txt`, `admin1CodesASCII.txt`) must be downloaded from [geonames.org/export](https://download.geonames.org/export/dump/) and placed in `data/` before building.

## UI Architecture

- **Layout**: Sidebar (360px) + full-bleed Leaflet map, responsive (stacks at <860px)
- **Theme**: Dark mode default, toggleable. CSS variables on `[data-theme]`
- **Map styles**: Standard, dark, light, satellite, humanitarian, and topographic tile layers — selectable via gear (⚙️) settings panel (top-right of map)
- **Settings panel**: Floating card opened by gear icon; contains map style grid + clustering toggle
- **Markers**: Circle icons with category-specific SVG glyphs + category color. Active markers pulse.
- **Clustering**: `leaflet.markercluster` groups nearby pins into numbered circles; **off by default**, toggleable in settings panel
- **Interaction**: Clicking a map pin selects the sidebar card (auto-scrolls), clicking a sidebar card flies the map to that pin's location

## News Sources

### RSS Feeds (curated in `rss.ts`)

| Category   | Sources                                                                                                                                                                                                        |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| World      | BBC World, Al Jazeera, NYT World, DW News, France 24, SCMP, BBC Africa, BBC Middle East, **CNA Asia**, **Times of Israel**, **Al Arabiya English**, **MercoPress LatAm**, **War on the Rocks**, **Bellingcat** |
| Crisis     | USGS Earthquakes, **ReliefWeb**, **Reddit CombatFootage**, **Reddit CredibleDefense**, **ISW Daily Updates**                                                                                                   |
| Nation     | NPR US, CBC Canada                                                                                                                                                                                             |
| Business   | CNBC, MarketWatch                                                                                                                                                                                              |
| Technology | Ars Technica, The Verge, **BleepingComputer**, **The Hacker News**                                                                                                                                             |
| Science    | NASA, Nature                                                                                                                                                                                                   |
| Health     | WHO News                                                                                                                                                                                                       |

### GNews API

Requires `GNEWS_API_KEY` in `.env.local`. Optional — app works without it using RSS only.
`fetchOSINTGNews()` runs keyword-driven searches ("geolocated", "satellite imagery", "confirmed strike", etc.) and auto-tags results.

### Social Feeds (`social-feeds.ts`)

Two strategies, no API keys required:

- **Telegram**: HTML scraping of `t.me/s/<channel>` parsed with **Cheerio** (server-side jQuery). Preserves OSINT source links.
- **X / Twitter**: RSS via **RSSHub** instances with **fallback loop** — tries `rsshub.app`, `rsshub.rssforever.com`, `rsshub.moeyy.cn` in sequence. URL pattern: `{instance}/twitter/user/{username}`.

| Platform | Accounts / Channels                                                          |
| -------- | ---------------------------------------------------------------------------- |
| Telegram | Faytuks, LiveUkraine, Astra Press                                            |
| X        | @GeoConfirmed, @OSINTtechnical, @Liveuamap, **@IntelCrab**, **@AuroraIntel** |

Items arrive with `sourceType: 'social'` and are tagged `['OSINT', '<platform>']`.

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

| Task                  | Command / Location                                                 |
| --------------------- | ------------------------------------------------------------------ |
| Add a new RSS feed    | Append to `RSS_SOURCES` array in `src/lib/rss.ts`                  |
| Add a new landmark    | Add to `LANDMARKS` object in `src/lib/geocode.ts`                  |
| Add a stop word       | Add to `STOP_WORDS` set in `src/lib/geocode.ts`                    |
| Add a demonym         | Add to `DEMONYM_MAP` in `src/lib/geocode.ts`                       |
| Rebuild geodata       | `node scripts/build-geodata.mjs`                                   |
| Add a country         | Add to `COUNTRY_DATA` in `scripts/build-geodata.mjs`, then rebuild |
| Change map tile style | Edit `MAP_STYLES` in `src/components/NewsMap.tsx`                  |
| Adjust cache TTL      | Change `CACHE_TTL` in `src/app/api/news/route.ts` (default: 5 min) |

## Known Gotchas

- **JSON import size**: `geonames.json` is ~4.7 MB. It's loaded at module init in `geocode.ts`. This is fine for server-side but would be heavy on the client.
- **Geocode is server-only**: `geocode.ts` runs exclusively on the server (API route). Never import it client-side.
- **NewsMap is client-only**: Loaded via `next/dynamic` with `{ ssr: false }` because Leaflet requires the DOM.
- **Rate limiting**: The Photon API fallback has a 200ms sleep between uncached requests. Dictionary hits are instant.
- **Coordinate jitter**: When multiple articles map to the same location (e.g., 3 articles about "Ukraine"), golden-angle spiral jitter is applied so pins don't stack.
