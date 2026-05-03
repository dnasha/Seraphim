# Seraphim — Project Roadmap

> A living document. Tracks what's been built, what needs hardening, and what's next — in order.

---

## ✅ What Is Already Done

Everything below is implemented, merged, and working in the current codebase.

### Database & Backend Architecture

- **Supabase (PostgreSQL + PostGIS)** replaces the old in-memory/file-based system. The `events` table uses `url` as a unique constraint for upsert deduplication.
- **Decoupled Bun scraper worker** (`src/scraper/index.ts`) — runs independently of the Next.js process. Fetches all sources concurrently via `Promise.allSettled`, geocodes new items only (pre-filters against known DB URLs), and upserts in batches of 50 with per-row fallback on chunk failure.
- **GitHub Actions cron** (`.github/workflows/main.yml`) triggers the scraper every 30 minutes.
- **Pre-fetch deduplication** — before geocoding, the scraper queries Supabase for existing URLs in chunks of 50 to skip redundant NLP work. The DB unique constraint acts as a second safety net.
- **Data sanitization pipeline** — `ensureIsoDate()` normalizes non-standard RSS date formats (e.g., ICG CrisisWatch's `"Friday, April 10, 2026 - 16:35"`). `cleanString()` strips orphaned UTF-16 surrogate pairs to prevent Postgres JSONB encoding failures.

### Geocoding Engine (`src/lib/geocoding/`, ~40KB across 6 files)

- **Multi-strategy extraction**: dateline regex → comma-pair → action-target regex → sliding-window dictionary scan → `compromise` NLP fallback → country abbreviation → demonym fallback → direct country scan.
- **78K+ location dictionary** compiled from GeoNames (`cities5000.txt` + `admin1CodesASCII.txt` → `data/geonames.json`). Load order: cities (population-weighted) → admin1 regions → countries → hardcoded landmarks (Pentagon, Kremlin, Gaza, etc.).
- **Candidate scoring system** with source priority (action-target wins over dateline) and type priority (landmark > mega-city > country > city > admin1). Context penalties for superpowers (+10, to prioritize strike targets over actors) and continents (+20).
- **False positive filtering** blocks brand/team names ("Arsenal", "Amazon"). `NEWS_SOURCE_DEFAULTS` provides fallback locations for source-specific articles (e.g., NASA → Washington DC).
- **Golden-angle spiral jitter** prevents pin stacking at identical coordinates.

### Source Coverage

- **RSS** (~30 feeds): BBC, Al Jazeera, NYT, DW, France 24, SCMP, ISW, ReliefWeb, USGS Earthquakes, ICG CrisisWatch, Ars Technica, BleepingComputer, NASA, Nature, WHO, and more. Centralized in `src/data/sources.ts`.
- **Reddit** (4 subreddits): CombatFootage, CredibleDefense, UkraineWarVideoReport, GlobalConflict.
- **Telegram** (8 channels): HTML-scraped via Cheerio — Kyiv Independent, NEXTA, Intel Slava Z, OSINTdefender, War Translated, bloomberg, LiveUkraine, Middle East Eye.
- **X / Twitter** (15 accounts): Multi-strategy resolution via `Promise.any` — Native Syndication API → Nitter mirrors → RSSHub → Google News RSS.
- **GNews API** (optional): Keyword-driven OSINT searches.

### Frontend & UI

- **Next.js 16** (App Router) with **React 19**. Single `page.tsx` orchestrating `EventSidebar`, `FilterBar`, and `NewsMap` via two custom hooks (`useNewsData`, `useNewsFilter`).
- **API route** (`/api/news/route.ts`): Supabase proxy with 15-minute in-memory cache, Edge CDN `Cache-Control` headers, and a 1-minute refresh throttle. Fetches top 500 events ordered by `published_at`.
- **Leaflet 1.9 map** with custom smooth zoom system — replaces Leaflet's default `scrollWheelZoom` with a `requestAnimationFrame` lerp loop calling `_move()` per frame and `_moveEnd()` on settle. Sub-pixel rendering via monkey-patching `_getNewPixelOrigin`, `latLngToLayerPoint`, and `GridLayer._setZoomTransform` to remove `._round()` calls during animation.
- **Marker system**: `DivIcon`-based category markers (26px normal / 36px active) with `IconCache` to prevent redundant object creation. Selected markers get a CSS "sonar pulse" animation and glow. Highlighting uses direct DOM class manipulation (Ref-based) to avoid React reconciliation.
- **Clustering**: Server-side clustering (zoom < 5) enabled by default. Client-side `leaflet.markercluster` is disabled. Power users can toggle "Force individual pins" to bypass server-side grouping.
- **Map styles**: Standard (Voyager), Dark — auto-switching with theme. Settings panel with gear icon toggle.
- **Sidebar**: Fixed 400px width, collapsible. Logo (Cinzel Decorative font), stat pills (article count, mapped count, last-updated timestamp), filter bar, scrollable card list. Cards show 88×66px thumbnails, source badge, time-ago, location pin. Unmapped articles expand inline; mapped articles fly the map to the pin.
- **Filtering**: Source toggles (News/Reddit/X/Telegram/GNews), category pills, time range (1D/3D/1W/1M/All), "Mapped Only" toggle, debounced search. Client-side `useMemo` filtering for instant toggling.
- **Theme**: Light mode default (prevents FOUC). Persistent via `localStorage`. Dark mode overrides via `[data-theme="dark"]` CSS custom properties.
- **Mobile responsive**: Sidebar becomes a slide-in overlay at ≤860px. Map fills full viewport.
- **Performance**: `preferCanvas: true`, `will-change` hints, `backface-visibility: hidden` isolation, aggressive memoization of the card list.
- **Security**: URL protocol validation in scraper, RLS policies on Supabase, `SUPABASE_SERVICE_ROLE_KEY` never exposed to client (only anon key used in route.ts).
- **Analytics**: `@vercel/analytics` and `@vercel/speed-insights` integrated.
- **Dependency Upgrades**: Upgraded to **Next.js 16.2.4**, **React 19.2.5**, and **TypeScript 6.0.3**. Verified all peer dependencies and resolved PostCSS security vulnerabilities via `overrides`.

### Phase 0: Housekeeping & Foundations

- **CSS Modularization**: Split the `globals.css` monolith into component-specific CSS modules and consolidated duplicate rules.
- **Deduplication**: Removed redundant filtering logic from the API route (now client-side only) and centralized category/source colors into `src/lib/colors.ts`.
- **Component Decomposition**: Refactored `NewsMap.tsx` (664 lines) into specialized modules (`smoothZoom.ts` and `markerManager.ts`) for significantly improved maintainability.
- **Testing Infrastructure**: Installed Vitest with 127 tests across 6 suites covering utilities, data transforms, geocoding engine (50+ headline cases), enricher pipeline, filter logic, and accuracy regression. Achieved **96.5% accuracy** on a 256-sample graded corpus, significantly exceeding the initial <10% failure target. Extracted `cleanString`/`newsItemToDbEvent` to `src/scraper/utils/transforms.ts` and filter logic to `src/lib/filters.ts` for testability. Added CI workflow (`.github/workflows/test.yml`) and `npm test` / `npm run test:watch` / `npm run test:accuracy` scripts.
- **Geocoding Accuracy (v2)**: Restored single-word scanning with strict population-based filtering (min 5,000 for standard cities) and type-based priority. Refined synonym matching and admin1 weighting to reduce false positives from actors (e.g., "U.S.") while prioritizing event locations.
- **Infrastructure & DX**:
  - Fixed Bun lockfile synchronization issues in GitHub Actions CI.
  - Refactored `src/lib/rss.ts` to use standard ES module imports and replaced `@ts-ignore` with `@ts-expect-error`.
  - Sanitized test files in `scripts/tests` by removing non-standard em-dash characters from comments for better cross-platform compatibility.
- **Animation Restoration**: Fixed broken loading wheel and refresh animations caused by CSS modularization. Defined local `@keyframes spin` within `EventSidebar.module.css` to ensure self-contained, reliable UI feedback.
- **API Route Hardening**: Implemented cursor-based pagination and a `?include_unmapped=true` flag in `/api/news/route.ts` to reduce payload sizes and support "load more" infinite scrolling in the UI.
- **Performance & Build Audit**: Ran bundle audits to ensure `geonames.json` is safely tree-shaken from Next.js client bundles. Evaluated `EventSidebar` render performance (stable at current scales) and documented Leaflet `preferCanvas` limitations with `DivIcon` elements for future MapLibre migration context.

### Phase 1: API & Data Fetching (Scale Enablers)

- **Bounding Box (BBox) Querying**: Modified `/api/news` to accept `minLat/maxLat/minLng/maxLng`. Implemented debounced (400ms) viewport updates in `NewsMap.tsx` to trigger refetches. Added client-side bbox-keyed caching in `useNewsData.ts` to prevent redundant DB hits when panning back to previously viewed areas.
- **Supabase Realtime**: Replaced 15-minute polling with a Supabase Realtime `INSERT` subscription. Implemented client-side viewport filtering so only events within the current bounding box are injected into the UI, reducing noise and re-render cycles.
- **Database Egress Optimization**: Optimized initial list fetch by excluding the `description` field (~40% payload reduction). Implemented an on-demand detail endpoint (`/api/news/[id]`) that lazy-loads descriptions when a user expands a sidebar card or clicks a map pin.
- **Live-Patching Map Popups**: Implemented a specialized `updatePopupDescription` mechanism in `MarkerManager` that patches live Leaflet popups and their internal `setContent` buffers when lazy-loaded data arrives, avoiding costly marker re-creations.
- **Sidebar Virtualization**: Integrated `react-virtuoso` to replace the standard `.map()` card list. Reduced DOM node count from 500+ to ~15 constant nodes. Refactored auto-scroll logic to use `virtuosoRef.current.scrollToIndex` for perfect synchronization with map selection.
- **Server-Side Clustering (ST_ClusterDBSCAN)**: Implemented support for the `public.get_clustered_events` Supabase RPC. The API now returns aggregated cluster objects (`clusterId`, `eventCount`) when zoomed out, drastically reducing JSON payload size.
- **Native Cluster Rendering**: Updated `MarkerManager` to detect and render server-side clusters using custom `.cluster-icon` styles, providing a seamless visual transition from individual pins to grouped data.
- **Frontend Event System Rethink**:
  - **Viewport-Driven Fetching**: Removed manual pagination. The map BBox + current Zoom + active TimeRange is now the single source of truth for the data window.
  - **Time-Aware Clustering**: Updated the Supabase RPC and API route to accept a `since` timestamp, ensuring server-side clusters respect the client's time filter.
  - **Smart Camera Behavior**: Implemented a suppression system (`onBeforeFly`) to prevent selection-triggered zooms from causing redundant BBox re-fetches. Added `lastFlewToId` tracking to prevent jitter/rubber-banding.
  - **Stability & Performance Fixes**:
    - **BBox Snapping Grid**: Implemented a dynamic grid system (0.5 to 10 degrees) in `useNewsData.ts` to expand bounding box queries. This maximizes client-side cache hits during panning, drastically reducing database read volume and providing near-instant UI feedback.
    - **Synthetic Cluster IDs**: Resolved the "stuck cluster" bug by assigning unique IDs (`cluster-[zoom]-[id]`) to server-side clusters in the API route. This ensures proper marker destruction when transitioning between zoom levels.
    - **Realtime Cache Consistency**: Updated the Supabase Realtime handler to inject newly inserted events into the `bboxCache`. This prevents new items from disappearing when the user pans the map immediately after a data arrival.
    - **Navigation Loop Resolution**: Removed automatic map panning/zooming on data refresh and filter changes. Fixed React `useEffect` dependency warnings and properly type-cast API query builders.
- **Large Set Protection**: Integrated automatic server-side clustering at zoom < 5.

### Phase 2: UI Rendering & Performance (Browser Savers)

- **Interaction Snappiness**: Optimized map viewport polling with a 150ms debounce (reduced from 400ms). The UI now feels instantaneous when moving the map.
- **Greedy Client-Side Caching**: Implemented an accumulation-based state manager in `useNewsData.ts`. Individual pins are now merged into a persistent client-side pool, preventing "empty map" flickering when panning back to previously loaded areas.
- **Dynamic BBox Grid Expansion**: Scaled the BBox snapping logic and increased the API `RAW_LIMIT` to 2000 events. This allows for massive, pre-cached data "tiles" that minimize database egress.
- **Advanced Cluster Visualization**:
  - **Non-Linear Scaling**: Clusters scale logarithmically (14px to 36px) to maintain clarity without overcrowding.
  - **Count-Based Sorting**: Implemented `symbol-sort-key` priority—larger clusters are always drawn on top of smaller ones.
  - **Collision-Aware Labels**: Optimized collision detection and `text-padding` to hide redundant underlying labels, ensuring a clean "pro" look at all zoom levels.
  - **Smooth Opacity Gradients**: Dynamic `circle-opacity` (0.65 to 0.95) based on event volume, providing a glassy, premium aesthetic.
- **Synchronized Cluster Break-Apart**: Aligned client-side MapLibre clustering with the server-side `CLUSTER_ZOOM_THRESHOLD` (5) for a seamless transition from global groups to individual pins.
- **Environmental Overlays & Map Tools**:
  - **Action Menu**: Created a floating bottom-right action area with animated submenus.
  - **Live Data Feeds**: Integrated real-time USGS Earthquake feed (24h), NOAA Weather Radar (Live NEXRAD tiles), and NASA EONET (Disaster events from past 30 days).
  - **Deferred: Drawing Engine** (`temp_drawing/`): A custom native MapLibre GL drawing engine has been prototyped and moved to a temporary directory for future integration. It supports Polygon, Rectangle, Circle, Freehand, and Select modes with live GeoJSON preview rendering.
  - **Mobile Accessibility**: Refactored the MapActionTools toolbar with increased touch targets (44px) and a responsive layout for improved mobile usability.
  - **Stability Fixes**: Refactored Supabase client to a singleton to prevent Auth instances warnings.

---

## 📊 Phase 3: Data Architecture & Aggregation (Analyst Experience)

_Goal: Shift from raw scraped links to coherent "stories" using semantic clustering, and future-proof the schema for advanced features without losing historical data._

### 3.1 — Schema Evolution (The "Story" Model)
- **Action**: Create a safe Supabase migration to upgrade the `events` table without downtime.
- **New Columns**:
  - `embedding vector(384)`: Stores semantic embeddings of `title + description` using `pgvector`. Will include an HNSW index (`CREATE INDEX ON events USING hnsw (embedding vector_cosine_ops)`) for fast similarity matching.
  - `sources JSONB`: Replaces the strict 1:1 event-to-url mapping. Stores an array of `{ name, url, source_type, discovered_at }`. The original `url` column remains as the "lead" deduplication key for raw upserts.
  - `impact_score INTEGER DEFAULT 0`: A pre-calculated score based on source credibility, unique source count, and keyword triggers.
  - `credibility_tier INTEGER DEFAULT 3`: Tracks the highest credibility tier (1: Wire, 2: Curated OSINT, 3: Raw Social) present in the `sources` array.
- **Tags**: Ensure the existing `tags JSONB` column is indexed and actively populated by NER models.
- **UI Impact**: One pin per story instead of overlapping pins. Sidebar "Story Cards" show a primary headline with nested source favicons. Pin sizes scale with `impact_score`.

### 3.2 — Zero-Cost Vectorization Pipeline
- **Action**: Implement semantic embedding generation directly in the Bun ingestion worker using `@huggingface/transformers`.
- **How it works**: Runs the `all-MiniLM-L6-v2` ONNX model natively in JS using the CPU/WASM backend. No external API keys (OpenAI/Pinecone) or usage costs required.
- **CI/CD Integration**: The GitHub Actions runner handles this perfectly. Model weights (~22MB) are cached using `actions/cache` to ensure the 30-minute cron jobs remain fast and free.
- **Merge Logic**: Before upserting a new item, the worker calculates cosine similarity against events from the last 48 hours. If similarity is `> 0.85`, it appends the new source to the existing event's `sources` array instead of creating a new pin.

### 3.3 — Data Renewal Tooling (`scripts/tools/`)
- **Action**: Establish a suite of idempotent CLI scripts to safely re-process historical data when our algorithms improve.
- **`re-geocode.ts`**: Re-runs `extractLocation` over all existing DB rows using the latest NLP dictionary, updating coordinates without destroying URLs or timestamps.
- **`re-vectorize.ts`**: Runs locally to backfill embeddings for the historical archive. Essential for when the embedding model is first introduced or if we change dimensions in the future.
- **`re-cluster.ts`**: Retroactively consolidates older, overlapping pre-Phase-3 events into the new `sources` JSONB array structure based on spatial/semantic distance.

---

## 🎯 Phase 4: Advanced OSINT Controls (The "Wow" Factor)

_Goal: Give analysts the tools to slice data logically. These are the features that make people share the link._

### 4.1 — Temporal Scrubber (Time Slider)
- **Action**: Add a horizontal range slider at the bottom of the map. Users drag a handle to scrub through the last 7 days hour-by-hour. The map animates pins appearing/disappearing based on `published_at`.
- **Implementation**: A React component with a `<input type="range">` controlling a `maxTimestamp` state. The map layer filters its GeoJSON source by timestamp on each slider change. Include a "Play" button for auto-advance.

### 4.2 — Source Credibility Tier Filtering
- **Action**: Add a `credibility_tier` field to `src/data/sources.ts` for every source:
  - **Tier 1 (Verified)**: Reuters, AP, BBC, NYT — wire services and established editors.
  - **Tier 2 (Curated OSINT)**: Liveuamap, ISW, OSINTtechnical — respected analyst accounts.
  - **Tier 3 (Raw Social)**: Raw Telegram channels, unverified X accounts.
- **UI**: A 3-toggle filter row in the FilterBar. Analysts can quickly toggle off Tier 3 to see only confirmed reporting.

### 4.3 — View State Syncing (URL Deep Links)
- **Action**: Encode the current map center, zoom level, active filters, and search query into URL search parameters.
- **Implementation**: Use `useSearchParams` or a custom hook that syncs state bidirectionally with `window.history.replaceState`.

---

## 🌐 Phase 5: Distribution, Monetization & Platform

_Goal: Turn Seraphim from a project into a product with user accounts and usage tiers._

### 5.1 — User Auth & Usage Tiers (Supabase Auth)
- **Action**: Integrate Supabase Auth and execute a migration for user-specific data.
- **New Tables**:
  - `user_profiles`: Stores `tier` ('free', 'pro'), `stripe_customer_id`, and preferences.
  - `user_bookmarks`: Stores `user_id`, `event_id`, and personal notes.
  - `user_geofences`: Stores `user_id`, `polygon`, and `alerts_enabled`.
- **Enforcement (API Tiering)**:
  - **Free Tier**: Limited to 7 days of history (enforced via `p_since` in API). Standard rate limits.
  - **Pro Tier**: Unlimited historical archive. High-frequency rate limits. Access to GeoJSON/KML exports.

### 5.2 — Dynamic Open Graph (OG) Previews
- **Action**: Use `@vercel/og` to render map thumbnail cards when URLs are shared. Requires Phase 4.3.

### 5.3 — Automated Geofence Alerts
- **Action**: Edge Function triggered by new inserts calls `ST_Within()` against `user_geofences`. Sends email/push notifications to Pro users.

### 5.4 — AI-Powered Summarization & RAG
- **Action**: Use `pgvector` embeddings as the retrieval layer for a RAG pipeline. Users type natural language queries and receive LLM-generated summaries citing relevant events.

---

## Tech Stack Evolution

| Feature               | Past (Leaflet)                    | Present (MapLibre)                 | Notes                                        |
|-----------------------|-----------------------------------|------------------------------------|----------------------------------------------|
| **Map Engine**        | Leaflet 1.9 (DOM-based)           | MapLibre GL JS (WebGL)             | (Completed) GPU rendering: 100K+ points      |
| **Map Tiles**         | OpenStreetMap raster (Voyager)    | Protomaps PMTiles on Cloudflare R2 | Vector tiles, $0 egress, custom styling      |
| **Map Action Tools**  | None                              | `MapActionTools.tsx`               | (Partial) Overlays enabled, Drawing Deferred |
| **Sidebar Rendering** | `react-virtuoso` virtualized list | (Completed)                        | Only renders ~15 visible cards vs. all 5,000 |
| **Data Fetching**     | BBox + server-cluster queries     | (Completed)                        | 10× smaller payloads, no wasted bandwidth    |
| **Realtime Updates**  | Supabase Realtime WebSocket       | (Completed)                        | Sub-second new event delivery                |
| **Deduplication**     | URL unique constraint only        | `pgvector` semantic clustering     | "Stories" instead of 5 redundant pins        |
| **Hosting**           | `seraphi.me` on Vercel            | (Completed)                        | Public-facing, CDN-cached, zero-downtime     |
| **Auth**              | None                              | Supabase Auth + Stripe             | User accounts, saved views, Pro tier         |

---

## 🛠️ Engineering & Performance Backlog

### Viewport-Aware State Eviction
As users pan around the world, the client-side `news` state currently accumulates every pin retrieved from the API. Implement an eviction policy in `useNewsData.ts` to keep the active set under ~2,000 items.

### Server-Side Realtime Filtering
Update the Realtime subscription to use server-side filters (e.g., by category or source) matching the user's active UI state, reducing unnecessary egress and client CPU usage.

### Geodata Runtime Optimization
Move the `KNOWN_LOCATIONS` dictionary build to `build-geodata.mjs`, pre-calculating the optimized structure so the runtime only needs to perform a single `JSON.parse` call.

### Phase 2.5: Advanced Visualization & Tiles (Deferred)
Fine-tune the new MapLibre engine for absolute visual perfection. Serve OSINT-specific vector tiles (OpenStreetMap-based) from Cloudflare R2 via Protomaps PMTiles to achieve crisp labels at all zoom levels and $0 egress.
