# Seraphim 2.0 — Architecture & Future Plan

## Overview

Seraphim is transitioning from a monolithic Node.js API route into an event-driven, decoupled architecture powered by Bun. This refactor prevents serverless timeout limits, radically accelerates background task execution, reduces client-side rendering lag, and creates a highly scalable, zero-cost foundation capable of handling thousands of OSINT events globally.

---

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

## Phase 1: The Database Bridge (Supabase)

1. **Provision Supabase:** Create a new project and enable the **Data API**.
2. **Enable PostGIS:** Turn on the `postgis` extension to handle geographic data.
3. **Create `events` Table:** Create a table with columns for `id`, `title`, `description`, `source`, `url` (unique constraint), `category`, `latitude`, `longitude`, and `published_at`.
4. **Secure with RLS:** - Public Policy: `SELECT` only (for the Next.js viewer).

- Service Role Policy: `INSERT`/`UPDATE` only (for the GitHub Action scraper).

## Phase 2: Decoupling the Scraper (Backend)

1. **Isolate Logic:** Move `rss.ts`, `gnews.ts`, and `geocode.ts` out of the Next.js API route and into a dedicated `scraper/` directory within the monorepo. Transition the package manager to Bun (`bun install`).
2. **Setup Background Worker (Bun):** Create a `.github/workflows/scrape.yml` file and implement the `setup-bun` action to provision the runtime instantly.
3. **Configure Cron & Execution:** Set the cron schedule to `*/30 * * * *` (runs every 30 minutes). Execute the scraper natively using `bun run src/scraper/index.ts` to skip the build step and stay well under the 2,000 min/mo free tier.
4. **Inject Secrets:** Store `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `GNEWS_API_KEY` in GitHub Repository Secrets.

## Phase 3: The Viewer & Map Upgrade (Frontend)

1. **Refactor Next.js:** Remove NLP and scraping dependencies from the client. The frontend should only fetch data via `supabase-js`.
2. **Replace Leaflet:** Install `maplibre-gl` and `react-map-gl`.
3. **Implement Protomaps:**

- Download the `planet.pmtiles` extract (or a regional subset for testing).
- Upload to a free Cloudflare R2 bucket.
- Configure MapLibre to read the PMTiles protocol via HTTP Range Requests.

4. **Deploy:** Push to Vercel and map the custom `seraphi.me` domain. Add `git diff --quiet HEAD^ HEAD ./src/` to Vercel's Ignored Build Step so scraper updates don't trigger unnecessary website rebuilds.

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
