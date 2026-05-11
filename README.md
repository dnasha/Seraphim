# Seraphim - Real-Time OSINT Dashboard

Seraphim is a real-time OSINT (Open-Source Intelligence) news aggregator that scrapes global headlines, extracts geographic locations via NLP + regex heuristics, and plots them on an interactive world map. It combines RSS feeds, social media (Telegram, X/Twitter), Reddit, and the GNews API into a single filterable intelligence dashboard.

---

##  Architecture & Tech Stack

| Layer | Technology | Notes |
| :--- | :--- | :--- |
| **Framework** | Next.js 16.2.4 (App Router) | React 19.2.5, deployed to Vercel |
| **Language** | TypeScript | Strict mode, version 6.0.3 |
| **Styling** | Vanilla CSS | CSS Modules for component isolation. Base tokens in `globals.css` |
| **Testing** | Vitest | Unit/Integration/Accuracy testing (~130 tests) |
| **Database** | Supabase (PostgreSQL + PostGIS) | `events` (Story model) with `pgvector` enabled |
| **Map Engine** | MapLibre GL JS 5.1 | WebGL-accelerated rendering |
| **Primary Runtime** | Bun | Native TS execution, used for development and ingestion |

---

##  Key Commands

| Command | Description |
|---|---|
| `bun dev` | Starts the Next.js development server. |
| `bun build` | Builds the application for production. |
| `bun run scrape` | Runs the ingestion worker (`src/scraper/index.ts`). |
| `bun test` | Executes the Vitest suite. |
| `bun run test:accuracy` | Runs geocoding regression tests. |
| `bun run scripts/build-geodata.mjs` | Compiles GeoNames data into `data/geonames.json`. |

---

##  Project Structure

- `src/app/`: Next.js App Router pages and API routes.
- `src/components/`: React components, including the `map/` engine.
- `src/scraper/`: Bun-based ingestion worker and transformers.
- `src/lib/geocoding/`: Core NLP extraction and location resolution logic.
- `data/`: Geodata (raw `.txt` and compiled `geonames.json`).
- `scripts/`: Accuracy evaluators, geodata builders, and maintenance tools.

---

##  Data Pipeline

1. **Scraper**: Fetches from RSS, Reddit, Telegram, and GNews.
2. **Vectorization**: Generates 384-dim embeddings locally via `@huggingface/transformers`.
3. **Consolidation**: Incoming events are matched against existing stories using tiered semantic similarity (0.85 global, 0.75 anchored, 0.60 spatial).
4. **Upsert**: New sources are appended to story clusters, updating titles/descriptions based on credibility tiers.

---

##  Environment Variables

Required for full functionality:
- `SUPABASE_URL`: DB endpoint.
- `SUPABASE_SERVICE_ROLE_KEY`: For scraper write access.
- `GNEWS_API_KEY`: (Optional) For keyword-driven news search.

---

##  Geocoding Strategy

The engine uses a tiered approach:
1. **Explicit Overrides**: `src/lib/geocoding/constants.ts` (e.g., resolving "Georgia" correctly).
2. **Dictionary Priority**: Landmarks > Mega-Cities > Countries > Cities > Admin1.
3. **Scoring**: Candidates are scored based on placement (Title vs. Description) and source signals.

---

##  License

(c) Seraphim 2026. See `LICENSE` for details.
