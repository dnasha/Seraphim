# Analyst evidence workspace experiment

Independent of the replay, heatmap, region, drawing, and notification experiments. Based on PR20 (`4c693ccd78e7d0c26842488db77be3ae0ede0fd5`). No database changes or new external services are required.

## Use

Analyst and Angel accounts see **Add to evidence** below story cards. This selection is separate from the active map pin and is not written to URLs or synced preferences. The **Evidence workspace** button in the sidebar opens a keyboard-accessible modal. On mobile, use the Stories tab to open it; an active map event can be added inside the workspace.

Aggregate rows explicitly select their individual representative, not every cluster member. Selection uses `canonicalNewsId()` and rejects unresolved synthetic cluster IDs. It deduplicates a raw event and its aggregate representative.

Choose up to 20 events, optionally write private local notes, and capture. Capture makes fresh client requests to the existing exact-ID detail route, with three concurrent requests and 15-second request timeouts. Each detail response is bounded to 512 KB; at most 200 returned source records are copied per event, with a visible truncation marker. Individual HTTP, identity, size, parse, and timeout failures remain visible in a partial packet. Account changes, cancellation, and entitlement failures discard pending work. Captures are copied by an allowlist and recursively frozen. Later merges, feed updates, selections, and notes cannot change a packet.

Capture does not query historical listings or enumerate cluster members. The existing exact-ID route allows a deliberately selected known event outside a list window. Existing rate limits, source authorization, and timeline restrictions remain in force. No additional sources are inferred or fetched from publishers.

## Access and privacy

The additive `evidenceExport` entitlement is available only to Analyst and Angel. `/api/analyst/access` verifies the current server session and effective tier, returning only user ID and tier with private/no-store headers. The workspace verifies identity on initialization and focus, before capture, after capture, and before every export. `/api/news/[id]?evidence=true` enforces the same entitlement in addition to the existing detail behavior. Ordinary detail requests retain their current gates. A transient authorization failure fails closed. Account/tier/loading transitions synchronously hide private UI, abort outstanding work, and remove temporary print frames.

Packets and notes use `seraphim:experiment:analyst-evidence:v1:<encoded-account-id>` in local storage. The versioned envelope validates the account owner, canonical IDs, fields, source counts, and packet structure on every read/write. Limits: 8 saved packets, 2 MB estimated UTF-16 storage per account, 100 notes, 2,000 characters per note. Quotas never silently evict packets. A completed capture remains available for download if saving fails. Invalid stored data cannot be overwritten until explicitly deleted. Cross-tab deletion clears private UI and cancels pending work. Deletion is available to the signed-in owner after a downgrade, too.

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

Focused tests: `scripts/tests/analyst-evidence.test.ts`, `analyst-workspace.test.tsx`, `analyst-access-route.test.ts`, plus the evidence-gate cases in `news-detail-route.test.ts`. Existing mobile selection tests remain intact.

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

The fixture's synthetic PDF contained both selected events and the partial capture error, without private notes. Real Supabase/customer data and native OS print-dialog/device behavior were not exercised. The existing Vitest/Vite CommonJS-config future-compatibility warning remains; it did not affect tests or coverage. No deployment, migrations, notifications, billing mutations, or production scraping were performed. Implementation assistance: Codex; separate Astra verification is still pending.
