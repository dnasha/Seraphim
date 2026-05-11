# Seraphim Refactor TODO List

This document outlines the technical debt, bugs, and architectural issues identified during the comprehensive codebase analysis. Tasks are ordered by priority: **Critical Architecture & Logic**, **Modularization & Bloat**, and **DX, Config & Docs**.

---

## 🟥 Priority 1: Critical Architecture & Logic
*Tasks that impact stability, security, and core application logic.*

- [x] **1.1: Fix Geocoding Accuracy Test Regressions**
  - **Issue:** `geocoding-accuracy.test.ts` incorrectly marks `null` geocoding results for approved items as "passes".
  - **Fix:** Update `isCorrect` logic to ensure that if an approved item fails to geocode, it is counted as a failure.
- [x] **1.2: Validate Supabase Environment Variables**
  - **Issue:** `src/lib/supabase.ts` lacks validation for `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.
  - **Fix:** Add a check to throw a descriptive error if these are missing during initialization to prevent silent crashes.
- [x] **1.3: Resolve `ranking.ts` NaN Bug**
  - **Issue:** Potential `NaN` result in `latestReportTimestamp` if activity dates are malformed.
  - **Fix:** Add robust date parsing and fallback to a default epoch timestamp if parsing fails.
- [ ] **1.4: Fix `geo.ts` BBox Bypass**
  - **Issue:** `isWithinBBox` returns `true` automatically if a search query is present.
  - **Fix:** Ensure spatial constraints are always applied unless explicitly intended to be global.
- [x] **1.5: Centralize Story Merging Logic**
  - **Issue:** `src/scraper/index.ts`, `scripts/util/re-cluster.ts`, and `scripts/tests/story-merging.test.ts` all re-implement the same merge evaluation logic.
  - **Fix:** Extract `evaluateMerge` and `selectBestContent` into a shared utility in `src/scraper/utils/merging.ts` and refactor all consumers to use it. Implemented a smarter field-level merging strategy with description eviction.
- [ ] **1.6: Modernize Map Popups**
  - **Issue:** Popups in `NewsMap.tsx` use manual string concatenation and `setHTML`, bypassing React and creating XSS risks.
  - **Fix:** Refactor popups to use React components via `MapLibre`'s `Popup` component or a portal-based approach.

---

## 🟧 Priority 2: Modularization & Bloat
*Tasks focused on breaking down "God Components" and reducing technical debt.*

- [ ] **2.1: Refactor `NewsMap.tsx` (The 1.5k-line God Component)**
  - [ ] Extract map layer and source configuration into `useMapLayers` hook.
  - [ ] Move camera and selection animations into `useMapCamera` hook.
  - [ ] Modularize jittering and coordinate logic into separate utilities.
- [ ] **2.2: Modularize `EventSidebar.tsx`**
  - [ ] Extract `renderItem` logic into a separate `EventCard.tsx` component.
  - [ ] Move sidebar resizing logic into a `useResizable` hook.
- [ ] **2.3: Centralize Styling Constants**
  - **Issue:** `CATEGORY_COLORS` and `SOURCE_STYLES` are duplicated in `EventSidebar.tsx`, `FilterBar.tsx`, and `lib/colors.ts`.
  - **Fix:** Make `src/lib/colors.ts` the single source of truth and remove all local redefinitions. Resolve slight color drift in brand colors (e.g., Twitter/X hex code).
- [ ] **2.4: Implement Missing Accessibility (ARIA)**
  - **Issue:** Toggle buttons in `FilterBar` and `EventSidebar` lack `aria-pressed` states.
  - **Fix:** Add dynamic ARIA attributes to all interactive filter elements.
