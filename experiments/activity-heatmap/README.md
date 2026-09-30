# Activity heatmap experiment

Branch: `experiment/activity-heatmap`. Immutable base: `4c693ccd78e7d0c26842488db77be3ae0ede0fd5` (PR20).

## Experience

Open Map settings → Display Mode → Activity heatmap. The toggle works with the current displayed, entitled dataset and persists only on this device, separately for each account and guests. Reset saved heatmap choice deletes that account's local choice. Storage failures leave a working session toggle and an explanatory message.

Heatmap mode hides normal news pins, cluster circles/counts and hot-story pulses. It retains the selected category marker and existing popup/sidebar selection. Small dots offer an 8 px click/touch tolerance. Turning it off restores the previous individual-pin mode and animations without changing that preference, map scope, filters or selection.

The legend shows relative loaded/filtered reporting density, explicitly distinguishes it from danger/risk, and explains zoom changes, approximate grouped locations, incomplete/stale coverage and caps. Empty, loading and failed-update states have specific text. The palette follows the application theme; the Settings panel and legend remain scrollable in constrained viewports.

## Data and boundaries

- Dedicated **unclustered** source: `experiment-activity-heatmap-source`. Layers: `experiment-activity-heatmap-density` and `experiment-activity-heatmap-hit`.
- Density uses original input coordinates, before pin jitter. Raw events weigh 1; aggregate representatives use valid `storyCount`. Publisher volume and impact score never affect weight.
- Canonical-ID duplicates contribute once, favoring the aggregate representative over its individual detail. API aggregates do not expose membership, so separate raw members of an aggregate cannot be identified from these rows; the input must remain one displayed representation per canonical event, as on the baseline.
- An aggregate dot deliberately selects its canonical representative through the existing selection/detail path. It does not imply selection of every aggregate member.
- No new API calls, query parameters, entitlement changes, URL state, telemetry, cloud preferences, SQL, migrations or service-worker changes.
- Local key: `seraphim:experiment:activity-heatmap:v1:account:<owner>` (or `...:guest`); payload `{version:1,enabled:boolean}`. Reads are bounded to 128 characters, validate the schema and delete invalid records. Quota/security failures, cross-tab changes/deletion and account-switch hydration cancellation are tested. No event data is persisted.
- Sources/layers reinstall after style replacement or map recreation, and are removed when disabled. Their lifetime ends with the existing map on unmount. Radius is bounded to 36 screen pixels; pulse animation stops in heatmap mode.

## Verification recorded 2026-09-30

- `bun run typecheck`: passed.
- `bun run lint`: passed.
- Focused heatmap plus existing map performance/recovery tests: 34 passed (22 new feature tests).
- `bun run test:coverage`: **113 files passed; 1,033 tests passed; 1 existing todo**. Global statements 83.88%, branches 75.97%, functions 88.25%, lines 86.90%; all configured thresholds passed. All four heatmap TypeScript/TSX files have 100% line coverage.
- `bun run build`: passed with placeholder service settings; the temporary QA route/assets were removed before the build.
- Real Chromium/MapLibre at 1440×900 and touch-enabled 390×844: keyboard toggle, 1,000 events, actual dot click, existing popup and sidebar selection, light/dark style replacement, empty/capped input, a changed displayed subset, reload persistence, account isolation, pin-preference restoration and actual `WEBGL_lose_context` loss/restoration all passed. **Zero `/api/` requests and zero browser errors** in both runs.
- Toggle-to-source-readiness: 274 ms desktop, 309 ms mobile in this cloud's SwiftShader environment. These are QA observations, not hardware performance guarantees.
- Screenshots were visually inspected before/after and for mobile legend/selection/dark mode. Saved environment evidence: `/workspace/.seraphim-tools/logs/heatmap-qa/` (`report.json` and `desktop-*`/`mobile-*` PNGs). Final lint/build/coverage logs are alongside it under `logs/heatmap-*-final.log`.

The first full run caught missing button tooltips, which were added. The initial map-recovery mock also returned a news source for every possible source ID; it now respects source identity. No unresolved failures or environment blockers remain. Vitest emits the baseline warning about future Vite native config loading; existing negative-path tests intentionally log simulated failures. The initial agent-browser smoke test used unavailable remote glyphs and MapLibre's fallback; the final scripted browser runs mock all remote resources and report no browser errors.

The pinned baseline contained no reusable 1,000-event map fixture, so this branch adds a deterministic synthetic fixture used by tests and browser QA. Browser QA uses a fixture basemap/font responses and a mock account/tier, not live customer services. Production tiles, hardware mobile GPUs and other browser engines were not tested. Separate Astra verification is pending.

## Reproduce browser QA

Install `@playwright/test` outside the checkout if it is unavailable. Install the temporary fixture:

```sh
node scripts/qa/activity-heatmap-fixture.mjs
NEXT_PUBLIC_SUPABASE_URL=https://supabase.invalid \
NEXT_PUBLIC_SUPABASE_ANON_KEY=test-placeholder \
bun run dev --port 3010
```

In a second shell, set `NODE_PATH` to the external installation's `node_modules`, optionally set `HEATMAP_QA_CHROMIUM` to a Chromium executable and run:

```sh
node scripts/qa/activity-heatmap-browser.mjs
```

After stopping the dev server, **remove the temporary QA route and public assets before repository checks, building or committing**:

```sh
node scripts/qa/activity-heatmap-fixture.mjs --clean
```

Artifacts default to ignored `artifacts/activity-heatmap`; override with `HEATMAP_QA_ARTIFACTS`. The fixture installer refuses to overwrite an existing route/assets. The fixture page is stored with `.fixture` extension and is not an application route in the committed tree.

## Integration hotspots

- `NewsMap.tsx`: preference hook, displayed `items` → density memo/ref, pulse suppression, generic small-dot click handler and legend. The usual `news-events` source and `forceIndividualPins` query mode remain independent.
- `useMapLayers.ts`: one optional ref and a small restore call alongside the selected layer registration. Preserve this call when integrating other experiment layers.
- `MapSettings.tsx`/CSS: new toggle, local reset/error controls and temporarily disabled individual-pin control. Keep the saved individual-pin state separate from heatmap visibility.
- `HomeContent.tsx`: only passes existing `isCapped` and error flags. For replay integration, pass the replay **displayed** dataset as `items`; never provide the underlying full snapshot/live dataset to density.
- `vitest.config.ts`: adds heatmap files to coverage. Combine this additive include with other experiments' includes.
- Other experiments that suppress news layers or own map clicks should coordinate visibility/click precedence without mutating filters or selecting synthetic IDs. Region/notification queries remain independent of this presentation-only dataset.

Implementation was assisted by Codex in the delegated implementation turn. No PR, merge, deployment or live migration was performed.
