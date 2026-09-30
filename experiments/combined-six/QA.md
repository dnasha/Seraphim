# Combined integration evidence

Implementation verification is recorded on 2026-09-30. The initial independent Astra review blocked commit `9c70cfc647987c3415179da2f828fb8d2e9226ad` on the 568×320 replay/region layout. The compact repair described below awaits Astra re-review. No deploy, main/test merge, production SQL, credentials, real notifications, or production service calls were used.

## Quality gates

The final tree uses frozen Bun 1.3.14 installation. All **746 installed lock entries** and **42/42 direct dependencies** match; Next/ESLint/SWC **16.3.7**, MapLibre **6.11.2**, Terra Draw **1.35.0**, and test-only fake-indexeddb **6.2.5** match the lock. The nested sanitizer jsdom/MIME dependencies also match. Manifest/lock changes are the approved additive test dependency and the required webpack build command.

- Full tests: **135 files; 1,276 passed; one inherited TODO**.
- Full coverage: **83.69% statements, 76.22% branches, 86.58% functions, 86.84% lines**. Existing global gates remain **70/65/75/70**; feature coverage includes are additive. Main map/Home integration is also exercised in actual browser flows; the existing coverage allowlist does not measure every application component.
- Typecheck, lint, and production webpack build pass. Serwist compiles `/sw.js` with root registration; generated worker files remain ignored.
- The inherited Vite native-config compatibility warning and PostCSS fixture warning remain nonblocking. Negative-path tests intentionally log synthetic failures; all checks exit successfully.

## Browser checks

The fixture/storage runs below are the original integration evidence collected before the compact repair. The repair reran the compiled dashboard at desktop, portrait mobile and six short landscape sizes, plus the compiled worker checks and all quality gates. Its current reachability evidence is recorded in the compact repair section and report.

| Runner | Viewports and evidence |
| --- | --- |
| `test-combined-browser.mjs` | Real HomeContent/MapLibre/Terra Draw, 1,000 synthetic rows. Desktop 1440×900 UTC; touch mobile 390×844 New York; narrow 320×568 Kolkata; landscape 844×390 New York. All pass with zero forbidden requests and browser errors. |
| `test-combined-storage.mjs` | Native IndexedDB and localStorage at desktop/mobile. Read failure/retry retains the completed packet; malformed saved drawings remain protected; explicit legacy copy preserves the source; Undo/Redo and malformed file imports are atomic; quota notice remains usable with tools closed. Replay density and independent region/watch records remain unchanged. |
| `test-combined-production.mjs` | Unchanged compiled Next dashboard, native active worker, desktop 1440×900 and touch mobile 390×844. All six features: replay/density, live raw region/alert checks during empty replay, explicit reviewed versus delivery boundaries, actual canonical dot picking and pin creation, native drawing history persistence, immutable evidence exports/notes opt-in, modal Escape, profile downgrade cleanup, and no overflow. |
| `browser-geofence/verify-production.mjs` | Unmodified compiled worker and production dashboard at 1440×1000 and 390×844. Root active registration, no-store headers, safe canonical click accepted/two unsafe links rejected, legacy cache purge, network-only navigation/private API/RSC/chunks even with seeded malicious caches, and retained public thumbnail. Explicit mock permission, quiet baseline, overlapping-watch dedup, old reentry suppression and unseen arrival delivery pass. |

The four-viewport runner also exercises exact native slider endpoints, 667-point frozen density with original coordinates/canonical aggregate weights, selected events outside the frame, unchanged camera/URL during replay, changing live data while exact detail capture is held, default note exclusion, body focus after download, drawing ownership with heatmap on and off, real `WEBGL_lose_context` loss/restoration, style reload, reduced motion, visible keyboard focus, account/guest isolation, and independent fixed live scopes after panning. No replay data is persisted or sent as live query state.

The compiled six-feature runner uses a loopback API proxy because worker network requests can bypass page routes. It forwards static/document responses from the real Next server with synthetic cookies stripped and mocks API inputs for both page and worker. Auth/provider resources and OS permission/display are synthetic. A service-worker fetch shim blocks external service inputs for this UI run; the separate worker/cache runner checks the actual compiled cache rules without that shim. Fixture initialization explicitly exercises normal throttled profile focus revalidation. Nothing adds a fixture application route or changes the production worker implementation for QA.

All browser delivery calls are intercepted; **zero OS notifications**. Physical devices, hardware GPU timing, Safari/Firefox, live Supabase policies/provider coverage, real notification receipt and native print dialogs remain unverified. SwiftShader and emulated touch are used.

## Reproduce

Run `bun install --frozen-lockfile`, `node scripts/diagnostics/combined-dependency-parity.mjs`, `bun run typecheck`, `bun run lint`, `bun run test`, and `bun run test:coverage`. [The testing guide](README.md) has the synthetic fixture commands.

For the production checks, build and start with these **literal QA placeholders**, in a separate shell from any real service setup:

```sh
export NEXT_PUBLIC_SUPABASE_URL=https://supabase.invalid SUPABASE_URL=https://supabase.invalid
export NEXT_PUBLIC_SUPABASE_ANON_KEY=test-placeholder SUPABASE_SERVICE_ROLE_KEY=test-placeholder
export STRIPE_SECRET_KEY=sk_test_placeholder STRIPE_WEBHOOK_SECRET=whsec_test_placeholder
export UPSTASH_REDIS_REST_URL=https://redis.invalid UPSTASH_REDIS_REST_TOKEN=test-placeholder
export GNEWS_API_KEY=test-placeholder MAPTILER_API_KEY=test-placeholder NEXT_PUBLIC_WAQI_TOKEN=test-placeholder
export EDGE_CONFIG='' ACCOUNT_DELETION_HASH_KEY=test-placeholder
bun run build
bun run start --hostname 127.0.0.1 --port 4175
```

Then, with Playwright installed outside the application checkout:

```sh
PLAYWRIGHT_MODULE_PATH=/path/to/playwright/index.mjs CHROMIUM_PATH=/path/to/chromium \
  SERAPHIM_QA_BASE_URL=http://127.0.0.1:4175 node scripts/diagnostics/test-combined-production.mjs
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs CHROMIUM_PATH=/path/to/chromium \
  SERAPHIM_QA_BASE_URL=http://127.0.0.1:4175 QA_SCREENSHOTS=artifacts/combined-six/production \
  node scripts/fixtures/browser-geofence/verify-production.mjs
```

Both artifact runners refuse non-loopback targets. Full logs, reports and screenshots remain in ignored `artifacts/combined-six/` in the saved environment; a curated [verification report](evidence/verification.json) and synthetic screenshots are committed here. The earlier recovery bundle/patch remains at `/workspace/combined-six-recovery/` as an archival checkpoint.

Screenshots: [compiled desktop](evidence/compiled-desktop.png), [compiled mobile evidence](evidence/compiled-mobile-evidence.png), [1,000-row replay comparison](evidence/desktop-frozen-comparison.png), [landscape controls](evidence/landscape-controls.png), and [mobile storage recovery](evidence/mobile-storage-recovery.png).

## Integration decisions

Approved source heads and baseline are listed in [the guide](README.md). Shared files retain all features: heatmap receives replay's displayed map rows, live region/notification scopes remain independent, map clicks check one drawing ownership ref, and replay camera suppression preserves deliberate selection. Drawing keeps its approved account/history/persistence/race behavior and optional ownership callback. Coverage configuration retains the union of all feature gates and includes.

Combined evidence exports add optional validated/frozen replay provenance and a temporal caveat, while older packets remain valid. Dialog isolation includes body focus after downloads. Compact Stories hides only replay controls to preserve list space while playback stays mounted. Ordinary floating panels use actual map space. Short landscape sheets instead use viewport space above mobile navigation, keeping padding and controls usable when replay leaves a shallow map; zoom and map actions occupy separate rows. No feature branch was altered.

## Compact landscape repair

Astra reproduced a 34 px checkpoint panel at y = −10.39 on a 122 px map while replay was frozen at 568×320. The original `map height − 104px` limit left less space than the panel padding. The repair keeps replay mounted and uses viewport-bounded, scrollable sheets above mobile navigation for checkpoints, watch alerts, settings, environmental overlays, drawing tools and expanded heatmap information. Opening a sheet temporarily covers part of the map/replay; close it before changing tools. A collapsed drawing header sits above navigation so active drawing gestures retain the canvas. The overlay sheet supports Close/Escape with focus restored to its launcher. Both zoom buttons fit horizontally inside the map.

The compiled six-feature runner has a `SERAPHIM_QA_COMPACT=1` regression mode. It checks **480×320, 568×320, 640×360, 667×375, 844×390 and 920×412** using normal Playwright actions, with no forced clicks. It requires at least 160 px of usable sheet height, checks panel bounds above navigation, and uses `elementFromPoint` to reject control centers hidden by clipping or another launcher. It exercises settings/heatmap explanations, zoom in/out, overlay scrolling/Close/Escape, region naming/save/check/explicit review, watch save/mock enable, actual story-dot picking and pin creation, Undo/Redo, evidence capture/download, mobile views and tier cleanup. The 568×320 run also resizes an open region sheet to 667×375 and back without changing its reviewed baseline. At 568×320 the region, alert and drawing sheets are **232 px** high while the frozen map remains **122 px**.

A focused editor regression covers initial collapse and disabled panel dragging in a wide compact landscape. Production assertions cover the CSS/pointer layout that jsdom cannot measure. Desktop 1440×900 and portrait mobile 390×844 retain the normal compiled six-feature checks. No access rules, live-query scopes, drawing documents, packet storage or coverage gates were changed.

After the literal-placeholder build/start above, run:

```sh
SERAPHIM_QA_COMPACT=1 PLAYWRIGHT_MODULE_PATH=/path/to/playwright/index.mjs \
  CHROMIUM_PATH=/path/to/chromium SERAPHIM_QA_BASE_URL=http://127.0.0.1:4175 \
  node scripts/diagnostics/test-combined-production.mjs
```

Reports and screenshots are preserved in `artifacts/combined-six/compact-repair/`. The original Astra reproduction is retained separately in `artifacts/astra-combined-review/` and `/workspace/astra-combined-six-9c70cfc-review.tar.gz`. Curated evidence: [568×320 controls](evidence/se-landscape-controls.png), [568×320 usable region form](evidence/se-landscape-region-form.png), and [repair verification report](evidence/compact-repair.json). Reachability claims refer to the named verified viewports, with one sheet/popup at a time; physical devices and other engines retain the limits above.
