# Analyst evidence workspace experiment

Independent of the replay, heatmap, region, drawing, and notification experiments. Based on PR20 (`4c693ccd78e7d0c26842488db77be3ae0ede0fd5`). No database changes or new external services are required.

## Use

Analyst and Angel accounts see **Add to evidence** below story cards. This selection is separate from the active map pin and is not written to URLs or synced preferences. The **Evidence workspace** button in the sidebar opens a keyboard-accessible modal. On mobile, use the Stories tab to open it; an active map event can be added inside the workspace.

Aggregate rows explicitly select their individual representative, not every cluster member. Selection uses `canonicalNewsId()` and rejects unresolved synthetic cluster IDs. It deduplicates a raw event and its aggregate representative.

Choose up to 20 events, optionally write private local notes, and capture. Capture makes fresh client requests to the existing exact-ID detail route, with three concurrent requests and 15-second request timeouts. Each detail response is bounded to 512 KB; at most 200 returned source records are copied per event, with a visible truncation marker. Individual HTTP, identity, size, parse, and timeout failures remain visible in a partial packet. Account changes, cancellation, and entitlement failures discard pending work. Captures are copied by an allowlist and recursively frozen. Later merges, feed updates, selections, and notes cannot change a packet.

Capture does not query historical listings or enumerate cluster members. The existing exact-ID route allows a deliberately selected known event outside a list window. Existing rate limits, source authorization, and timeline restrictions remain in force. No additional sources are inferred or fetched from publishers.

## Access and privacy

The additive `evidenceExport` entitlement is available only to Analyst and Angel. `/api/analyst/access` verifies the current server session and effective tier, returning only user ID and tier with private/no-store headers. The workspace verifies identity on initialization and focus, before capture, after capture, and before every export. `/api/news/[id]?evidence=true` enforces the same entitlement in addition to the existing detail behavior. Ordinary detail requests retain their current gates. A transient authorization failure fails closed. Account/tier/loading transitions synchronously hide private UI, abort outstanding work, and remove temporary print frames.

Packets and notes use the `seraphim-experiment-analyst-evidence-v1` IndexedDB database, in the `workspaces` object store under `seraphim:experiment:analyst-evidence:v1:<encoded-account-id>`. Each write is an intent applied to a fresh, validated envelope in a native read/write transaction. Concurrent saves cannot overwrite unrelated packets or notes; conflicting edits of the same note are rejected visibly. Valid legacy localStorage data is copied in a transaction on first open, then the legacy key is removed. Invalid legacy data remains untouched until explicitly deleted.

The envelope validates the owner, version, canonical IDs, fields, source counts, and packet structure on every read/write. Limits: 8 saved packets, 2 MB estimated UTF-16 serialized data per account, 100 notes, 2,000 characters per note. Quotas never silently evict packets. A completed capture remains available for download if saving fails. Without IndexedDB, saving is disabled with a visible error; capture/export and validated legacy packet downloads remain available.

Ordinary cross-tab updates reconcile saved data while retaining selections, completed unsaved captures, and pending capture/export work. BroadcastChannel and metadata-only storage notifications signal a change; packet and note contents never enter those messages. Focus also reconciles the database after checking access. Explicit reset atomically removes packets and notes, retains only an empty generation marker, cancels pending work, and removes temporary print/download resources. Writes from an older generation cannot restore deleted content. Deletion is available to the signed-in owner after a downgrade, too.

Private notes are excluded by default from JSON, CSV, HTML, and printing. Explicit inclusion shows a preview and copies only the current notes associated with the selected packet, separately from the immutable packet. Inclusion resets when switching packets. No notes, packet contents, or private workspace identifiers are sent to analytics or cloud preferences. This browser storage is unencrypted; downloaded/printed copies are outside application control.

## Packet and export formats

Version 1 JSON export: `{version:1, packet, notesIncluded, privateNotes?}`. `packet` records capture start/end, access check time/tier, the displayed dashboard scope at capture, and ordered entries. Each entry records canonical identity, selected title/time, whether it represented an aggregate, request start, response receipt, event data or a partial error, and source restrictions. Event fields retain original source URL/type, publication and headline source times, location, credibility/impact metadata when returned, description provenance, and the server-authorized source names/URLs/discovery times. Unknown/internal fields and images are omitted.

The scope is a copy of **dashboard settings at capture**, not a completeness assertion or the original query for every earlier selection. It records time/custom bounds, search, sort, source/category/volume/credibility filters, viewport, list cap/applied limit, displayed count, and whether loading or a feed error was present. `useNewsData` does not expose response `meta.stale` or all clustering/scope metadata: `freshness-not-reported` deliberately avoids claiming that the feed was fresh. Representative selection records clustering explicitly. Exact details can use the existing 60-second server cache; response time is not publisher time or database transaction time. Publication time can move after story merges. These are copied observations, not archival authenticity guarantees.

CSV uses a fixed header and `row_type` values:

| Row | Meaning |
| --- | --- |
| `packet` | Packet disclaimer and shared capture metadata |
| `event` | One successfully copied event, primary publisher fields, provenance JSON and restrictions |
| `source` | One authorized source for the preceding event, with publisher URL/type/discovery time |
| `error` | One failed selected event and its error |
| `note` | Explicitly included private note for an event |

Every row repeats packet ID, capture start/end, access check, scope JSON, and `notes_included`. Event/source/error/note rows identify the canonical event and request/response times. Cells are quoted with doubled quotes and CRLF row separators (RFC 4180); line breaks inside cells are preserved. Leading spreadsheet formula operators, including after whitespace/control characters, receive an apostrophe. NULs are removed. Protected numeric-looking negative values therefore remain text. JSON is the lossless structured format.

The printable HTML brief escapes all text and attributes, validates outbound HTTP(S) links (rejecting credentials and other schemes), and has a restrictive CSP. It embeds no scripts, remote images, fonts, maps, or posters. Download it for an offline brief, or use **Print / save PDF**, which prints an isolated sandboxed frame. Printing does not establish authenticity or completeness.

## Verification and integration

Focused tests: `scripts/tests/analyst-storage-concurrency.test.ts`, `scripts/tests/analyst-evidence.test.ts`, `analyst-workspace.test.tsx`, `analyst-access-route.test.ts`, plus the evidence-gate cases in `news-detail-route.test.ts`. Existing mobile selection tests remain intact.

Offline browser fixture:

```sh
node node_modules/vite/bin/vite.js --config scripts/qa/analyst/vite.config.mjs
```

Open `http://127.0.0.1:4179`. This exercises the real HomeContent, sidebar/cards, workspace, and hook; map rendering, auth/profile, list data, and external services are replaced with synthetic fixtures. Event 3 returns a 503 to exercise partial captures. Fixture-only `window.analystQA.setAccount(id, tier)` changes account/tier; `updateLive()` mutates live event presentation. No fixture code is imported by the production application. Browser checks use 1280×633 and 390×844 viewports, downloaded exports, account changes, and printable PDF output. Native operating-system print-dialog behavior still needs device-level confirmation.

Integration hotspots are the additive HomeContent workspace/props, optional EventSidebar/EventCard evidence controls, the entitlement union/default/Analyst map, and the optional detail API query gate. NewsMap, shared selection/filter hooks, serializers from other experiments, and service workers are untouched. A future integration may expose actual feed response metadata to replace the deliberately unknown freshness label. The feature has no dependency on another experiment branch.

Screenshots below use only the synthetic fixture. The baseline screenshot uses the immutable baseline HomeContent with the same map/service doubles.

- [Baseline desktop](screenshots/baseline-desktop.png)
- [Feature desktop](screenshots/feature-desktop.png)
- [Desktop workspace](screenshots/desktop-workspace.png)
- [Mobile workspace](screenshots/mobile-workspace.png)
- [Printable brief](screenshots/printable-brief.png)

To reproduce a baseline comparison, materialize only the baseline HomeContent beside its unchanged layout dependencies, start a second fixture, then remove the temporary file:

```sh
git show 4c693ccd78e7d0c26842488db77be3ae0ede0fd5:src/components/layout/HomeContent.tsx > src/components/layout/.analyst-baseline-HomeContent.tsx
ANALYST_QA_BASELINE=1 node node_modules/vite/bin/vite.js --config scripts/qa/analyst/vite.config.mjs
# Screenshot http://127.0.0.1:4181, stop that fixture, then:
rm src/components/layout/.analyst-baseline-HomeContent.tsx
```


Final implementation validation on 2026-09-30:

- `bun run lint`: passed without warnings.
- `bun run typecheck`: passed.
- `bun run test:coverage`: 113 files passed; 1,051 tests passed, 1 existing TODO. Global coverage: 84.11% statements, 75.75% branches, 88.59% functions, 87.20% lines; all thresholds met.
- `bun run build`: passed (Next.js 16.3.5, optimized Turbopack build).
- Chromium desktop/mobile QA: independent selections, explicit representative resolution, partial 503 capture, default note exclusion and explicit inclusion, downloaded JSON/CSV/HTML validation, live-update immutability, account isolation, Pro downgrade, keyboard focus containment, no mobile horizontal overflow, sandboxed print frame cleanup, and PDF text verification.

The fixture's synthetic PDF contained both selected events and the partial capture error, without private notes. Real Supabase/customer data and native OS print-dialog/device behavior were not exercised. The existing Vitest/Vite CommonJS-config future-compatibility warning remains; it did not affect tests or coverage. No deployment, migrations, notifications, billing mutations, or production scraping were performed. Implementation assistance: Codex; Astra identified three storage/keyboard defects, repaired in a follow-up commit for re-review.


## Repair regressions

The hook and analyst components are explicitly included in Vitest coverage. `fake-indexeddb` is a test-only dependency for transaction, migration, reset, conflict, quota, cancellation, and account-transition cases. Native browser transactions are verified separately.

With the synthetic Vite fixture running, run the committed browser regression using `playwright-core` installed outside the application workspace:

```sh
bun add --cwd /tmp/analyst-browser-tests playwright-core
ANALYST_PLAYWRIGHT_MODULE=/tmp/analyst-browser-tests/node_modules/playwright-core/index.mjs \
  node scripts/qa/analyst/regression.mjs
```

Set `CHROMIUM_PATH` if Chromium is not `/usr/bin/chromium`; set `ANALYST_QA_OUTPUT` to choose an artifact directory (default `/tmp/analyst-repair-qa`). The script blocks all non-fixture network requests. At 1280×720 and 390×844 it exercises two real tabs with native IndexedDB transactions, concurrent packet/note writes, quota-preserved unsaved captures, ordinary writes during capture/export, reset cancellation and stale-generation rejection. It presses `t`, `c`, `m`, `/`, and `f` while Close and the packet select are focused, checks that dashboard scope/URL/preferences do not change, verifies native Escape retains the active map pin, types a note with real keyboard events, checks focus containment, exports with/without notes, verifies immutable packets after a live update, and captures printable PDFs and screenshots. Dashboard shortcuts are contained by the analyst dialog without preventing native input/select behavior.

Dependency parity was repaired with a clean `bun install --frozen-lockfile`. The initial incremental install left an incompatible nested MIME dependency; the clean install restored the locked tree. Next.js now matches the manifest/lock at 16.3.7. The application manifest/lock have only the additive test dependency change.

Repair validation on 2026-09-30:

- `bun install --frozen-lockfile`: passed after a clean install; all 42 direct dependencies/dev dependencies match their locked versions, including manifest/lock/installed Next.js 16.3.7.
- `bun run typecheck`, `bun run lint`, and `bun run build`: passed.
- `bun run test:coverage`: 114 files passed, 1,066 tests passed, 1 existing TODO. Global statement/branch/function/line coverage: 84.28/75.66/87.94/87.56 percent; thresholds met. The analyst hook and components are measured, rather than excluded.
- Hook statement/branch/function/line coverage: 86.59/73.29/82.53/93.86 percent. Workspace component: 90.29/81.72/82.05/93.93 percent. Coverage is supported by native browser regressions for cross-tab transactions and exact keyboard events, plus mocked download/print resource checks.
- Committed native Chromium regression passed at desktop 1280×720 and mobile 390×844, with zero page errors, default note exclusion, explicit inclusion, immutable exports, reset cancellation, and no horizontal overflow. PDFs were generated with Chromium; native OS printing and real Supabase remain unverified.

Current screenshots: [repaired desktop](screenshots/repaired-desktop-workspace.png), [repaired mobile](screenshots/repaired-mobile-workspace.png). These show the completed unsaved capture retained after ordinary cross-tab writes.

## Storage recovery verification

An unavailable database at startup has no observed reset generation. The first successful attachment preserves selections, unsaved captures, and pending work, and migrates valid legacy data when needed. Subsequent changes to an observed generation still clear private work and cancel operations. A capture that started without an observed generation remains unsaved even if storage recovers during its detail request; **Retry saving packet** explicitly saves that copy into the current generation. It cannot be saved automatically by work from before attachment.

Successful reconciliation after a temporary read failure restores local saving without deleting data. **Retry local saving** rechecks server access and retries storage while retaining work. **Retry saving packet** also performs that recovery when necessary. Invalid data remains untouched, failed retries retain the packet, and a later real reset still rejects stale writes. The hooks do not persist a stale whole envelope on recovery.

Reproduce the controlled startup unavailability and native transaction-read failures:

```sh
ANALYST_PLAYWRIGHT_MODULE=/path/to/playwright-core/index.mjs \
  node scripts/qa/analyst/recovery.mjs
```

The fixture server above must be running. Output defaults to `/tmp/analyst-recovery-qa`. The script restores Chromium's native IndexedDB APIs after fault injection. At desktop and mobile widths, it independently verifies startup failure → unsaved capture → restore/focus, repeated read failure → restore/focus, and read failure → restore/cross-tab update. Both capture paths retain selection and the same unsaved packet at 7/8 saved, then deliberately save that packet as the eighth. It also checks a failed explicit retry, later reset/stale-generation rejection, account isolation, and default private-note exclusion. Outbound requests are blocked.

Recovery validation on 2026-09-30:

- Typecheck, lint, and production build passed with Next.js 16.3.7; all 42 direct dependency versions still match the lockfile.
- Full coverage: 114 test files, 1,072 passing tests, one existing TODO. Global statement/branch/function/line coverage: 84.36/75.86/88.16/87.63 percent. Hook coverage: 87.75/77.04/84.37/94.97 percent; workspace: 91.26/86.31/84.61/95.45 percent.
- Six added hook/UI regressions cover first attachment, same-generation recovery at 7/8, pending capture with explicit save, non-destructive UI retries and delayed legacy migration, retry authorization failure, and fresh generation creation after an externally removed record.
- Both native Chromium recovery and original transaction/keyboard/private-export regression scripts passed at 1280×720 and 390×844 with zero page errors. Real services and native OS print-dialog behavior remain unverified.

Screenshots: [desktop capture retained after recovery](screenshots/recovery-desktop-retained.png), [mobile retry while storage is unavailable](screenshots/recovery-mobile-unavailable.png). Fixtures contain only synthetic data. Codex implemented the repairs following Astra's two recovery findings.
