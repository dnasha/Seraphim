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
- **Clustering**: `leaflet.markercluster` with chunked loading, off by default.
- **Map styles**: Standard (Voyager), Dark — auto-switching with theme. Settings panel with gear icon toggle.
- **Sidebar**: Fixed 400px width, collapsible. Logo (Cinzel Decorative font), stat pills (article count, mapped count, last-updated timestamp), filter bar, scrollable card list. Cards show 88×66px thumbnails, source badge, time-ago, location pin. Unmapped articles expand inline; mapped articles fly the map to the pin.
- **Filtering**: Source toggles (News/Reddit/X/Telegram/GNews), category pills, time range (1D/3D/1W/1M/All), "Mapped Only" toggle, debounced search. Client-side `useMemo` filtering for instant toggling.
- **Theme**: Light mode default (prevents FOUC). Persistent via `localStorage`. Dark mode overrides via `[data-theme="dark"]` CSS custom properties.
- **Mobile responsive**: Sidebar becomes a slide-in overlay at ≤860px. Map fills full viewport.
- **Performance**: `preferCanvas: true`, `will-change` hints, `backface-visibility: hidden` isolation, aggressive memoization of the card list.
- **Security**: URL protocol validation in scraper, RLS policies on Supabase, `SUPABASE_SERVICE_ROLE_KEY` never exposed to client (only anon key used in route.ts).
- **Analytics**: `@vercel/analytics` and `@vercel/speed-insights` integrated.

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
---



---

## 🚀 Phase 1: API & Data Fetching (Scale Enablers)

_Goal: Make the browser download only what it needs. Required before the dataset exceeds ~1,000 events._

### 1.1 — Bounding Box (BBox) Querying + Debounce

- **Backend**: Modify `/api/news` to accept `minLat`, `maxLat`, `minLng`, `maxLng` query parameters. Write a Supabase RPC function using PostGIS `ST_MakeEnvelope` + `ST_Within` (or a simple `WHERE latitude BETWEEN ? AND ? AND longitude BETWEEN ? AND ?` if PostGIS spatial indexing isn't needed yet).
- **Frontend**: Hook into the map's `moveend` event. Capture `map.getBounds()` and pass the corners to the API. Add a **300–500ms debounce** so rapid panning doesn't spam the database.
- **Fallback**: On initial load (before the map has settled), fetch without BBox to populate the sidebar's total count.

### 1.2 — Server-Side Spatial Clustering (PostGIS)

- **Action**: Use `ST_ClusterDBSCAN` in a Supabase RPC function to cluster nearby events on the server when the client zoom level is below a threshold (e.g., `zoom < 10`).
- **Response shape**: Return `{ cluster_id, event_count, center_lat, center_lng }` for clusters and full event objects for individual points.
- **Benefit**: Instead of sending 200 pins for Kyiv, send 1 cluster object. Drastically reduces JSON payload and DOM element count.

### 1.3 — Supabase Realtime (Selective Subscriptions)

- **Action**: Replace the 15-minute polling interval in `useNewsData.ts` with a Supabase Realtime subscription on the `events` table (`INSERT` events only).
- **Key detail**: Only trigger a re-fetch or UI update if the new row's coordinates fall within the user's current BBox. Otherwise, just increment a "new events available" badge without re-rendering the entire card list.
- **Graceful fallback**: Keep the 15-minute poll as a heartbeat in case the WebSocket connection drops.

---

## 🖥️ Phase 2: UI Rendering & Performance (Browser Savers)

_Goal: Handle 5,000+ events without the tab freezing._

### 2.1 — Swap Rendering Engine: Leaflet → MapLibre GL JS

- **Why**: Leaflet creates a DOM element per marker (`DivIcon`). At 2,000+ markers, the browser's layout engine collapses. MapLibre renders everything via WebGL on the GPU — it can handle 100,000+ points as a `GeoJSON` source without creating any DOM elements.
- **Migration scope**:
  - Remove `leaflet`, `react-leaflet`, `leaflet.markercluster` dependencies.
  - Rewrite `NewsMap.tsx` to use `maplibre-gl` directly (or `react-map-gl` with MapLibre adapter).
  - The custom smooth zoom system (sub-pixel patching, `_move()` calls) becomes unnecessary — MapLibre's zoom is already fluid and GPU-accelerated.
  - Popup and marker styling moves from CSS/DOM to MapLibre's `Popup` class and symbol/circle layers.
  - Map style tiles: switch to **Protomaps PMTiles** served from Cloudflare R2 for $0 egress. Or use MapTiler/Stadia free tiers initially.
- **Risk**: This is the single largest refactor. Plan for a feature branch with 2–3 focused sessions.

### 2.2 — Virtualize the Sidebar

- **Why**: `EventSidebar.tsx` currently renders **every** card via `.map()` (line 142). With 500 items this is already borderline; with 5,000 it will freeze the tab for seconds.
- **Action**: Install `react-virtuoso` (or `@tanstack/react-virtual`). Replace the `.event-list` div with a virtualized container that only renders the ~10–15 cards visible in the scroll viewport.
- **Detail**: The auto-scroll-to-selected-card behavior (line 86–91) needs to use the virtualizer's `scrollToIndex` API instead of `el.scrollIntoView`.

### 2.3 — Dynamic Layering (Zoom-Dependent Visualization)

- **Action**: After the MapLibre migration, implement zoom-dependent rendering layers:
  - **Zoom 1–4 (Global)**: Heatmap layer or H3 hexbin aggregation. Show glowing hotspot regions.
  - **Zoom 5–9 (Regional)**: Numbered cluster circles with count badges.
  - **Zoom 10+ (Tactical)**: Individual categorized pins with the current icon design.
- **Implementation**: MapLibre supports all three natively via `heatmap`, `circle`, and `symbol` layer types with `minzoom`/`maxzoom` properties. No external plugins needed.

---

## 📊 Phase 3: Data Architecture & Aggregation (Analyst Experience)

_Goal: Shift from raw scrapes to coherent "stories." This is what separates a toy from a tool._

### 3.1 — Vector-Based Story Clustering (`pgvector`)

- **Action**: Enable the `pgvector` extension in Supabase. Add an `embedding` column (`vector(384)`) to the `events` table.
- **In the Bun scraper**: Generate embeddings for `title + description` using a lightweight model (e.g., `all-MiniLM-L6-v2` via HuggingFace Inference API, or locally via `@xenova/transformers`).
- **Merge logic**: When inserting a new event, query for existing events within 48 hours and a 50km radius (PostGIS) with cosine similarity > 0.85. If a match is found, append the new source to an `array` column on the existing row instead of creating a new event.
- **Schema change**: Add `sources JSONB` column (array of `{ name, url, source_type, discovered_at }`) to replace the single `source`/`url` fields per event.
- **UI impact**: One pin per story instead of 5 overlapping pins. Sidebar "Story Cards" show a primary headline with nested source favicons.

### 3.2 — Automated Importance Scoring

- **Action**: Add an `impact_score INTEGER` column to the `events` table. Compute on upsert in the scraper.
- **Formula**: `base_source_tier_score + (unique_source_count × 10) + keyword_bonuses`. Keywords: "confirmed" (+15), "casualty" (+20), "breaking" (+10), "satellite imagery" (+15). Source tiers: Reuters/AP = 30, BBC/NYT = 25, OSINT accounts = 15, raw Telegram = 5.
- **UI impact**: Pin size scales with `impact_score`. Sidebar default sort becomes "Highest Impact" with a toggle for "Most Recent." High-impact events get a subtle glow or badge.

### 3.3 — Named Entity Extraction (NER Tagging)

- **Action**: Run a lightweight NER model in the Bun worker (e.g., `compromise` already handles some NER, or use a dedicated model via API). Extract structured tags: `[Weapons: HIMARS, S-300]`, `[Organizations: IDF, Hezbollah]`, `[Key Figures: Zelensky]`.
- **Storage**: Populate the existing `tags JSONB` column (already in the schema but currently unused by the frontend).
- **UI impact**: Render tags as clickable pill badges on sidebar cards. Clicking a tag filters the map to all events sharing that tag.

---

## 🎯 Phase 4: Advanced OSINT Controls (The "Wow" Factor)

_Goal: Give analysts the tools to slice data logically. These are the features that make people share the link._

### 4.1 — Temporal Scrubber (Time Slider)

- **Action**: Add a horizontal range slider at the bottom of the map. Users drag a handle to scrub through the last 7 days hour-by-hour. The map animates pins appearing/disappearing based on `published_at`.
- **Implementation**: A React component with a `<input type="range">` controlling a `maxTimestamp` state. The map layer filters its GeoJSON source by timestamp on each slider change. Include a "Play" button for auto-advance.
- **Why it matters**: OSINT analysts need to see _flow_ — how a conflict escalates across geography over time. A static snapshot is far less useful.

### 4.2 — Source Credibility Tier Filtering

- **Action**: Add a `credibility_tier` field to `src/data/sources.ts` for every source:
  - **Tier 1 (Verified)**: Reuters, AP, BBC, NYT — wire services and established editors.
  - **Tier 2 (Curated OSINT)**: Liveuamap, ISW, OSINTtechnical — respected analyst accounts.
  - **Tier 3 (Raw Social)**: Raw Telegram channels, unverified X accounts.
- **Dynamic upgrade**: If a Tier 3 source reports something and a Tier 1 source later falls into the same story cluster (Phase 3.1), the event's displayed credibility automatically upgrades to "Confirmed."
- **UI**: A 3-toggle filter row in the FilterBar. Default: all tiers on. Analysts can quickly toggle off Tier 3 to see only confirmed reporting.

### 4.3 — View State Syncing (URL Deep Links)

- **Action**: Encode the current map center, zoom level, active filters, selected time range, and search query into URL search parameters: `?lat=50.45&lng=30.52&z=8&time=24h&cat=crisis&src=news,telegram`.
- **Implementation**: Use `useSearchParams` or a custom hook that syncs state bidirectionally with `window.history.replaceState` (no page reloads).
- **Benefit**: Users can share a link to a specific "view" of a crisis. Bookmarkable dashboards. Sets the foundation for OG previews (Phase 5.1).

### 4.4 — Client-Side OSINT Drawing Tools

- **Action**: Integrate `@maplibre/maplibre-gl-draw` or `terra-draw` to allow users to draw bounding polygons, measure distances, and annotate the map.
- **Use case**: An analyst draws a rectangle around eastern Ukraine and gets an instant count/list of events within that area. Measurement tools show distances between two points.

---

## 🌐 Phase 5: Distribution, Monetization & Platform

_Goal: Turn Seraphim from a project into a product._

### 5.1 — Dynamic Open Graph (OG) Previews

- **Action**: Use `@vercel/og` (Edge Image Generation) to render a map thumbnail card when a Seraphim URL is shared on X/Discord/Slack. The card shows a mini-map centered on the current view with event count badges.
- **Dependency**: Requires URL state syncing (Phase 4.3) so the OG endpoint knows what to render.

### 5.2 — User Auth & Accounts (Supabase Auth)

- **Action**: Integrate Supabase Auth (email/password + OAuth). User accounts enable:
  - Saved views / bookmarked events.
  - Custom geofence polygons with email alerts (new event inside your saved polygon → notification).
  - User-submitted pins (with Perspective API moderation).
- **RLS update**: Add user-scoped RLS policies for saved data.

### 5.3 — Automated Geofence Alerts

- **Action**: Let authenticated users save a bounding polygon. Use a Supabase Webhook + Edge Function that fires on new `events` inserts. If `ST_Within(new_event, saved_polygon)` is true, send a notification via the Resend API (3,000 free emails/month) or a browser push notification.

### 5.4 — Data Export (GeoJSON / KML)

- **Action**: Add a "Download" button that exports the currently filtered/visible events as GeoJSON or KML using lightweight browser libraries (`@tmcw/togeojson`, `tokml`). Analysts can import into QGIS, Google Earth, or ArcGIS.

### 5.5 — Premium Tier & Stripe Integration

- **Action**: Implement an open-core model. Free tier gets the full public map. Pro tier ($X/month via Stripe Checkout + Supabase RLS gating) unlocks:
  - Extended historical archive (years instead of 30 days).
  - Geofence email alerts (Phase 5.3).
  - Bulk data export.
  - Priority API access / higher rate limits.
  - Live WebSocket streaming instead of polling.

### 5.6 — AI-Powered Summarization & RAG

- **Action**: Use `pgvector` embeddings (Phase 3.1) as the retrieval layer for a RAG pipeline. Users type natural language queries ("What happened in the Red Sea this week?") and receive an LLM-generated summary citing the relevant events.
- **Implementation**: Supabase Edge Function calls an LLM API (Gemini, Groq, or OpenAI) with retrieved context. Response is streamed to the client.
- **Secondary use**: Auto-generate a daily "Intelligence Brief" email for Pro users — a 3-paragraph summary of the highest-impact events from the last 24 hours.

### 5.7 — Live Environmental Overlays

- **Action**: Inject free third-party GeoJSON feeds as toggleable map layers:
  - USGS earthquake feed (real-time GeoJSON).
  - NOAA severe weather alerts.
  - FIRMS fire/hotspot data.
- **Benefit**: Contextualizes scraped news events with authoritative sensor data.

### 5.8 — Open Source Release

- **Action**: Clean up the repo, write a proper README with screenshots, add a `CONTRIBUTING.md`, and release under AGPLv3 (protects the hosted SaaS model while allowing self-hosting). This builds trust and brand awareness in the OSINT and infosec communities.

---

## Tech Stack Evolution

| Component             | Current (v1)                      | Target (v2)                         | Why                                          |
| --------------------- | --------------------------------- | ----------------------------------- | -------------------------------------------- |
| **Map Engine**        | Leaflet 1.9 (DOM-based)           | MapLibre GL JS (WebGL)              | GPU rendering: 100K+ points vs. ~2K ceiling  |
| **Map Tiles**         | OpenStreetMap raster (Voyager)    | Protomaps PMTiles on Cloudflare R2  | Vector tiles, $0 egress, custom styling      |
| **Sidebar Rendering** | Raw `.map()` over all items       | `react-virtuoso` virtualized list   | Only renders ~15 visible cards vs. all 5,000 |
| **Data Fetching**     | Fetch all 500, filter client-side | BBox + server-cluster queries       | 10× smaller payloads, no wasted bandwidth    |
| **Realtime Updates**  | 15-minute polling                 | Supabase Realtime WebSocket         | Sub-second new event delivery                |
| **Deduplication**     | URL unique constraint only        | `pgvector` semantic clustering      | "Stories" instead of 5 redundant pins        |
| **Hosting**           | `localhost` / Vercel dev          | `seraphi.me` on Vercel + Cloudflare | Public-facing, CDN-cached, zero-downtime     |
| **Auth**              | None                              | Supabase Auth + Stripe              | User accounts, saved views, Pro tier         |
