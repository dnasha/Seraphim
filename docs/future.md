# Seraphim Project Roadmap

> A living document. Tracks what's been built, what needs hardening, and what's next in order.

---

## What Is Already Done

Everything below is implemented, merged, and working in the current codebase.

### Database & Backend Architecture

- **Supabase (PostgreSQL + PostGIS)** replaces the old in-memory/file-based system. The `events` table uses `url` as a unique constraint for upsert deduplication.
- **Decoupled Bun scraper worker** (`src/scraper/index.ts`) runs independently of the Next.js process. Fetches all sources concurrently via `Promise.allSettled`, geocodes new items only (pre-filters against known DB URLs), and upserts in batches of 50 with per-row fallback on chunk failure.
- **GitHub Actions cron** (`.github/workflows/main.yml`) triggers the scraper every 30 minutes.
- **Pre-fetch deduplication** before geocoding, the scraper queries Supabase for existing URLs in chunks of 50 to skip redundant NLP work. The DB unique constraint acts as a second safety net.
- **Data sanitization pipeline** `ensureIsoDate()` normalizes non-standard RSS date formats (e.g., ICG CrisisWatch's `"Friday, April 10, 2026 - 16:35"`). `cleanString()` strips orphaned UTF-16 surrogate pairs to prevent Postgres JSONB encoding failures.

### Geocoding Engine (`src/lib/geocoding/`, ~40KB across 6 files)

- **Multi-strategy extraction**: dateline regex → comma-pair → action-target regex → sliding-window dictionary scan → `compromise` NLP fallback → country abbreviation → demonym fallback → direct country scan.
- **78K+ location dictionary** compiled from GeoNames (`cities5000.txt` + `admin1CodesASCII.txt` → `data/geonames.json`). Load order: cities (population-weighted) → admin1 regions → countries → hardcoded landmarks (Pentagon, Kremlin, Gaza, etc.).
- **Candidate scoring system** with source priority (action-target wins over dateline) and type priority (landmark > mega-city > country > city > admin1). Context penalties for superpowers (+10, to prioritize strike targets over actors) and continents (+20).
- **False positive filtering** blocks brand/team names ("Arsenal", "Amazon"). `NEWS_SOURCE_DEFAULTS` provides fallback locations for source-specific articles (e.g., NASA → Washington DC).
- **Golden-angle spiral jitter** prevents pin stacking at identical coordinates.

### Source Coverage

- **RSS** (~30 feeds): BBC, Al Jazeera, NYT, DW, France 24, SCMP, ISW, ReliefWeb, USGS Earthquakes, ICG CrisisWatch, Ars Technica, BleepingComputer, NASA, Nature, WHO, and more. Centralized in `src/data/sources.ts`.
- **Reddit** (4 subreddits): CombatFootage, CredibleDefense, UkraineWarVideoReport, GlobalConflict.
- **Telegram** (8 channels): HTML-scraped via Cheerio Kyiv Independent, NEXTA, Intel Slava Z, OSINTdefender, War Translated, bloomberg, LiveUkraine, Middle East Eye.
- **X / Twitter** (15 accounts): Multi-strategy resolution via `Promise.any` Native Syndication API → Nitter mirrors → RSSHub → Google News RSS.
- **GNews API** (optional): Keyword-driven OSINT searches.

### Frontend & UI

- **Next.js 16** (App Router) with **React 19**. Single `page.tsx` orchestrating `EventSidebar`, `FilterBar`, and `NewsMap` via two custom hooks (`useNewsData`, `useNewsFilter`).
- **API route** (`/api/news/route.ts`): Supabase proxy with 15-minute in-memory cache, Edge CDN `Cache-Control` headers, and a 1-minute refresh throttle. Fetches top 500 events ordered by `published_at`.
- **MapLibre GL JS map** with high-performance WebGL rendering. Sub-pixel marker placement and smooth camera transitions. Custom BBox-snapping grid for aggressive client-side caching.
- **Marker system**: Symbol-layer based category icons with dynamic sizing and sonar-pulse animations. Highlighting uses direct layer filtering to avoid React reconciliation.
- **Clustering**: Server-side clustering (zoom < 5) via PostGIS ST_ClusterDBSCAN. Client-side clustering via MapLibre's native source clustering for intermediate levels.
- **Map styles**: Custom Voyager-inspired vector styles, Dark auto-switching with theme. Floating MapActionTools toolbar for environmental overlays.
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
- **API Route Hardening**:
  - Implemented cursor-based pagination and a `?include_unmapped=true` flag.
  - **Hybrid Rate Limiting Stability**: Refactored the rate limiter with a `try-catch` wrapper and a fail-open mechanism to prevent unhandled Redis rejections from crashing the API.
- **Geocoding Accuracy Refinement**:
  - Achieved **98%+ accuracy** on a 400-item "ground truth" benchmark set (`scripts/results/geocode-benchmark-400.json`).
  - Refined NLP heuristics to eliminate persistent false positives (e.g., "Ray", "Arsenal").
  - Implemented a **remapping utility** (`scripts/util/remap-db-locations.ts`) to retroactively update database entries with improved engine logic.
- **Mobile UX Overhaul**:
  - Implemented **swipe-to-collapse** sidebar gesture for intuitive mobile navigation.
  - Optimized the **Filter Bar** with horizontal scrolling and a persistent, pinned search experience.
  - Integrated a **Custom Datetime Picker** that resolves timezone discrepancies and provides a robust date-filtering interface.
- **Performance & Build Audit**: Ran bundle audits to ensure `geonames.json` is safely tree-shaken from Next.js client bundles. Successfully migrated from Leaflet to MapLibre GL JS for GPU-accelerated rendering of 100K+ points.

### Phase 1: API & Data Fetching (Scale Enablers)

- **Bounding Box (BBox) Querying**: Modified `/api/news` to accept `minLat/maxLat/minLng/maxLng`. Implemented debounced (400ms) viewport updates in `NewsMap.tsx` to trigger refetches. Added client-side bbox-keyed caching in `useNewsData.ts` to prevent redundant DB hits when panning back to previously viewed areas.
- **Supabase Realtime**: Replaced 15-minute polling with a Supabase Realtime `INSERT` subscription. Implemented client-side viewport filtering so only events within the current bounding box are injected into the UI, reducing noise and re-render cycles.
- **Database Egress Optimization**: Optimized initial list fetch by excluding the `description` field (~40% payload reduction). Implemented an on-demand detail endpoint (`/api/news/[id]`) that lazy-loads descriptions when a user expands a sidebar card or clicks a map pin.
- **Live-Patching Map Popups**: Implemented a specialized popup update mechanism that patches live MapLibre popups with lazy-loaded descriptions when they arrive, ensuring immediate UI feedback without camera jumps.
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

- **Interaction Snappiness**: Optimized map viewport polling with a 150ms debounce. The UI feels instantaneous when moving the map.
- **Viewport-Aware State Eviction**: Implemented an automated eviction policy in `useNewsData.ts`. Individual pins are now merged into a persistent pool but automatically pruned when they fall outside the active snapped bounding box, preventing memory leaks while preserving "back-button" cache hits.
- **Dynamic BBox Grid Expansion**: Scaled the BBox snapping logic and increased the API `RAW_LIMIT` to 2000 events. This allows for massive, pre-cached data "tiles" that minimize database egress.
- **Advanced Cluster Visualization**:
  - **Non-Linear Scaling**: Clusters scale logarithmically (14px to 36px) to maintain clarity without overcrowding.
  - **Count-Based Sorting**: Implemented `symbol-sort-key` prioritylarger clusters are always drawn on top of smaller ones.
  - **Collision-Aware Labels**: Optimized collision detection and `text-padding` to hide redundant underlying labels, ensuring a clean "pro" look at all zoom levels.
  - **Smooth Opacity Gradients**: Dynamic `circle-opacity` (0.65 to 0.95) based on event volume, providing a glassy, premium aesthetic.
- **Synchronized Cluster Break-Apart**: Aligned client-side MapLibre clustering with the server-side `CLUSTER_ZOOM_THRESHOLD` (5) for a seamless transition from global groups to individual pins.
- **Environmental Overlays & Map Tools**:
  - **Action Menu**: Created a floating bottom-right action area with animated submenus.
  - **Live Data Feeds**: Integrated real-time USGS Earthquake feed (24h), NOAA Weather Radar (Live NEXRAD tiles), and NASA EONET (Disaster events from past 30 days).
  - **Deferred: Drawing Engine** (`temp_drawing/`): A custom native MapLibre GL drawing engine has been prototyped and moved to a temporary directory for future integration. It supports Polygon, Rectangle, Circle, Freehand, and Select modes with live GeoJSON preview rendering.
  - **Mobile Accessibility**: Refactored the MapActionTools toolbar with increased touch targets (44px) and a responsive layout for improved mobile usability.
  - **Stability Fixes**: Refactored Supabase client to a singleton to prevent Auth instances warnings.
  - **Timezone Integrity**: Fixed UI discrepancies between event timestamps and filter selection.

### Phase 3: Data Architecture & Aggregation (Analyst Experience)
- **Schema Evolution (The "Story" Model)**: Created a safe Supabase migration to upgrade the `events` table with `vector(384)` embeddings, `JSONB` source arrays, and `impact_score`. Includes indexing for fast similarity matching.
- **Zero-Cost Vectorization Pipeline**: Integrated semantic embedding generation directly into the Bun ingestion worker using `@huggingface/transformers` (Xenova/all-MiniLM-L6-v2). No external API keys or usage costs.
- **Data Renewal Tooling**: Developed a suite of maintenance scripts (`re-vectorize.ts`, `re-cluster.ts`, `re-tier.ts`) for database health.
- **Production Consolidation (Backfill)**: Successfully executed the full backfill suite on 38,539 historical records.
  - **Purged 12,849 redundant pins** by consolidating them into multi-source "Stories."
  - **Reclaimed ~100MB of storage** via `VACUUM FULL` optimization.
  - **Validated 93.9% Geocoding Accuracy** on ground-truth benchmarks.
  - **Final Unmapped Rate: 22.87%** (Healthy skepticism for non-geographic news).

---

## Phase 4: UI Transformation (The "Story" Experience)

_Goal: Update the frontend to reflect the shift from individual links to aggregated stories._

### 4.1 "Story" UI Components
- **Action**: Update the frontend to reflect the shift from individual links to aggregated stories.
- **Map Interaction**: Update MapLibre popups to display a list of all sources for a story rather than just one URL. Add "Source Count" badges to individual pins.
- **Sidebar Experience**: Update `EventSidebar` cards to show an array of source icons (e.g., BBC + Reuters + X) instead of a single source badge. Add "Follow the Story" expansion for timeline view.
- **Credibility Integration**: Highlight "Tier 1" verified stories with distinct visual borders or badges to distinguish them from raw social feeds.

### 4.2 Temporal Scrubber (Time Slider)
- **Action**: Add a horizontal range slider at the bottom of the map. Users drag a handle to scrub through the last 7 days hour-by-hour. The map animates pins appearing/disappearing based on `published_at`.
- **Implementation**: A React component with a `<input type="range">` controlling a `maxTimestamp` state. The map layer filters its GeoJSON source by timestamp on each slider change. Include a "Play" button for auto-advance.

### 4.3 View State Syncing (URL Deep Links)
- **Action**: Encode the current map center, zoom level, active filters, and search query into URL search parameters.
- **Implementation**: Use `useSearchParams` or a custom hook that syncs state bidirectionally with `window.history.replaceState`.

---

## Phase 5: Distribution, Monetization & Platform

_Goal: Turn Seraphim from a project into a product with user accounts and usage tiers._

### 5.1 User Auth & Usage Tiers (Supabase Auth)

- **Action**: Integrate Supabase Auth and execute a migration for user-specific data.
- **New Tables**:
  - `user_profiles`: Stores `tier` ('free', 'pro'), `stripe_customer_id`, and preferences.
  - `user_bookmarks`: Stores `user_id`, `event_id`, and personal notes.
  - `user_geofences`: Stores `user_id`, `polygon`, and `alerts_enabled`.
- **Enforcement (API Tiering)**:
  - **Free Tier**: Limited to 7 days of history (enforced via `p_since` in API). Standard rate limits.
  - **Pro Tier**: Unlimited historical archive. High-frequency rate limits. Access to GeoJSON/KML exports.

### 5.2 Dynamic Open Graph (OG) Previews

- **Action**: Use `@vercel/og` to render map thumbnail cards when URLs are shared. Requires Phase 4.3.

### 5.3 Automated Geofence Alerts

- **Action**: Edge Function triggered by new inserts calls `ST_Within()` against `user_geofences`. Sends email/push notifications to Pro users.

### 5.4 AI-Powered Summarization & RAG

- **Action**: Use `pgvector` embeddings as the retrieval layer for a RAG pipeline. Users type natural language queries and receive LLM-generated summaries citing relevant events.

---

## Tech Stack Evolution

| Feature               | Past (Leaflet)                    | Present (MapLibre)                 | Notes                                        |
| --------------------- | --------------------------------- | ---------------------------------- | -------------------------------------------- |
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

## Engineering & Performance Backlog

### Server-Side Realtime Filtering

Create an alternative to the websocket-based Realtime subscription for fetching new news events as this could be brutal on supabase with high user counts.

Update the Realtime subscription to use server-side filters (e.g., by category or source) matching the user's active UI state, reducing unnecessary egress and client CPU usage.

### Geodata Runtime Optimization

Move the `KNOWN_LOCATIONS` dictionary build to `build-geodata.mjs`, pre-calculating the optimized structure so the runtime only needs to perform a single `JSON.parse` call.

### Engineering Anomalies to Investigate

- **Geodata Divergence**: Hardcoded aliases in `scripts/evaluate-accuracy.mjs` may diverge from the core geocoding engine logic, leading to inconsistent accuracy results.
- **Monolithic Geodata**: `COUNTRY_DATA` in `scripts/build-geodata.mjs` is a very large hardcoded object that should ideally be moved to an external JSON for better maintainability.
- **Stale Data Preservation**: `remap-db-locations.ts` prevents nulling out locations. Investigate if this causes the system to "stick" to old, incorrect geocoding results when the engine is refined.

### Phase 2.5: Advanced Visualization & Tiles (Deferred)

Fine-tune the new MapLibre engine for absolute visual perfection. Serve OSINT-specific vector tiles (OpenStreetMap-based) from Cloudflare R2 via Protomaps PMTiles to achieve crisp labels at all zoom levels and $0 egress.

### Phase 4.4: Strategic Handling of Unmapped Events

_Goal: Rethink the 22% of news that provides vital context but lacks coordinates._

- **Current State**: Unmapped events live in the sidebar but are invisible on the map.
- **Concept**: Implement a "Global Context" sidebar section or a "Regional Heatmap" for broad news (e.g., news mentioning "Ukraine" but no specific city should highlight the entire country polygon at low opacity).
- **Concept**: "The Tickertape" - A scrolling bottom bar for high-volume, unmapped headlines to keep the main sidebar focused on geographic data.
- **Concept**: Semantic Cross-Referencing - Use embeddings to link unmapped "Opinion" pieces to the mapped "Events" they are discussing.
