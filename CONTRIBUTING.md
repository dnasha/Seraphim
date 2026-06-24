# Contributing to Seraphim

Thank you for your interest in contributing to Seraphim! As a real-time OSINT news aggregation and mapping platform, we maintain high standards for performance, security, and code quality. This guide will help you set up your development environment and outline our contribution guidelines.

---

## 🏗️ Technical Architecture Constraints

Before writing code, please familiarize yourself with the critical constraints of the codebase:

1. **🔒 Server-Only Modules**: 
   - The geocoding engine (`src/lib/geocoding/engine.ts`) and its geographic datasets (~4.7MB) are marked with `server-only` to prevent them from inflating the client-side JavaScript bundle.
   - Do **NOT** import anything from `src/lib/geocoding/` or backend libraries directly into client React components. Client components should fetch geocoded data exclusively via Next.js API routes (`/api/news`).
   - If a module is used in CLI/benchmark tools, set `IS_BENCHMARK="true"` or run via Bun.

2. **🎨 Style & Design System**:
   - Styling is written in **Vanilla CSS** and **CSS Modules** to ensure styling isolation. Avoid adding inline styles or raw Tailwind utilities unless explicitly approved.
   - Centralized brand colors are managed in `src/lib/colors.ts` and `src/app/globals.css`.
   - Adhere to the tiered radius system: `--radius-sm: 4px`, `--radius-md: 8px`, `--radius-lg: 12px` (rectangular toggles, no legacy pill-shaped elements).

3. **🗺️ URL & View State Sync**:
   - The map's viewport coordinates (`lat`, `lng`, `zoom`) and filters (`q`, `t`, `src`, `cat`, `s`) are synchronized in the URL via `useViewState` using `replaceState` to allow persistent, shareable links. Ensure any new filters are properly registered in the state hook.

---

## 🛠️ Local Development Setup

### 1. Prerequisites
- **Bun** (Primary runtime, package manager, and test runner)
- **Supabase** (Postgres DB with PostGIS, pgvector, and pg_trgm)
- **Upstash Redis** (Optional, for rate-limiting verification)

### 2. Cloned Repository Setup
```bash
# Clone the repository
git clone https://github.com/dnasha/Seraphim.git
cd Seraphim

# Install dependencies using Bun
bun install --frozen-lockfile

# Compile the GeoNames local cache
bun run scripts/build-geodata.mjs
```

### 3. Database Setup
Set up your own Supabase database by enabling the `postgis`, `vector`, and `pg_trgm` extensions, and creating the necessary event tables and RPC functions (such as spatial clustering and bulk ingestion). For details on the database structure, refer to the Database Blueprint section of the project `README.md`.

### 4. Running the Development Server
```bash
# Starts Next.js with Turbopack enabled
bun dev
```

---

## 🧪 Testing Guidelines

We use **Vitest** for unit and integration testing. Any feature addition or modification must include test coverage.

```bash
# Run the entire Vitest suite
bun run test

# Run tests in watch mode
bun run test:watch

# Run coverage report
bun run test:coverage
```

### 🎯 Geocoding Accuracy Benchmarks
To prevent regressions in location extraction and NLP scoring, we run a geocoding regression benchmark against 400 manually verified sample inputs.
- If you modify the geocoding logic in `src/lib/geocoding/`, you **must** run the accuracy benchmark:
  ```bash
  bun run test:accuracy
  ```
- Review the output in `scripts/results/` to ensure your changes did not decrease geocoding resolution or introduce false positives.

---

## 📝 Code Quality & Conventions

1. **Strict Typing**:
   - We enforce strict TypeScript configurations. Avoid using `any`. Use defined interfaces or generics instead.
   - Use correct database return mapper types found in `src/types/index.ts`.

2. **Linting & Formatting**:
   - Always run the lint check before opening a PR:
     ```bash
     bun run lint
     ```
   - Resolve any warnings or errors before committing.

3. **Comments & Documentation**:
   - Keep comments precise. If you are modifying a complex SQL function or utility, update the inline comments and document the functional usage clearly.

---

## 🚀 Submitting a Pull Request

1. **Branch Naming**:
   - Use descriptive branch names: `feature/your-feature-name` or `bugfix/issue-description`.
2. **Commit Messages**:
   - Use clear, descriptive commit messages (e.g., `feat: add category filter for maritime stories`, `fix: prevent map center flickering on rapid pans`).
3. **Open a PR**:
   - Base your branch off of `main`.
   - Complete the **Pull Request Template** details (related issues, checklist, testing verification, description).
   - Ensure all CI tests, linting check, and build steps pass on your local machine before pushing.
