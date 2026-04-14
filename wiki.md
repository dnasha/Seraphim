# Seraphim — Project Wiki

> Internal reference for architecture, conventions, and operational knowledge.
> For the roadmap & future plans, see [future.md](./future.md).

---

## What Is Seraphim?

Seraphim is a real-time OSINT (Open-Source Intelligence) news aggregator that scrapes global headlines, extracts geographic locations via NLP + regex heuristics, and plots them on an interactive world map. It combines RSS feeds, social media (Telegram, X/Twitter), Reddit, and the GNews API into a single filterable intelligence dashboard.

---

## Tech Stack

| Layer | Technology | Notes |
|---|---|---|
| **Framework** | Next.js 16 (App Router) | React 19, deployed to Vercel |
| **Language** | TypeScript | Strict mode across frontend and scraper |
| **Styling** | Vanilla CSS | Single `globals.css` (no Tailwind). CSS custom properties for theming |
| **Database** | Supabase (PostgreSQL + PostGIS) | `events` table with RLS. PostGIS enabled for spatial queries |
| **Scraper Runtime** | Bun | Native TS execution, 30x faster cold starts than Node |
| **Map** | Leaflet 1.9 + react-leaflet 5 | OpenStreetMap tiles (Voyager/Dark). Canvas renderer |
| **NLP** | compromise | Lightweight place-name extraction fallback |
| **RSS** | rss-parser | Standard RSS/Atom feed parsing |
| **Social Scraping** | Cheerio (Telegram), multi-strategy (X) | No API keys required |
| **News API** | GNews | Optional. Keyword-driven OSINT searches |
| **Geodata** | GeoNames (cities5000 + admin1) | Compiled to `data/geonames.json` (~4.7 MB, ~78K entries) |
| **Analytics** | @vercel/analytics, @vercel/speed-insights | Integrated in layout |
| **Fonts** | Cinzel Decorative (logo), Inter (UI) | Loaded via Google Fonts / next/font |

---

## Project Structure

```
SeraphimPreview/
├── .github/workflows/
│   └── main.yml                    # GitHub Actions cron — runs scraper every 30 min
├── data/
│   ├── cities5000.txt              # GeoNames raw city data (~14 MB)
│   ├── admin1CodesASCII.txt        # GeoNames admin1 regions
│   └── geonames.json               # Compiled geodata (~4.7 MB) — DO NOT EDIT BY HAND
├── scripts/
│   ├── benchmark-pipeline.mjs      # Pipeline performance benchmarking
│   ├── build-geodata.mjs           # Compiles cities5000 + admin1 → geonames.json
│   ├── evaluate-accuracy.mjs       # Geocoding regression test against graded samples
│   ├── test-scrape.ts              # Visual diagnostic — prints all fetcher outputs
│   ├── test-scraper.ts             # Full scraper dry-run diagnostic
│   ├── test-supabase.ts            # Database connection + query test
│   └── test-real-geocode.ts        # Live geocoding accuracy spot-check
├── src/
│   ├── app/
│   │   ├── api/news/route.ts       # GET /api/news — Supabase proxy with 15m cache
│   │   ├── globals.css             # All application styles (1,450 lines)
│   │   ├── layout.tsx              # Root layout — fonts, metadata, analytics
│   │   └── page.tsx                # Main page — orchestrates sidebar + map
│   ├── components/
│   │   ├── map/
│   │   │   ├── NewsMap.tsx         # Leaflet map — markers, smooth zoom, popups (664 lines)
│   │   │   ├── MapConstants.tsx    # Icon cache, color maps, tile styles, formatters
│   │   │   ├── MapSettings.tsx     # Settings panel — map style selector, cluster toggle
│   │   │   └── index.tsx           # Barrel export
│   │   ├── EventSidebar.tsx        # Sidebar — logo, stats, card list (349 lines)
│   │   ├── FilterBar.tsx           # Source/category/time/search controls
│   │   └── ThemeToggle.tsx         # Dark/light mode switch button
│   ├── scraper/
│   │   ├── index.ts                # Bun worker entry — fetch → dedup → geocode → upsert
│   │   ├── fetchers/
│   │   │   ├── rss.ts              # RSS + Reddit feed fetchers
│   │   │   ├── gnews.ts            # GNews API fetcher
│   │   │   ├── social-feeds.ts     # Telegram HTML scraper + X multi-strategy fetcher
│   │   │   └── geocoding.ts        # enrichItemsWithLocation wrapper for scraper
│   │   └── utils/
│   │       └── date.ts             # ensureIsoDate() — robust date normalization
│   ├── data/
│   │   └── sources.ts              # Centralized source definitions (RSS URLs, Reddit subs)
│   ├── hooks/
│   │   ├── useNewsData.ts          # Data fetching + 15-minute polling
│   │   └── useNewsFilter.ts        # Client-side useMemo filtering (source/category/time/search)
│   ├── lib/
│   │   ├── geocoding/
│   │   │   ├── engine.ts           # Core extraction + dictionary lookup (~20KB)
│   │   │   ├── constants.ts        # Landmarks, demonyms, stop words, scoring weights (~11KB)
│   │   │   ├── patterns.ts         # Dateline regex, action-target patterns (~4.5KB)
│   │   │   ├── enricher.ts         # High-level wrapper: geocode items + apply jitter
│   │   │   ├── utils.ts            # String normalization (accents, title case)
│   │   │   └── index.ts            # Barrel export
│   │   └── types.ts                # NewsItem, NewsResponse, NewsCategory interfaces
│   └── types/
│       ├── index.ts                # DbEvent interface + dbEventToNewsItem() mapper
│       └── css.d.ts                # Ambient CSS module declarations
├── package.json                    # Dependencies + npm scripts
├── tsconfig.json
├── future.md                       # Project roadmap
└── wiki.md                         # This file
```

---

## Data Pipeline

### High-Level Flow

```
┌─────────────────────────────────────────────────────────┐
│  Bun Scraper Worker  (src/scraper/index.ts)             │
│                                                         │
│  1. Fetch all sources concurrently (Promise.allSettled)  │
│     ├── fetchAllRSSFeeds()        → NewsItem[]          │
│     ├── fetchAllRedditFeeds()     → NewsItem[]          │
│     ├── fetchGNews()              → NewsItem[]          │
│     ├── fetchOSINTGNews()         → NewsItem[]          │
│     └── fetchSocialFeeds()        → NewsItem[]          │
│                                                         │
│  2. Pre-fetch known URLs from DB (chunks of 50)         │
│     └── Skip items already in Supabase                  │
│                                                         │
│  3. Geocode NEW items only                              │
│     └── enrichItemsWithLocation(newItems)               │
│                                                         │
│  4. Sanitize & upsert (chunks of 50)                    │
│     ├── ensureIsoDate() — normalize timestamps          │
│     ├── cleanString() — strip orphaned surrogates       │
│     └── Upsert with onConflict: 'url'                   │
│         └── Per-row fallback on chunk failure            │
└─────────────────────────────────────────────────────────┘
              ↓ (Every 30 min via GitHub Actions)
┌─────────────────────────────────────────────────────────┐
│  Supabase PostgreSQL  (events table)                    │
│  └── url = UNIQUE constraint (dedup key)                │
│  └── RLS: public SELECT, service-role INSERT/UPDATE     │
└─────────────────────────────────────────────────────────┘
              ↓
┌─────────────────────────────────────────────────────────┐
│  /api/news/route.ts  (Next.js Edge Route)               │
│  ├── In-memory cache (15 min TTL)                       │
│  ├── Refresh throttle (1 min cooldown)                  │
│  ├── Selective SELECT (omits unused fields)             │
│  ├── LIMIT 500, ORDER BY published_at DESC              │
│  └── Cache-Control: s-maxage=900                        │
└─────────────────────────────────────────────────────────┘
              ↓
┌─────────────────────────────────────────────────────────┐
│  React Client                                           │
│  ├── useNewsData — fetch + 15-min polling               │
│  └── useNewsFilter — client-side useMemo filtering      │
│      └── Instant toggling, no network round-trip        │
└─────────────────────────────────────────────────────────┘
```

### Scraper Execution Modes

| Mode | Command | Behavior |
|---|---|---|
| **Production** | GitHub Actions cron (`main.yml`) | Runs every 30 min, writes to Supabase |
| **Local** | `bun run src/scraper/index.ts` | Same pipeline, uses `.env.local` secrets |
| **Dry run** | `DRY_RUN=true bun run src/scraper/index.ts` | Prints payload, no DB writes |

---

## Geocoding System

> **Location**: `src/lib/geocoding/` (6 files, ~40KB total)
> **⚠️ Server-only** — never import this module client-side.

### Extraction Pipeline

Each headline + description is run through these strategies in order. The first match with the best score wins.

| Step | Strategy | Example Match | Priority Score |
|---|---|---|---|
| 1 | **Dateline regex** | `KYIV (Reuters) — ...` | 0 (high) |
| 2 | **Comma-pair** | `Austin, Texas` | 2 |
| 3 | **Action-target regex** | `strikes on Yemen` | -2 (highest) |
| 4 | **Sliding-window dictionary scan** | Multi-word city names | 3 |
| 5 | **compromise NLP** | Fallback entity extraction | 6 (low) |
| 6 | **Country abbreviations** | `U.S.`, `U.K.` (handles hyphens: `U.S.-backed`) | 4 |
| 7 | **Demonym fallback** | `Iranians` → Iran (handles plurals) | 5 |
| 8 | **Direct country scan** | Last-resort boundary-aware regex for country names | 7 |

### Dictionary Load Order

The `KNOWN_LOCATIONS` map is built in a specific priority order — **later entries overwrite earlier ones**:

1. **Cities** from `geonames.json` (population-weighted; largest city wins collisions)
2. **Admin1 regions** (states/provinces) — won't overwrite cities with >500K population
3. **Countries** (209 entries) — always overwrite to ensure "Georgia" = country, not US state
4. **Landmarks** (hardcoded) — highest priority: Pentagon, Kremlin, Gaza City, Crimea, Strait of Hormuz, etc.

### Candidate Scoring

When multiple locations are found, they're ranked by combined score (lower = better):

- **Source score**: action_target (-2) > dateline (0) > regex (1) > comma (2) > nlp (6)
- **Type score**: landmark (0) > mega-city >1M pop (2) > country (4) > city (6) > admin1 (8)
- **Context penalties**:
  - Superpowers (US, UK): +10 — ensures "U.S. strikes on Yemen" maps to Yemen, not Washington
  - Continents (Africa, Asia): +20 — only win if nothing more specific is found

### Normalization & Edge Cases

| Feature | Details |
|---|---|
| **Accent normalization** | `São Paulo` → `Sao Paulo` for dictionary matching |
| **Title casing** | `london` → `London`, `washington dc` → `Washington DC` |
| **Hyphen splitting** | `U.S.-backed` correctly extracts `U.S.` |
| **Plural demonyms** | `Iranians` → `Iranian` → `Iran` |
| **False positive blocking** | `FALSE_POSITIVES` set: Arsenal, Amazon, Research roundup, etc. |
| **Source defaults** | `NEWS_SOURCE_DEFAULTS`: NASA → Washington DC, etc. |
| **Date normalization** | `ensureIsoDate()` handles `"Friday, April 10, 2026 - 16:35"` and similar |
| **UTF-8 cleaning** | Strips orphaned surrogate pairs before Postgres insertion |
| **Coordinate jitter** | Golden-angle spiral applied to prevent pin stacking at identical coords |

### Dateline Regex

```regex
/^([A-Z][A-Za-z\s]+?)\s*(?:\([^)]+\))?\s*(?:-|—|–|:)\s+/
```

Matches: `KYIV (Reuters) — ...`, `Albania: Femicide cases...`, `WASHINGTON - ...`

---

## UI Architecture

### Component Hierarchy

```
page.tsx (client component)
├── useNewsData()             → { news, isLoading, error, lastUpdated, fetchNews }
├── useNewsFilter(news)       → { sources, categories, timeRange, ..., filteredNews }
│
├── EventSidebar
│   ├── Logo + ThemeToggle + Collapse/Close buttons
│   ├── Stats row (article count, mapped count, last-updated, refresh button)
│   ├── FilterBar (slotted in via prop)
│   │   ├── Source toggles (News/Reddit/X/Telegram/GNews)
│   │   ├── Category pills (World/Crisis/Nation/Business/Tech/Science/Health)
│   │   ├── Time range (1D/3D/1W/1M/All)
│   │   ├── "Mapped Only" toggle (default: ON)
│   │   └── Debounced search input
│   └── Card list (.map() over filteredNews)
│       ├── Mapped cards → click flies map to pin
│       └── Unmapped cards → click expands inline detail
│
└── NewsMap (dynamic import, SSR disabled)
    ├── Leaflet map (canvas renderer, custom smooth zoom)
    ├── MapSettings (gear icon → style selector + cluster toggle)
    ├── Marker layer (direct or clustered)
    └── Popup layer (HTML-templated, not React-rendered)
```

### Layout

- **Desktop**: Fixed sidebar (400px) + full-bleed map. Sidebar collapses via arrow button.
- **Mobile (≤860px)**: Map fills viewport. Sidebar becomes slide-in overlay from left. Hamburger button to open.

### Theme System

- **Default**: Light mode (prevents flash-of-unstyled-content on load)
- **Storage**: `localStorage.getItem('theme')` checked on mount via `setTimeout(0)` to avoid hydration mismatch
- **CSS**: `[data-theme="dark"]` selector on `<html>` overrides CSS custom properties (`--surface`, `--border`, `--text-primary`, etc.)
- **Map sync**: Theme change swaps tile layer between Voyager (light) and Dark Matter (dark)

### Category Colors

| Category | Color | Hex |
|---|---|---|
| World | Red | `#dc2626` |
| Crisis | Dark Red | `#b91c1c` |
| Nation | Blue | `#2563eb` |
| Business | Amber | `#d97706` |
| Technology | Cyan | `#0891b2` |
| Science | Green | `#059669` |
| Health | Purple | `#7c3aed` |
| General | Gray | `#6b7280` |

### Marker System

- **Normal state**: 26px circle with category color + white SVG glyph icon. 2px white border.
- **Active state**: 36px with sonar pulse animation + color-matched glow. z-index boosted to 1000.
- **Container**: Stable 44px `DivIcon` container for both states — prevents Leaflet anchor-point jumping during size transitions.
- **Icon caching**: `IconCache` in `MapConstants.tsx` prevents redundant `DivIcon` creation.
- **Highlighting**: Uses direct DOM class manipulation (`.marker-icon-active`) via element refs — bypasses React reconciliation for instant, flicker-free feedback.

### Smooth Zoom System

Leaflet's default `scrollWheelZoom` is disabled. Replaced with a custom system:

1. On `wheel` event: capture cursor position as anchor lat/lng, start `requestAnimationFrame` loop
2. Each frame: lerp `currentZoom` toward `targetZoom` (factor: 0.18), call `map._move(center, zoom)`
3. On settle (diff < 0.0005): call `map._moveEnd(true)`, restore rounding, release anchor

**Anti-jitter patches** (applied during zoom, restored on settle):
- `_getNewPixelOrigin` — remove `._round()` to prevent 1px wobble
- `latLngToLayerPoint` — same
- `GridLayer._setZoomTransform` — sub-pixel tile positioning

Custom zoom buttons feed into the same loop (anchored to map center, delta ±1).

---

## Source Registry

### RSS Feeds (in `src/data/sources.ts`)

| Category | Sources |
|---|---|
| **World** | BBC World, Al Jazeera, NYT World, DW News, France 24, SCMP, BBC Africa, BBC Middle East, CNA Asia, Times of Israel, Al Arabiya English, MercoPress LatAm, War on the Rocks, Foreign Affairs, CFR, Chatham House, ECFR, The Diplomat, Geopolitical Futures, RNZ World, The Hindu, Politico Europe, Middle East Eye, The Rio Times, AllAfrica News |
| **Crisis** | USGS Earthquakes, ReliefWeb, ISW Daily Updates, ICG CrisisWatch, ACLED |
| **Nation** | NPR US |
| **Business** | CNBC, MarketWatch |
| **Technology** | Ars Technica, The Verge, BleepingComputer, The Hacker News |
| **Science** | NASA, Nature |
| **Health** | WHO News |

### Reddit (via RSS)

CombatFootage, CredibleDefense, UkraineWarVideoReport, GlobalConflict → categorized as **Crisis**

### Telegram (HTML scraping, no API key)

LiveUkraine, bloomberg, War Translated, NEXTA, Kyiv Independent, Intel Slava Z, OSINTdefender, Middle East Eye

Scraped via Cheerio against `t.me/s/<channel>`. Runs concurrently across all channels.

### X / Twitter (multi-strategy, no API key)

@GeoConfirmed, @OSINTtechnical, @Liveuamap, @IntelCrab, @AuroraIntel, @ELINTNews, @DefMon3, @RALee85, @clashreport, @OAlexanderDK, @KofmanMichael, @sentdefender, @IDF, @IsraelWarRoom, @GeoFront5

Resolution order (via `Promise.any` — first success wins):
1. Native Syndication API
2. Nitter RSS mirrors
3. RSSHub instances
4. Google News RSS

### GNews API (optional)

Requires `GNEWS_API_KEY` in `.env.local`. `fetchOSINTGNews()` runs keyword-driven searches: "geolocated", "satellite imagery", "confirmed strike", etc.

---

## Database Schema

### `events` table

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | Primary key (auto-generated) |
| `title` | `text` | Sanitized (surrogate pairs stripped) |
| `description` | `text` | Sanitized |
| `url` | `text` | **UNIQUE** — upsert conflict key |
| `source` | `text` | Human-readable source name |
| `source_type` | `text` | `'rss'`, `'gnews'`, or `'social'` |
| `category` | `text` | `'world'`, `'crisis'`, `'nation'`, etc. |
| `image_url` | `text` | Nullable |
| `published_at` | `timestamptz` | Normalized to ISO 8601 |
| `latitude` | `float8` | Nullable — null = unmapped |
| `longitude` | `float8` | Nullable |
| `location_name` | `text` | Nullable — display name for the pin |
| `tags` | `jsonb` | Array of strings (currently unused by frontend) |
| `created_at` | `timestamptz` | Default: `now()` |

### RLS Policies

- **Public**: `SELECT` allowed (anonymous/anon key)
- **Service role**: `INSERT`, `UPDATE` allowed (scraper uses service role key)
- **No public writes**: Users cannot insert/modify events directly

---

## Environment Variables

| Variable | Required | Used By | Description |
|---|---|---|---|
| `SUPABASE_URL` | Yes | Scraper | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Scraper | Bypass-RLS key for writes. **Never expose client-side.** |
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Frontend (route.ts) | Same URL, public prefix for Next.js client bundling |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Frontend (route.ts) | Anon key for read-only queries (respects RLS) |
| `GNEWS_API_KEY` | No | Scraper | GNews API key. App works without it. |

> **Security note**: `route.ts` uses `NEXT_PUBLIC_SUPABASE_ANON_KEY` (read-only). The `SUPABASE_SERVICE_ROLE_KEY` is only used by the Bun scraper and GitHub Actions secrets. It is never bundled into the client.

---

## Running Locally

```bash
# Install dependencies
npm install

# Start the Next.js dev server
npm run dev

# Run the scraper manually
bun run src/scraper/index.ts

# Dry-run the scraper (no DB writes)
DRY_RUN=true bun run src/scraper/index.ts
```

---

## Common Tasks

| Task | Command / Location |
|---|---|
| Run ingestion worker | `bun run src/scraper/index.ts` or `npm run scrape` |
| Dry-run scraper | `$env:DRY_RUN="true"; bun run src/scraper/index.ts` (PowerShell) |
| Test scraper diagnostics | `npm run test-scraper` or `bun run scripts/test-scraper.ts` |
| Test Supabase connection | `bun run scripts/test-supabase.ts` |
| Run geocoding accuracy test | `npx tsx scripts/evaluate-accuracy.mjs` |
| Run pipeline benchmark | `npx tsx scripts/benchmark-pipeline.mjs` |
| Add a new RSS/Reddit feed | Append to `src/data/sources.ts` |
| Add a new Telegram channel | Add to `TELEGRAM_CHANNELS` in `src/lib/social-feeds.ts` |
| Add a new X account | Add to `X_ACCOUNTS` in `src/lib/social-feeds.ts` |
| Add a landmark | Add to `LANDMARKS` in `src/lib/geocoding/constants.ts` |
| Add a false positive | Add to `FALSE_POSITIVES` in `src/lib/geocoding/constants.ts` |
| Add a stop word | Add to `STOP_WORDS` in `src/lib/geocoding/constants.ts` |
| Rebuild geodata dictionary | `node scripts/build-geodata.mjs` |
| Adjust API cache TTL | Change `CACHE_TTL` in `src/app/api/news/route.ts` (default: 15 min) |

---

## Known Gotchas & Constraints

### Performance
- `geonames.json` is ~4.7 MB. It's loaded at module init in `engine.ts`. This is fine server-side but must **never** be imported client-side.
- The API hardcodes `LIMIT 500`. As the DB grows, older niche-category events will be pushed out. Pagination is not yet implemented.
- `EventSidebar` renders all items via `.map()` with no virtualization. Performance degrades noticeably past ~300 cards.
- `preferCanvas: true` is set on the Leaflet map but Leaflet still uses DOM elements for `DivIcon` markers. True canvas rendering only applies to vector shapes.

### Data Integrity
- **Photon API fallback is permanently disabled** — all geocoding uses the local dictionary only. This is intentional; the API was causing rate-limit bottlenecks.
- **Coordinate jitter** (golden-angle spiral) is applied to all items sharing the same coordinates. This prevents pin stacking but means pin positions are not exact for clustered events.
- **Map framing** ignores latitudes < -60° (Antarctica) when calculating auto-fit bounds to prevent the viewport from zooming out too far.

### Caching
- **Server cache**: In-memory `Map` in `route.ts` with 15-min TTL. Wiped on server restart (Vercel cold starts).
- **Edge cache**: `Cache-Control: public, s-maxage=900, stale-while-revalidate=59` — Vercel edge CDN caches responses for 15 min.
- **Refresh throttle**: Manual refresh button has a 1-minute server-side cooldown to prevent abuse.
- **Client polling**: `useNewsData` polls every 15 minutes via `setInterval`. The refresh button bypasses cache via `?refresh=true` query param.

### Known Duplications (technical debt)
- Filtering logic is duplicated: `route.ts` (lines 84–132) and `useNewsFilter.ts` (lines 43–93) implement identical source/category/time filtering.
- `CATEGORY_COLORS` is defined in both `EventSidebar.tsx` and `MapConstants.tsx`.
- Source badge color logic exists as `getSourceStyle()` in EventSidebar and `getSourceBadgeColor()` in MapConstants.
- `@tailwindcss/postcss` is in `devDependencies` but completely unused — safe to remove.
