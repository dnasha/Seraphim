# Seraphim 2.0 — Architecture & Future Plan

## Overview

Seraphim is a real-time OSINT news aggregator that geocodes headlines and plots them on an interactive world map. It pulls articles from RSS feeds and the GNews API, extracts geographic locations from the text using NLP + regex heuristics, and displays everything in a Leaflet/OpenStreetMap map with a filterable sidebar.

Seraphim is transitioning from a monolithic Node.js API route into an event-driven, decoupled architecture powered by Bun. This refactor prevents serverless timeout limits, radically accelerates background task execution, reduces client-side rendering lag, and creates a highly scalable, zero-cost foundation capable of handling thousands of OSINT events globally.

---

## TODO

1. The Core Problem: Deduplication & Story Clustering
   Instead of treating every RSS item as an "Event," you need to shift to a "Story" -> "Articles" data model.
   How to implement this in your Bun Scraper:
   Since you are using Supabase (PostgreSQL), you have access to pgvector. This is the modern, highly accurate way to deduplicate news.
   The Vector Approach: When your Bun worker scrapes a new article, generate a lightweight text embedding for the headline + description (you can use an API like OpenAI, or run a fast, free local model in Bun like all-MiniLM-L6-v2 via HuggingFace).
   The Match: Query Supabase for existing events within a specific timeframe (e.g., the last 48 hours) and within a specific geographic radius (using PostGIS). Calculate the cosine similarity of the embeddings.
   The Merge: If the similarity score is high (e.g., > 0.85), do not create a new map point. Instead, append the new source (URL, Source Name) to an array in the existing database row.
   The Meta-Data: Keep the oldest timestamp as the "Discovery Time", but update a "Last Updated" timestamp. Keep the longest description, or dynamically swap to a premium source's headline (e.g., prefer BBC over a random Telegram channel).
2. UI/UX: Visualizing "Clusters" instead of "Single Articles"
   If an event has 5 sources reporting on it, that is a strong signal of Importance. You should reflect this in the UI.
   Weighted Map Markers: Map pins should scale in size or glow intensity based on the number of sources. A single Telegram rumor gets a standard pin; a confirmed strike verified by Reuters, NYT, and 3 OSINT accounts gets a massive, glowing pin.
   Sidebar "Stacked" Cards: In the sidebar, instead of showing 5 separate cards for the same event, show one "Story Card."
   Design idea: Show the best headline, and at the bottom of the card, display small logos/favicons of all the sources that reported it (e.g., [BBC Icon] [Reddit Icon] [Telegram Icon] +2 more).
   Clicking the card expands it to show the individual links.
3. API & Database Shift: Bounding Box (BBox) Querying
   Currently, your useNewsData hook fetches everything and filters it via useMemo on the client. At 500 items/day (15,000/month), this will quickly crash the browser.
   Move to Map-Driven Fetching: Leaflet gives you the current boundaries of the map screen (map.getBounds()).
   PostGIS ST_Within: Update your Next.js /api/news route to accept minLat, maxLat, minLng, maxLng query parameters. Use PostGIS to only return events currently visible on the user's screen.
   As the user pans the map, trigger a debounced fetch for the new area. This keeps the DOM and memory footprint incredibly light, regardless of database size.
4. Time-Series Visualization (The "Playback" Feature)
   OSINT is entirely about timelines. When a conflict escalates, seeing how it moves across the map is invaluable.
   Timeline Slider: Add a horizontal slider UI element at the bottom of the screen (above the map).
   Instead of just filtering by "1 Day" or "3 Days", allow the user to drag a scrubber to see events pop up sequentially over the last 24 hours. This turns your app from a static map into a dynamic intelligence dashboard.
5. Heatmaps for Macro-Trends
   If a user selects "1 Month" or "All Time," plotting 5,000 individual pins—even clustered ones—is visually chaotic.
   Dynamic Layer Switching: If the returned item count exceeds a certain threshold (e.g., > 1,000), automatically hide the distinct SVG pins and swap to a WebGL Heatmap layer (e.g., leaflet.heat).
   This instantly shows geopolitical hotspots (e.g., red glowing areas over the Middle East, Ukraine, etc.) without cluttering the UI with individual text popups.
6. Automated "Source Credibility" Tagging
   Because you are pulling from high-tier news (Reuters) down to raw social media (Telegram), credibility varies wildly.
   Add a credibility_tier to your sources.ts data.
   Tier 1: AP, Reuters, BBC (Primary News)
   Tier 2: OSINT Technical, Liveuamap (Curated OSINT)
   Tier 3: Raw Telegram feeds
   If a Tier 3 source reports something, the UI can mark it as "Unverified." Once a Tier 1 source falls into the same Vector Cluster, the status automatically upgrades to "Confirmed."
   Summary of Next Steps for you:
   Immediate: Update your Supabase schema to support an array of sources (URLs and names) per event, rather than a single source.
   Short-term: Implement a clustering heuristic in your Bun scraper (start with PostGIS distance + exact keyword matching, then upgrade to pgvector later).
   Medium-term: Refactor the UI sidebar to group sources under one headline.
   Long-term: Implement Bounding Box map-fetching to save client memory.

## The Upgraded Tech Stack

| Component              | Current (v1)           | Future (v2)               | Purpose / Benefit                                                                                               |
| ---------------------- | ---------------------- | ------------------------- | --------------------------------------------------------------------------------------------------------------- |
| **Domain**             | `localhost`            | `seraphi.me` (Namecheap)  | Public-facing, memorable URL for the project.                                                                   |
| **Runtime & Packages** | Node.js & npm          | Bun (`bun.lock`)          | 30x faster installations; native TypeScript execution for the background scraper (bypassing the TS build step). |
| **Frontend/Hosting**   | Next.js API Monolith   | Next.js 16 + Vercel       | Ultra-lightweight Viewer. Built by Vercel's Edge network but utilizes Bun for fast dependency resolution.       |
| **Database & API**     | None (In-memory/Files) | Supabase (PostgreSQL)     | Central storage. Generates a secure REST API automatically.                                                     |
| **Geospatial Engine**  | Basic lat/lng          | PostGIS (Supabase)        | Native coordinate understanding and GiST indexing for fast map queries.                                         |
| **Scraper Worker**     | API Route (On-demand)  | GitHub Actions (Cron)     | Runs strictly every 30 mins in the background using Bun. Handles all RSS, NLP, and Geocoding.                   |
| **Map Engine**         | Leaflet (DOM-based)    | MapLibre GL JS            | WebGL/GPU-accelerated rendering. Handles 10,000+ pins and clustering without lag.                               |
| **Map Tiles**          | OpenStreetMap (Raster) | Protomaps + Cloudflare R2 | Vector tiles stored as a single `.pmtiles` file. Zero egress costs via Cloudflare.                              |

---

## Phase 1: The Database Bridge (Supabase) [DONE]

1. **Provision Supabase:** Create a new project and enable the **Data API**.
2. **Enable PostGIS:** Turn on the `postgis` extension to handle geographic data.
3. **Create `events` Table:** Create a table with columns for `id`, `title`, `description`, `source`, `url` (unique constraint), `category`, `latitude`, `longitude`, and `published_at`.
4. **Secure with RLS:** Public `SELECT` and Service Role `INSERT`/`UPDATE` policies.

## Phase 2: Decoupling the Scraper (Backend) [DONE]

1. **Isolate Logic:** Move fetchers and geocoding into a dedicated `src/scraper/` directory.
2. **Setup Background Worker (Bun):** Transitioned to Bun for 30x faster cold starts and native TS support.
3. **Configure Cron & Execution:** Implemented `.github/workflows/scrape.yml` running every 30 minutes.
4. **Inject Secrets:** Configured `SUPABASE_SERVICE_ROLE_KEY` and `GNEWS_API_KEY` for secure ingestion.

## Phase 3: The Viewer & Map Upgrade [CURRENT FOCUS]

1. **Refactor Next.js:** (DONE) The frontend now only fetches data via the Supabase client (Edge-ready).
2. **Stability & Error Handling:** (Ongoing/Refined) Implemented robust date normalization for non-standard RSS formats and added UTF-8 surrogate pair cleaning to prevent database write failures.
3. **Replace Leaflet with MapLibre GL JS:** (Pending) Necessary to handle larger datasets and provide better pan/zoom performance.
4. **Implement Vector Tiles (Protomaps):** (Pending) Migrate from raster tiles to PMTiles for better visual fidelity and $0 egress costs.

---

## Technical Debt & Stability [RECENT IMPROVEMENTS]

- **Coordinate Robustness**: Standardized `!= null` checks across `NewsMap`, `EventSidebar`, and `useNewsFilter` to prevent Leaflet crashes on incomplete geodata.
- **Type Safety**: Updated `DbEvent` and `dbEventToNewsItem` to explicitly handle SQL `NULL` values, ensuring the frontend never receives corrupted lat/lng objects.
- **Worker Isolation**: The Bun scraper is now fully independent of the Next.js runtime, allowing for easier scaling of ingestion sources.
- **Date & Payload Sanitization**: Implemented `ensureIsoDate` to handle erratic RSS date formats and a surrogate-pair cleaner to protect Postgres UTF-8 integrity.

---

## Phase 4: Advanced OSINT Features & AI

Once the core v2 architecture is stable, the stack is primed for professional-grade mapping tools utilizing $0 server-compute strategies:

- **The AI Map Assistant (RAG Pipeline):** Enable Supabase `pgvector` to store text embeddings of scraped news. Use a generous free-tier API (Groq or Gemini) to perform similarity searches, allowing users to ask natural language questions about the map (e.g., "Summarize recent events in South America").
- **Client-Side OSINT Tools:** Integrate Terra Draw (`maplibre-gl-terradraw`) and Turf.js, allowing users to draw bounding polygons and measure distances directly in the browser using client-side JavaScript math.
- **Crowdsourced User Submissions:** Allow authenticated users (Supabase Auth) to drop custom pins. Route text through the free Google Perspective API to automatically score and reject toxic/spam submissions.
- **Social Share & Deep Linking:** Utilize Next.js Dynamic Routing (`?pin=123`) paired with Vercel's `@vercel/og` Edge Image Generation to automatically generate highly clickable map-preview image cards when links are shared on X or Discord.
- **The "Wayback" Time Slider:** A frontend React slider linked to Supabase temporal filtering (`WHERE created_at > X`), enabling users to scrub through historical event timelines.
- **Categorical Heatmaps:** Use MapLibre's native WebGL heatmap layers to render clustered event categories (Conflict, Natural Disaster) using the user's GPU instead of individual pins.
- **Live Environmental Overlays:** Inject live, free third-party GeoJSON feeds (e.g., USGS earthquakes, NOAA weather) dynamically into MapLibre to contextualize scraped events.
- **One-Click Data Export:** Use lightweight browser libraries (`tokml`) to allow analysts to export filtered map views into standard GeoJSON/KML files for desktop software (QGIS/Google Earth).
- **Automated Geofence Alerts:** Use Supabase Webhooks and PostGIS (`ST_Within`) to trigger an Edge Function whenever a new pin drops inside a user's saved polygon, notifying them via the Resend API (3,000 free emails/mo).

---

## Phase 5: Distribution & Monetization (The Open-Core Model)

Seraphim will bridge the gap between expensive enterprise tools (Dataminr) and crowdsourced platforms (Citizen) using an open-source growth strategy:

- **The Open Source Play:** The repository will be made public (using an MIT or AGPLv3 license). This builds immense trust and brand awareness within the OSINT and cybersecurity communities, as anyone can audit the scraping heuristics or self-host their own instance for free.
- **The SaaS Hosting Play:** Revenue will be generated by offering the hosted, zero-friction version (`seraphi.me`). Users will pay a subscription (via Stripe webhooks linked to Supabase RLS) for "Pro" features like Geofence Email Alerts, massive API exports, and live websocket streaming, bypassing the massive headache of setting up their own database and scraper infrastructure.
