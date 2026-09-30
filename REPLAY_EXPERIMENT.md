# Reporting replay experiment

Branch: `experiment/replay-timeline`. Baseline: `4c693ccd78e7d0c26842488db77be3ae0ede0fd5` (PR20).

The bottom reporting-replay panel freezes the currently loaded, entitled view in memory. Pro can reconstruct permitted presets (24 hours, 3 days, 1 week, 1 month); Analyst/Angel can also use the existing custom live query and edit comparison bounds within captured coverage. Guest/Free cannot start replay.

Use **Freeze loaded view**, scrub the cursor, play/pause, or step manually. The display can include all dated evidence through the cursor or a trailing hour/6 hours/24 hours. Open **Compare two reporting windows** to inspect adjacent halves by default, or save the displayed bounds as A/B. Analyst/Angel can edit A/B dates. **Refresh snapshot** captures the currently loaded live view again; it does not issue an extra historical or refresh request. **Return live** discards the snapshot. Normal live loading/polling remains independent.

## Reconstruction semantics

- This is reporting reconstruction, not historical event state. Titles, coordinates, ranks, counts and cluster membership remain metadata as captured. Deliberately requested selected-story descriptions/source details may hydrate current metadata in the sidebar and map popup; this never changes captured temporal evidence.
- Evidence is the valid, explicit-timezone `publishedAt`, `latestActivityAt`, and already loaded source `discoveredAt` values. Duplicate instants within a representative count once. Invalid/ambiguous/future timestamps are ignored, with no fallback to now. A row without evidence inside permitted coverage is excluded.
- “Represented event dates” uses the current `publishedAt` as captured. Merges may have moved that date. “New represented event dates in B” means B's represented-date identities absent from A's represented-date identities. “Reporting overlap” counts identities with available activity in both windows. None of these measures is an exhaustive event/publisher count or a resolved/deleted-event inference.
- Frames include both endpoints so exact scrub instants appear. Comparisons use `[start, end)`, except the captured coverage endpoint is included. Labels explain this boundary distinction.
- Aggregated rows represent canonical events; hidden spatial-cluster members are not reconstructed. Synthetic `cluster-*` IDs without a canonical individual identity are skipped. Existing `canonicalNewsId()` / `matchesNewsId()` are used unchanged.
- Capped coverage is retained from the live hook, with limit warnings. Coverage is only the loaded view and can omit stories; cached data may be stale. No complete historical coverage is claimed. `capturedAt` is distinct from event/publication and feed-update timestamps.
- URL selection remains selected even outside a frame; its current detail card remains available and the replay panel marks the exception. Replay writes no URL state, preferences, analytics, local/session storage, service-worker cache, database data, or schema. Closing the tab, returning live, or changing account/tier clears the memory snapshot. Playback pauses on hidden tabs/reduced-motion changes and cancels on cleanup. Reduced motion offers manual scrub/step only.

## Integration points

- `HomeContent.tsx`: additive hook/panel integration after existing `useNewsFilter` and tier limits. `displayedMapNews`/`displayedSidebarNews` are the presentation datasets. A combined heatmap should consume `displayedMapNews` (already passed as `NewsMap.items`). Region checks/notifications should continue using their independent live scope, not these presentation datasets.
- `NewsMap.tsx` and `useMapCamera.ts`: optional `presentationOnly` flag suppresses automatic selection/correction flights while preserving popup/selection behavior. This prevents replay rows returning to a frame from moving the camera and generating viewport fetches. Ordinary behavior defaults unchanged. No map sources/layers were added.
- All reconstruction logic and state live in the feature's lib/hook/components. No drawing, notifications, service-worker, entitlement contract, API route, cache, SQL, credentials, migrations, billing or deployment changes.

## Verification

```sh
bun run typecheck
bun run lint
bun run test:coverage
bun run build
TZ=Asia/Kolkata bun x vitest run scripts/tests/replay-timeline.test.ts scripts/tests/replay-controls.test.tsx
```

Feature tests cover explicit-offset/calendar validation, future/invalid evidence, preset/custom permissions, canonical cluster representatives, deep snapshot isolation, exact boundaries and overlap, selected-story hydration, no feed/URL/preference writes from playback, account/tier reset, pause/cancel/restore, reduced motion, DST gaps/folds and fractional timezone offsets. The existing camera tests run alongside a replay regression checking that disappearing/reappearing representatives cannot start flights.

To repeat browser QA without external services:

```sh
node scripts/diagnostics/replay-browser-server.mjs
# In another terminal, with Playwright available:
node scripts/diagnostics/test-replay-browser.mjs
node scripts/diagnostics/test-replay-browser-controls.mjs
```

The fixture server binds only `127.0.0.1:4175`. It uses the actual HomeContent, sidebar, filters, URL hook and replay UI, with synthetic rows and mocked auth/feed/map services. It is never an application route or production bundle. The browser script blocks external requests and asserts none occurred. Set `PLAYWRIGHT_MODULE_PATH` to an installed Playwright ESM module if not locally installed, and `CHROMIUM_PATH` if Chromium is elsewhere.

Final repair verification: typecheck/lint/build passed; 115 test files and 1,045 tests passed (one existing todo). Global coverage: 84.14% statements, 76.23% branches, 88.68% functions, 87.18% lines. The coverage allowlist now includes the replay hook and controls in addition to the reconstruction library. Existing Vite config-loader warnings did not prevent verification. No remaining environment blocker.

Browser QA covers 1440×900 desktop (UTC) and 390×844 mobile (America/New_York): freeze, scrub, play/pause, late responses, comparisons, snapshot refresh, live restore, shared selection, account switch, free/Analyst permissions, reduced motion, overflow and zero replay persistence. Screenshots/results are saved in ignored `artifacts/replay/`. WebGL rendering, live authentication and real database/tile services are mocked; camera behavior is covered by the real camera hook's unit/regression tests. Astra review and combination testing remain the next stage.

## Review repairs

- The native range uses integer positions mapped onto captured timestamps. Home/End and pointer drags reach both exact endpoints even for arbitrary millisecond bounds; windows shorter than 1,440 milliseconds use one position per millisecond so arrow keys still advance. Step forward shares the playback increment.
- The heading stays above a separately scrolling body, with focus scroll spacing. The reporting cursor leads both visual and tab order. Native keyboard QA at 320×568 and 844×390 verifies unobscured slider, buttons, select, summaries, and all Analyst comparison editors.
- Freeze/Refresh share capture validation and provide a visible, accessible disabled reason for invalid calendar dates, reversed/empty bounds, future starts, loading, and unavailable entitlements. A future start is rechecked when it becomes usable; the clock cancels on scope/account changes and cleanup. Invalid live bounds cannot replace an existing snapshot.
- `test-replay-browser-controls.mjs` covers the exact endpoint repro, a one-millisecond window, native Home/End/arrows and pointer drags, mobile tab traversal, and future/reversed/invalid-calendar capture gates. It blocks external requests and uses only synthetic fixture services. The original browser script now scrubs with native pointer input too.
- Dependency parity was checked before final gates. The saved environment initially had Next/ESLint config 16.3.5 and MapLibre 6.10.0. `bun install --frozen-lockfile`, followed by `--force` to repair a missing nested MIME-parser dependency, restored the committed installation without manifest or lockfile edits. All 41 direct packages and the affected nested jsdom/MIME parser match the lockfile: Next/ESLint config 16.3.7, MapLibre 6.11.2, nested jsdom 30.1.1, and MIME parser 5.0.0. Final gates and browser runs passed after that repair; parity evidence is in ignored `artifacts/replay/dependency-parity.json`.
