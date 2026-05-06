# Seraphim Project Roadmap

> A living document. Tracks what's been built, what needs hardening, and what's next in order.

---

### What Is Already Done

### Core Infrastructure & Data Pipeline

- **Modern Backend**: Supabase (PostgreSQL + PostGIS) with a decoupled **Bun scraper worker** running every 30 minutes. Batched upserts with `url` deduplication and advanced sanitization.
- **Geocoding Engine**: 98.2% accurate tiered lookup engine (Landmarks > Cities > Countries) using a 78K-entry GeoNames dictionary and `compromise` NLP. Includes jitter to prevent pin stacking.
- **Semantic "Story" Model**: Local vectorization via `@huggingface/transformers` (all-MiniLM-L6-v2) for zero-cost clustering. Consolidation pipeline merged 38k events into 25k multi-source "Stories," purging ~13k redundant pins.
- **Broad Source Coverage**: Real-time ingestion from **30+ RSS feeds**, **8 Telegram channels** (Cheerio scraping), **4 subreddits**, and **X/Twitter** (Syndication/Nitter).

### Frontend & Dashboard

- **High-Performance Map**: MapLibre GL JS (WebGL) with custom vector styles. Implements **BBox snapping** and client-side caching to minimize DB egress.
- **Smart Clustering**: Hybrid strategy using PostGIS `ST_ClusterDBSCAN` for global views (Zoom < 5) and native MapLibre clustering for local views.
- **Responsive Sidebar**: Virtualized list (`react-virtuoso`) for 60fps scrolling. Features live search, category/source filtering, and touch-optimized mobile gestures.
- **Intelligence Tools**:
  - **Live Overlays**: USGS Earthquakes (24h), NOAA Weather Radar, and NASA EONET Disasters.
  - **Lazy Loading**: Descriptions and full article metadata are fetched on-demand to reduce initial payload by 40%.
  - **Fail-Safe Architecture**: Singleton Supabase clients, hybrid L1/L2 rate limiting, and 96% test coverage across 127 suites.

---

## Phase 4: UI Transformation (The "Story" Experience) (Completed)

_Goal: Update the frontend to reflect the shift from individual links to aggregated stories._

### 4.1 "Story" UI Components (Completed)

- **Implementation**: Icon-only round badges with Diamond/Gold/Silver tiers. Source-count pills with hover tooltips. Story timeline expansion in sidebar.
- **Credibility**: Diamond Blue (#0369a1) verified tier integration.

### 4.2 View State Syncing (URL Deep Links) (Completed)

- **Implementation**: Robust `useViewState` hook syncing `lat`, `lng`, `zoom`, `q`, `t`, and `sortMode` to URL.
- **Architecture**: Decoupled `HomeContent.tsx` (Client) from `page.tsx` (Server) for SSR-safe hydration.

### Phase 4.3: Smart Sorting & Ranking (Completed)

- **Hot Sort**: Prioritizes stories corroborated by multiple outlets (Source Count DESC), with recency as a tiebreaker.
- **New Sort**: Classic recency-based feed.
- **Toggle UI**: Segmented control in sidebar below filter chips.

---

## Phase 4.5: Candy Features

_Goal: Implement "nice-to-have" features that enhance the visual experience and viral potential._

### 4.5.1 Temporal Scrubber (Time Slider)

- **Action**: Add a horizontal range slider at the bottom of the map. Users drag a handle to scrub through the last 7 days hour-by-hour. The map animates pins appearing/disappearing based on `published_at`.
- **Implementation**: A React component with a `<input type="range">` controlling a `maxTimestamp` state. The map layer filters its GeoJSON source by timestamp on each slider change. Include a "Play" button for auto-advance.

### 4.5.2 Dynamic Open Graph (OG) Previews

- **Action**: Use `@vercel/og` to render map thumbnail cards when URLs are shared. Requires Phase 4.2.

### 4.5.3 AI-Powered Summarization & RAG

- **Action**: Use `pgvector` embeddings as the retrieval layer for a RAG pipeline. Users type natural language queries and receive LLM-generated summaries citing relevant events.

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

### 5.2 Automated Geofence Alerts

- **Action**: Edge Function triggered by new inserts calls `ST_Within()` against `user_geofences`. Sends email/push notifications to Pro users.

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
