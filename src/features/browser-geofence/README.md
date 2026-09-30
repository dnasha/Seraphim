# Browser geofence alerts experiment

This branch starts at PR20's immutable baseline `4c693ccd78e7d0c26842488db77be3ae0ede0fd5`. It is standalone and needs no other experiment branch, database schema, migration, credentials, or deployment.

## Using the feature

Open **Watch alerts**, pan/zoom the map, name a watch, and choose **Save current viewport + filters**. Up to three watches are saved locally for the signed-in account on this device. Each captures its own viewport, sources, categories, credibility tiers, minimum report count, and search query. The time scope is always the **live last 24 hours**, independently of the current camera, historical time window, or future replay presentation. Viewports are limited to 60° in each direction; smaller regions avoid plan result limits.

Click **Enable browser notifications** to explicitly request permission. Saving or mounting never requests permission. The first complete check of every new/resumed watch records a baseline without alerts for existing events. Rename, delete, individual pause/resume, pause all, and delete local watches/history are available. **Review saved scope** shows the stored scope and last complete check without changing the map, filters, selection, or alert checkpoint.

The interface labels this **Checks while Seraphim is open**. After an immediate first baseline, visible, online sessions check at minutes 2, 17, 32 and 47, matching the dashboard’s scraper schedule. Hidden tabs, offline periods, sleep and request failures delay checks. Reconnection/visibility/focus resumes the session while respecting the shared next-check time. A gap of 24 hours or more establishes a quiet new baseline because events beyond the read horizon cannot be recovered reliably; previously observed identities remain in history. Closing Seraphim stops checks. No closed-browser Web Push, email, periodic background sync, or OS delivery guarantee is claimed.

## Correctness and privacy boundaries

- Feature-owned storage: `seraphim:experiment:browser-geofence:v1:<account>`. Schema version, watch/vertex/hole/result/ledger quotas, supported filters, dates and UUID identities are validated. The storage getter is guarded too: blocked site storage displays recovery guidance without crashing, fetching or prompting. Storage errors fail closed and have explicit deletion recovery. Earlier v1 records upgrade known membership into observed history and initialize independent retry fields. Signed-out users cannot save or enable watches; keyed account/tier transitions remove the previous account's UI and abort its work. Device data remains until explicitly deleted or browser site data is cleared; it is not account-cloud data.
- RegionSpec is `{version:1,id,name,geometry:Polygon|MultiPolygon,createdAt}` with longitude/latitude coordinates. Viewports crossing the antimeridian become two polygons. Stored geometry accepts bounded closed nondegenerate rings with validated holes; crossing edges must be split at the antimeridian. Limits: four polygons, eight holes per polygon, 128 total vertices, three watches. This experiment has no import/drawing UI and adds no map sources or layers.
- Reads go through existing entitled `/api/news`, with `scope=viewport`, `view=sidebar`, `force_raw=true`, `time_range=1d`, and at most 1000 results per request. There are at most twelve bounded requests per polling cycle for a validated four-polygon shape across three watches; UI-created viewports use at most six. Up to three watches read concurrently under a shared 45-second read deadline, followed by a separate 10-second delivery deadline. Lifecycle cancellation discards results; a read timeout records failures while preserving completed healthy snapshots in either completion order. Combined membership per watch is capped at 1000 IDs. No cursor or unbounded read is introduced. Existing detail links use the existing entitled event route through HomeContent.
- Stale, capped, clustered, wrong-scope, old-cache, invalid-identity and missing-location responses cannot advance a checkpoint or generate notifications. Membership uses individual raw coordinates, including holes, rather than cluster representatives/centroids. Canonical IDs use `canonicalNewsId()`; synthetic `cluster-z` IDs are rejected. A successful observation stores `checkedAt`; `createdAt` is the saved region time. Mutable publication times never drive alert identity or checkpoint logic.
- Account-specific Web Locks serialize checks, edits and delivery reservations across tabs. A durable shared `nextCheckAt` prevents reloads/new watches/tabs from increasing API polling frequency. Failures back off per watch on scraper slots, to a maximum of 30 minutes; healthy watches keep their own 15-minute cadence. Check scheduling is separate from the five-minute delivery cap. Unsupported coordination is disclosed and disabled rather than approximated with a racy storage lease.
- Identity deduplication spans overlapping watches, reloads and tabs. Each checkpoint separately stores current membership (up to 1000 IDs) and observed history (up to 3000 IDs). A quiet baseline ID leaving and returning cannot alert merely because its publication time changed; a genuinely unseen late arrival can alert. Full history pauses that watch rather than evicting identities. Explicit resume/enable records a fresh baseline. The combined local record is capped at 768 KB. The delivery ledger holds at most 3000 canonical IDs for 48 hours; recent entries are not evicted to fit a burst. At most one generic notification per five minutes groups up to 20 IDs and opens the first event. Additional/suppressed candidates are consumed without later backlog delivery. Reservation is persisted before delivery: this gives **at-most-once attempts**, and can intentionally lose a notification if the browser crashes or OS delivery fails. The feature does not claim exactly-once receipt.
- Payloads contain a generic title, count, generic body, tag and one safe canonical event route. They exclude region names, geometry, filters, headlines, notes and account IDs. Only a validated root `/?eventId=<UUID>` route of the service worker's origin can open/focus a client. Arbitrary paths, external URLs, query additions and fragments are rejected. Browser/OS settings can still suppress display.
- Saved watch objects/names are absent from address-bar/share URLs, analytics, synced preferences and API/runtime caches. The necessary bounded coordinates and filter values are sent only as parameters of the existing authenticated news read, using `cache: no-store`. There is no new server persistence or telemetry.
- Default, denied, insecure, unsupported, missing-worker, permission-revocation and delivery-failure states are explicit. Permission requests occur only on the enable click. Revocation/delivery unavailability pauses globally without repeated prompting or delivery retry loops. Enabling again starts fresh baselines. Actual notification delivery always uses an active same-origin service-worker registration.

## Production worker build

`bun run build` explicitly uses `next build --webpack`: the installed `@serwist/next` plugin compiles `src/app/sw.ts`, injects registration into production client entries, and writes `/sw.js`. Turbopack development remains unchanged with Serwist disabled. Generated worker assets are ignored rather than tracking a stale handwritten worker or obsolete navigation-cache helper. `/sw.js` is served with no-store/no-cache headers and root scope.

The compiled worker preserves network-only navigations and private APIs, the bounded public thumbnail exception, and the safe static precache. A final network-only rule also protects RSC, Next chunks and unclassified responses; activating the worker must not reintroduce Serwist’s default page/chunk caches. Activation clears legacy API, page, chunk and old Serwist caches while retaining this build’s static precache and public thumbnails. CSP, manifest, auth proxy and cache-on-navigation/reload-on-online settings remain intact.

Webpack’s production route validation exposed two baseline typing blockers: the Angel count route exported a test-only reset function and the portal route treated its Request as optional. The reset now uses module isolation in tests; the portal receives the real required Request. Billing behavior and assertions are preserved. No payment calls were made.

## Future delivery adapter

`DeliveryAdapter.deliver({ids}, signal)` is the transport boundary. `BrowserDeliveryAdapter` separately owns permission inspection, explicit opt-in and browser notification cleanup. `checks.ts` handles membership/checkpoints, `session.ts` handles the open-session lifecycle and reservations, and `delivery.ts` implements browser transport. No email adapter is active.

Closed-browser delivery needs a separate server-side system before it can be offered:

1. Explicit subscription opt-in and HTTPS service-worker Push API subscription, with CSRF protection, authenticated account ownership and a separate channel preference.
2. Server-only VAPID private keys in secret management, public-key distribution/rotation, and scoped encrypted subscription endpoint storage. Do not generate or commit keys for this experiment.
3. A bounded scraper-aligned authorized matcher with current entitlements, canonical event identities, independent region checkpoints, deduplication, frequency/volume quotas and minimal generic payloads.
4. Delivery receipt/failure semantics, expired endpoint cleanup (including HTTP 404/410), unsubscribe, revocation, logout/device policy, account deletion and retention cleanup. Logs must exclude private region/notes/subscription payloads.
5. Verified push-event handling and safe click routes with the existing network-only private-API/navigation cache policy preserved. Add tests and explicit user-facing capability disclosure before claiming closed-browser support.

No `user_geofences` table is activated. No live database writes, migrations, push subscriptions, credentials, real notifications, emails or charges were made in this implementation/QA.

## Verification after Astra repairs

- Dependency parity: a clean `bun install --frozen-lockfile` corrected the stale saved environment. All 41 direct dependencies match the unchanged lockfile, including Next/ESLint config **16.3.7**. The sanitizer’s nested MIME dependency now resolves the locked v5 rather than stale v4. No dependency versions or lock entries were changed.
- `bun run typecheck`, `bun run lint`, and the real `bun run build`: pass. Next.js **16.3.7 webpack** compiles `/sw.js`, checks types and generates static pages using placeholder service settings.
- Focused alert/cache/billing compatibility tests: **77 passed** across nine files, including all five review regressions. Timeout tests cover either watch ordering, a fetch ignoring AbortSignal, independent failed-watch backoff, continued healthy delivery and lifecycle cancellation. Identity tests cover disappearance/reentry across reload, unseen old-publication arrivals, quotas and earlier storage records.
- Full `bun run test:coverage`: **116 files passed; 1070 tests passed; one existing todo**. Thresholds pass: statements **83.99%**, branches **76.15%**, functions **88.40%**, lines **87.28%**. Coverage configuration/thresholds were not weakened.
- Reproducible production-artifact browser checks use native root service-worker registration in a fresh Chromium context, synthetic events dispatched into the compiled worker, malicious-click rejection, legacy cache purge, no-store worker headers, private API/RSC/chunk offline failures despite seeded old caches, and retained public thumbnail caching. No actual notification is sent by the worker check.
- Dashboard browser QA uses the actual served production UI at **1440×1000** and **390×844**, native worker registration, fixture auth/news and mocked `showNotification`. The script checks zero mount prompts, one explicit opt-in, a quiet first baseline, two overlapping watches, old identity reentry suppression, unseen arrival delivery, no overflow and no page errors. The launcher is positioned beside map actions and layered above map controls, below consent/auth overlays.
- An incremental frozen install initially left a stale nested dependency and failed two unrelated scraper test files. A clean frozen install corrected it; all 33 affected tests and then full coverage passed. The pre-existing Vite native-loader compatibility warning remains nonblocking.

Run the fixture without external services:

```sh
bun x vite --config scripts/fixtures/browser-geofence/vite.config.mts
# open http://127.0.0.1:4173/
bun x vitest run scripts/tests/browser-geofence-*.test* scripts/tests/service-worker-cache.test.ts
```

For the production check, build/start using placeholder service values as in `vitest.config.ts`, then run:

```sh
# Playwright is QA tooling, not a production dependency. Supply an installed module and browser.
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs CHROMIUM_PATH=/path/to/chromium \
  SERAPHIM_QA_BASE_URL=http://127.0.0.1:4175 \
  node scripts/fixtures/browser-geofence/verify-production.mjs
```

The script only accepts loopback targets. Service responses and OS delivery are mocked; synthetic auth data is never sent to a server. Real OS receipt and physical iOS/Safari/Firefox remain unverified. Closed-browser push/email remain inactive. Re-review is pending; this report records implementation verification, not an Astra approval.

Screenshots: [production desktop](../../../scripts/fixtures/browser-geofence/screenshots/production-1440.png), [production mobile](../../../scripts/fixtures/browser-geofence/screenshots/production-390.png). Earlier fixture captures remain alongside these artifacts.

## Integration hotspots

- `src/components/layout/HomeContent.tsx`: one dynamic import and the keyed panel with the current viewport/filter capture props. Preserve account/tier keys when combining with replay/region features; pass live camera bounds, not transformed replay results.
- `package.json` / `next.config.ts`: preserve the webpack production build and worker headers. Worker assets are generated/ignored. Do not substitute a Turbopack build without supported worker compilation and registration.
- `src/app/sw.ts`: notifications exclusively owns the additive click listener. Keep cache ordering and activation cleanup intact; this is the sole experiment allowed to edit the worker.
- `src/lib/pwa/notificationRoutes.ts`: generic event routing validation shared by browser transport and worker. Keep RegionSpec private and pass canonical UUID event identities.
- `src/features/browser-geofence/region.ts`: feature-local RegionSpec validator. It deliberately introduces no foundational dependency for other branches. A later merger can consolidate the identical shared shape while retaining geometry bounds and antimeridian semantics.
- `scripts/tests/mobile-views.test.tsx`: the WebGL dynamic mock now matches NewsMap explicitly instead of treating every dynamic import as a map. `vitest.config.ts` adds feature coverage.

Implementation and repairs used Codex. Astra reviewed the previous fixed head and identified the five repaired findings; independent Astra re-review of the repaired head is pending in the parent task.
