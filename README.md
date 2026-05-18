# Seraphim

Seraphim is a real time Open Source Intelligence news aggregator designed to provide a comprehensive and interactive dashboard for global events. The platform scrapes headlines from diverse sources, including RSS feeds, social media platforms like Telegram and Reddit, and specialized news APIs. By employing advanced natural language processing and custom heuristic engines, Seraphim extracts geographic locations from news content and visualizes them on a high performance map.

## Architecture and Tech Stack

The project is built on a modern and resilient stack designed for performance and scalability.

### Frontend
The user interface is powered by Next.js 16 (App Router) and React 19. It uses MapLibre GL JS for WebGL accelerated map rendering. Styling is handled via Vanilla CSS and CSS Modules to ensure component isolation and maintainable styles. The frontend implements a persistent entity store that preserves data during map navigation and synchronizes the view state with the URL for shareable links.

### Backend and API
The backend is integrated within the Next.js App Router, providing server side rendering and API routes. It uses Supabase for database management, utilizing PostgreSQL with PostGIS for spatial queries and pgvector for semantic search capabilities. A hybrid rate limiting strategy using Upstash (Local L1 and Redis L2) ensures API stability.

### Data Ingestion
A dedicated ingestion worker built with Bun executes the scraping and processing pipeline. It handles data from RSS feeds, Cheerio based web scraping for Telegram, and integration with the GNews API.

### Geocoding and NLP
Seraphim features a custom geocoding engine that operates independently of external paid services. It uses the compromise NLP library alongside a multi pass heuristic system to resolve locations from unstructured text. Local vectorization is performed using the Hugging Face Transformers library (all-MiniLM-L6-v2) to generate embeddings for semantic clustering.

## Project Structure

The codebase is organized into logical directories to separate concerns across the stack.

* src/app: Contains the Next.js pages, layouts, and API routes.
* src/components: Reusable UI components, including the core map engine and its associated tools.
* src/scraper: The ingestion worker logic, transformers, and source specific scrapers.
* src/lib/geocoding: The core logic for location extraction and geographic resolution.
* src/hooks: Custom React hooks for managing authentication, news data, and map state.
* data: Static geographic datasets and compiled GeoNames information.
* scripts: Maintenance utilities, diagnostic tools, and accuracy evaluators.

## Installation and Setup

To set up the project locally, follow these steps.

### Prerequisites
* Bun (Primary runtime and package manager)
* Node.js (For secondary tooling if required)
* A Supabase project with PostGIS and pgvector enabled
* Upstash Redis (Optional for L2 rate limiting)

### Environment Variables
Create a .env file in the root directory and provide the following variables.
* SUPABASE_URL: Your Supabase project URL.
* SUPABASE_SERVICE_ROLE_KEY: Service role key for administrative database access.
* GNEWS_API_KEY: Optional API key for GNews integration.
* UPSTASH_REDIS_REST_URL: Optional URL for Upstash Redis.
* UPSTASH_REDIS_REST_TOKEN: Optional token for Upstash Redis.

### Data Initialization
Before running the project, you must compile the geographic data.
1. Download the required GeoNames datasets into the data directory.
2. Run the build script: bun run scripts/build-geodata.mjs.

## Operational Guide

### Development
Start the development server with:
bun dev

### Data Ingestion
Run the scraper to fetch and process new events:
bun run scrape

### Testing
Seraphim uses Vitest for unit and integration testing.
* Run all tests: bun test
* Run geocoding accuracy benchmark: bun run test:accuracy

## Technical Deep Dive

### Geocoding Strategy
The geocoding engine uses a tiered multi pass approach to ensure high accuracy with minimal false positives. It prioritizes locations based on:
1. Explicit metadata (e.g., datelines or source specific tags).
2. Patterns like "City, Country" or landmark names.
3. Weighted dictionary lookups against GeoNames data.
4. NLP based entity extraction for contextual resolution.

### Data Pipeline and Semantic Clustering
Incoming news items undergo a rigorous consolidation process.
1. Extraction: Locations and metadata are extracted from the raw content.
2. Vectorization: Content is converted into 384-dim embeddings locally.
3. Merging: New items are compared against existing stories using a tiered similarity model (Global Semantic, Anchored Location, and Spatial Proximity).
4. Clustering: Related sources are grouped under a single "Master" story to reduce map clutter.

### Performance and Resilience
* BBox Snapping: The map API implements a bounding box snapping grid (0.5 to 10 degrees) to maximize server side cache hits and prevent redundant queries during minor panning.
* Fail-Open API: In the event of database statement timeouts, the API returns empty results or cached data to prevent UI crashes.
* Server-Only Protection: Core geodata and geocoding logic are restricted to the server to minimize client side bundle sizes.

## License
Copyright Seraphim 2026. Distributed under the terms of the project license.
