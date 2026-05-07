# Seraphim — Project Wiki

> Internal reference for architecture, conventions, and operational knowledge.
> For the roadmap & future plans, see [future.md](./future.md).

---

## What Is Seraphim?

Seraphim is a real-time OSINT (Open-Source Intelligence) news aggregator that scrapes global headlines, extracts geographic locations via NLP + regex heuristics, and plots them on an interactive world map. It combines RSS feeds, social media (Telegram, X/Twitter), Reddit, and the GNews API into a single filterable intelligence dashboard.

---

## Tech Stack

| Layer               | Technology                      | Notes                                                                                                             |
| ------------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| **Framework**       | Next.js 16.2.4 (App Router)     | React 19.2.5, deployed to Vercel                                                                                  |
| **Language**        | TypeScript                      | Strict mode, version 6.0.3                                                                                        |
| **Styling**         | Vanilla CSS                     | CSS Modules for component isolation. Base tokens in `globals.css`                                                 |
| **Testing**         | Vitest                          | Unit/Integration/Accuracy testing (~130 tests)                                                                    |
| **Database**        | Supabase (PostgreSQL + PostGIS) | `events` (Story model), `user_profiles`, `user_bookmarks`. `pgvector` enabled. |
| **Semantic Search** | pgvector (HNSW index)           | Vector-based similarity for story clustering (Phase 3.1)                                                          |
| **Rate Limiting**   | @upstash/ratelimit              | **Hybrid L1/L2**: Local in-memory cache + Global Redis sync. Includes fail-open stability and timeout protection. |
| **Theme**           | next-themes                     | Flash-free theme hydration with `attribute="data-theme"`                                                          |
| **Sanitization**    | isomorphic-dompurify            | Strips XSS payloads from scraped titles/descriptions                                                              |
| **Scraper Runtime** | Bun                             | Native TS execution, 30x faster cold starts than Node                                                             |
| **Map**             | MapLibre GL JS 5.1              | WebGL-accelerated rendering. Replaces Leaflet 1.9                                                                 |

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
Seraphim/
├── .github/workflows/
│   ├── main.yml                    # GitHub Actions cron — runs scraper every 30 min
│   └── test.yml                    # CI workflow — runs Vitest suite on push/PR
├── data/
│   ├── cities5000.txt              # GeoNames raw city data (~14 MB)
│   ├── admin1CodesASCII.txt        # GeoNames admin1 regions
│   └── geonames.json               # Compiled geodata (~4.7 MB) — DO NOT EDIT BY HAND
├── scripts/
│   ├── build-geodata.mjs           # Compiles cities5000 + admin1 → geonames.json
│   ├── evaluate-accuracy.mjs       # Geocoding regression test against graded samples
│   ├── test-real-geocode.ts        # Geocoding Benchmarker (generates 400-item set)
│   └── results/
│       ├── geocode-benchmark-400.json # Current 400-item grading set for engine improvements
│       └── re-map-locations.ts        # Utility to retroactively update DB entries with improved NLP logic
├── src/
│   ├── app/
│   │   ├── api/news/route.ts       # Supabase proxy with Hybrid Rate Limiting
│   │   ├── globals.css             # Base resets, design tokens, and global typography
│   │   ├── layout.tsx              # Root layout — Providers, fonts, analytics
│   │   └── page.tsx                # Main page — orchestrates sidebar + map
│   ├── components/
│   │   ├── Providers.tsx           # next-themes ThemeProvider wrapper
│   │   ├── ThemeToggle.tsx         # Refactored to use useTheme() hook
│   │   ├── ThemeToggle.module.css  # Scoped toggle styles (icons, hover, shadows)
│   │   ├── map/
│   │   │   ├── NewsMap.tsx         # MapLibre map with Resolution-Aware View State logic
│   │   │   ├── MapConstants.tsx    # Centralized styling helper exports
│   │   │   └── index.tsx           # Barrel export
│   │   └── EventSidebar.tsx        # Sidebar (uses centralized colors)
│   ├── scraper/
│   │   ├── index.ts                # Bun worker entry — fetch → dedup → geocode → upsert
│   │   └── utils/
│   │       └── transforms.ts       # HTML sanitization via DOMPurify
│   ├── lib/
│   │   ├── colors.ts               # Source of truth for OSINT colors
│   │   └── geocoding/
│   │       ├── engine.ts           # Core logic (server-only protected)
│   │       └── constants.ts        # Manual OVERRIDE_LOCATIONS (e.g. Georgia)
```

---

## Data Pipeline

### High-Level Flow

```
┌─────────────────────────────────────────────────────────┐
│  Bun Scraper Worker  (src/scraper/index.ts)             │
│                                                         │
│  1. Fetch all sources concurrently (Promise.allSettled)  │
│  2. Pre-fetch known URLs from DB (chunks of 20)         │
│     └── Reduced chunk size for URI length safety        │
│                                                         │
│  3. Geocode NEW items only                              │
│                                                         │
│  4. Sanitize & upsert (chunks of 50)                    │
│     ├── cleanString() — HTML sanitization via DOMPurify │
│     └── Per-row fallback on chunk failure                │
└─────────────────────────────────────────────────────────┘
              ↓ (Every 30 min via GitHub Actions)
│  └── Implemented: Phase 3.1 "Story" model (JSONB sources + pgvector)  │
└─────────────────────────────────────────────────────────┘
               ↓
┌─────────────────────────────────────────────────────────┐
│  /api/news/route.ts  (Next.js Edge Route)               │
│  ├── Hybrid Rate Limiting:
│  │   ├── Tier 1: Local L1 (10 reqs/10s free burst)
│  │   └── Tier 2: Upstash Redis (Global sync every 5th req)
│  │   └── Fail-Open: Graceful recovery if Redis connection times out or fails
│  ├── BBox Epsilon (0.00001) for stable edge queries
│  └── Cache-Control: s-maxage=60 (Edge CDN)
└─────────────────────────────────────────────────────────┘
```

---

## Geocoding System

> **Location**: `src/lib/geocoding/`
> **⚠️ Server-only** — Module protected via `require('server-only')`.
> **Bypass**: Set `IS_BENCHMARK="true"` or `NODE_ENV="test"` for CLI tools.

### Disambiguation & Overrides

The engine uses a tiered lookup strategy with manual overrides to resolve naming collisions:

1. **OVERRIDE_LOCATIONS** (`constants.ts`): Highest priority. Explicitly maps "Georgia" → country centroid to avoid state shadowing.
2. **Dictionary Priority**: Landmark > Mega-City (>1M) > Country > City > Admin1.
3. **Accuracy Benchmarking**: `scripts/evaluate-accuracy.mjs` runs regressions against a 400-item "ground truth" set (`geocode-benchmark-400.json`).
4. **NLP Refinement**: Dedicated heuristics to handle common false positives (e.g., "Ray" extraction bug) and improved disambiguation via placement penalties.

---

## UI Architecture

### Theme System (next-themes)

- **Initialization**: Managed by `src/components/Providers.tsx`.
- **Hydration**: Uses `suppressHydrationWarning` on `html` and `body` tags.
- **Access**: Components use the `useTheme()` hook.
- **Persistence**: Automatically syncs with `localStorage` and prefers system settings if enabled.
- **Elimination of FOUC**: The `attribute="data-theme"` injection on the server ensures no light-mode flash on dark-mode load.

### Map Rendering (MapLibre)

- **Resolution-Aware View State**: The initial zoom and center are calculated via `getInitialViewState()` using linear interpolation (Lerp).
  - **Scaling**: Interpolates between 1200p (zoom 1.2) and 1440p/2K (zoom 2.1) to maintain consistent visual density across high-res monitors.
  - **Clamping**: Overcomes default Mercator latitude clamping by relaxing `maxBounds` and using a delayed `jumpTo` injection after map readiness.
- **Reliability**: Implements strict numeric validation (Number.isFinite) to prevent initialization crashes caused by NaN or null values.
- **Style Persistence**: Layers are re-added via `style.load` events, ensuring pins survive map style toggles.

### Styling & Colors

- **Centralized Colors**: `src/lib/colors.ts` is the single source of truth for category and source colors.
- **OSINT Palette**: High-contrast, standard tones for Bellingcat, ISW, and Telegram sources.
- **CSS Modules**: All new components (`ThemeToggle`, `FilterBar`, etc.) use scoped `.module.css` files to prevent global namespace pollution.
- **Mobile UX**:
  - **Swipe-to-Collapse**: Sidebar supports gesture-based interaction on mobile.
  - **Horizontal Filters**: Filter bar uses a touch-friendly scrolling layout with a persistent search input.
  - **Custom Datetime Picker**: A robust, timezone-aware date filter for precise OSINT time-windowing.

---

## Known Gotchas & Constraints

### Environment Limits

- **Upstash Free Tier**: 10,000 commands/day. The hybrid L1/L2 strategy is designed to stay well within this limit by absorbing burst traffic locally.
- **Supabase Egress**: Description fields are lazy-loaded to minimize data transfer costs.

### Security

- **Large Geodata**: `geonames.json` (~4.7 MB) must never reach the client. The `server-only` directive provides a build-time guardrail.
- **XSS**: All scraped content must pass through `cleanString()` (DOMPurify) before database insertion.

---

## Technical Findings & Quirks

During a full codebase documentation audit, the following technical patterns and quirks were identified:

### Ingestion & Data Handling

- **SSL Bypass**: `src/lib/rss.ts` explicitly disables SSL certificate validation (`rejectUnauthorized: false`) for certain legacy or problematic news sources.
- **Surrogate Pair Sanitization**: `src/scraper/utils/transforms.ts` includes specialized regex to strip incomplete UTF-16 surrogate pairs, preventing database serialization errors.
- **URI Length Protection**: `src/scraper/index.ts` uses small chunk sizes (20) for Supabase filters to avoid hitting GET request URI length limits.
- **CrisisWatch Normalization**: `src/scraper/utils/date.ts` handles the non-standard date formats used by ICG CrisisWatch via dedicated regex.

### Social Media Resolution

- **Multi-Tier Fallback**: X (Twitter) resolution uses a four-tier strategy: Native Syndication -> Nitter -> RSSHub -> Google News RSS.
- **Emoji-Safe Truncation**: `safeSlice` in `social-feeds.ts` uses `Array.from()` to ensure string truncation doesn't break multi-byte characters (emojis).

### Geocoding & Map Engine

- **Disambiguation Bias**: The engine prioritizes certain geographic entities based on OSINT context (e.g., favoring Georgia the country over the US state).
- **Log2 Zoom Scaling**: Initial map zoom is calculated using a log2 scale based on the window's bounding box dimensions.
- **Golden-Angle Jitter**: Overlapping pins are distributed using a golden-angle spiral to maintain visibility.
- **Server-Side Clustering**: Server-side `ST_ClusterDBSCAN` logic in Supabase is used for zoom levels < 5, with unique synthetic IDs generated to prevent "stuck" markers.

### API & Performance

- **Fail-Open Rate Limiting**: The Upstash Redis rate limiter is wrapped in a fail-open mechanism, ensuring API availability if the Redis service times out.
- **BBox Snapping Grid**: Uses a dynamic snapping grid (0.5 to 10 degrees) to maximize client-side cache hits when panning the map.
- **Lazy Description Loading**: Descriptions are excluded from the main list fetch and loaded on-demand to reduce initial payload size by ~40%.
- **Story Consolidation (Re-Cluster)**: A dedicated `re-cluster.ts` script manages historical backfills, ensuring that semantically similar events are merged into a single "Master" story. 
- **Tiered Similarity thresholds**: 
    - 0.85: Strict (Global match)
    - 0.75: Place-Anchored (Similarity + matching location name)
    - 0.60: Proximity-Anchored (Similarity + <50km distance)
- **Master Story Selection**: When merging, the system chooses the story with the highest credibility tier (Diamond > Gold > Silver). If tiers match, it chooses the most detailed (longest) content.
- **News Feed Synchronization (Pulse Logic)**: The `published_at` timestamp is dynamically synced to the `discoveredAt` date of the **latest source** added to a story cluster. This ensures that old stories with new updates "pulse" back to the top of the feed.
- **API result capping**: The `/api/news` endpoint returns an `isCapped` boolean flag if the result set reaches the server-side limit (currently 2,000 items). The UI reflects this with a **"+"** indicator (e.g., "2,000+ stories").
- **Semantic Foundation**: The database is now `pgvector`-ready with HNSW indexing, supporting sub-millisecond similarity lookups for real-time deduplication.

---

## Testing

- **Vitest**: Server-only modules are mocked in `vitest.config.ts` using `scripts/tests/mocks/server-only.ts`.
- **Mocking**: Styling tests must be updated in `utils.test.ts` whenever the central color palette is refined.
