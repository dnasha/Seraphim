# Seraphim

**A live, map-first view of global events from public reporting and open sources.**

[Open the hosted app](https://seraphi.me) · [Contribute](CONTRIBUTING.md) · [Report a security issue](.github/SECURITY.md)

![Seraphim global event map](public/Seraphim_OG_Dynamic.png)

Seraphim turns a noisy stream of headlines and public posts into a location-aware event map. It collects reports from multiple source types, extracts geographic context, groups related coverage, and makes the result explorable through an interactive dashboard.

The project is useful for following fast-moving stories, finding regional patterns, and moving from a map-level signal to the reporting behind it. Seraphim is an aggregation and discovery tool—not a substitute for primary sources or independent verification.

> [!NOTE]
> Seraphim is under active, pre-1.0 development. Interfaces, data contracts, and self-hosting requirements may change.

## What it does

- **Unifies public reporting.** Ingests RSS, news API, Reddit, Telegram, and X-derived feeds through a shared normalization pipeline.
- **Maps geographic context.** Uses a local GeoNames dataset plus NLP and scoring heuristics to resolve place references without requiring a paid geocoding request for every story.
- **Connects related coverage.** Combines exact matching, location context, and local text embeddings to group duplicate or corroborating reports into events.
- **Makes the world browsable.** Provides a MapLibre-powered interface with viewport loading, clustering, search, time and source filters, shareable event links, map styles, overlays, and local annotations.
- **Protects signal quality.** Applies content-quality checks, source-aware polling, deduplication, and bounded ingestion so noisy sources do not overwhelm the feed.
- **Supports different workflows.** Guest access offers a quick live preview; accounts add saved preferences and deeper investigation capabilities, with additional tools available in the hosted SaaS.

## How the pieces fit together

Seraphim is one TypeScript repository with two main runtimes and a shared event model:

```text
Public feeds and news providers
              │
              ▼
     Bun ingestion worker
  fetch → normalize → quality checks
              │
              ▼
 Geocoding and story reconciliation
 location scoring → similarity → merge
              │
              ▼
   PostgreSQL-compatible data layer
 spatial, text, and vector capabilities
              │
              ▼
       Next.js application
 APIs → filters → MapLibre dashboard
```

Core technologies include Next.js 16, React 19, Bun, TypeScript, MapLibre GL JS, Supabase/PostgreSQL, PostGIS, pgvector, Vitest, and local Hugging Face transformer inference.

## Open-source scope and hosted-service boundary

The application and ingestion code are open for inspection, modification, and contribution. The hosted service at [seraphi.me](https://seraphi.me) is a separately operated SaaS deployment.

This repository intentionally does **not** publish production credentials, provider accounts, live database definitions, private migrations, deployment configuration, incident procedures, or operational runbooks. Those details are environment-specific and may contain security-sensitive or commercially relevant information.

The public code still shows the important system boundaries and contracts. A compatible deployment needs:

1. A PostgreSQL data layer with spatial and vector support.
2. Event storage capable of representing source attribution, location, publication time, and related reports.
3. An ingestion worker that normalizes sources, geocodes items, reconciles related stories, and writes results transactionally.
4. Read APIs that enforce access rules and query events by viewport, time, and filters.
5. A scheduler or worker platform appropriate for the desired update frequency.
6. Your own authentication, billing, rate-limiting, observability, backup, and secret-management choices.

That blueprint is enough to study or adapt the architecture, but this repository is not presented as a one-command replica of Seraphim's production environment.

## Repository guide

```text
src/app/                 Next.js pages, route handlers, and metadata
src/components/          Dashboard, map, auth, and shared UI
src/hooks/               Data, URL-state, and preference orchestration
src/lib/                 API adapters, geocoding, security, and shared logic
src/scraper/             Ingestion, quality, merging, and database writes
src/data/                Public source registry
scripts/tests/           Unit, integration, security, and regression tests
scripts/diagnostics/     Focused local diagnostics
data/                    GeoNames-derived local lookup data
.github/                 CI, contribution templates, and security policy
```

## Local development

### Prerequisites

- [Bun](https://bun.sh/) 1.3 or newer
- A compatible Supabase/PostgreSQL development project for data-backed flows
- Git

### Install and run

```bash
git clone https://github.com/dnasha/Seraphim.git
cd Seraphim
bun install --frozen-lockfile
bun run dev
```

The app is served at [http://localhost:3000](http://localhost:3000).

Create `.env.local` for the integrations you intend to exercise. The minimum browser-facing Supabase variables are:

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

Server-side ingestion and SaaS features require additional provider-specific variables. Follow the names referenced by the relevant route or worker, keep service-role and billing secrets server-only, and never commit an environment file.

The compiled geographic lookup is included. If you update the raw GeoNames inputs, rebuild it with:

```bash
bun run scripts/build/build-geodata.mjs
```

Because the production database contract is outside the public repository, a fresh clone can run the code and test suite but data-backed application flows require your own compatible schema and policies.

## Useful commands

```bash
bun run dev             # Start the Next.js development server
bun run build           # Create a production build
bun run lint            # Run ESLint
bun run test            # Run the Vitest suite once
bun run test:watch      # Run Vitest in watch mode
bun run test:coverage   # Run tests with coverage gates
bun run test:accuracy   # Run the reviewed geocoding regression set
bun run test-scraper    # Check ingestion dependencies and connections
bun run test:sources    # Exercise source adapters
DRY_RUN=true bun run scrape  # Run ingestion without database writes
```

Some diagnostics contact third-party services or expect a configured local environment. Review a script before running it with live credentials.

## Contributing

Bug fixes, tests, documentation, accessibility improvements, performance work, source-quality improvements, and carefully scoped features are welcome. AI-assisted contributions are also welcome when they follow the verification and disclosure requirements in [CONTRIBUTING.md](CONTRIBUTING.md).

For security vulnerabilities, do not open a public issue. Follow the private reporting process in [the security policy](.github/SECURITY.md).

## License

Seraphim is licensed under the [GNU Affero General Public License v3.0](LICENSE). If you modify and operate the software over a network, review the AGPL's source-availability requirements for your deployment.

Copyright © 2026 Seraphim contributors.
