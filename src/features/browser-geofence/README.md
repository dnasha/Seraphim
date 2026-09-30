# Browser geofence alerts experiment

This branch starts at PR20's immutable baseline `4c693ccd78e7d0c26842488db77be3ae0ede0fd5`. It is standalone and needs no other experiment branch, database schema, migration, credentials, or deployment.

## Using the feature

Open **Watch alerts**, pan/zoom the map, name a watch, and choose **Save current viewport + filters**. Up to three watches are saved locally for the signed-in account on this device. Each captures its own viewport, sources, categories, credibility tiers, minimum report count, and search query. The time scope is always the **live last 24 hours**, independently of the current camera, historical time window, or future replay presentation. Viewports are limited to 60° in each direction; smaller regions avoid plan result limits.

Click **Enable browser notifications** to explicitly request permission. Saving or mounting never requests permission. The first complete check of every new/resumed watch records a baseline without alerts for existing events. Rename, delete, individual pause/resume, pause all, and delete local watches/history are available. **Review saved scope** shows the stored scope and last complete check without changing the map, filters, selection, or alert checkpoint.

The interface labels this **Checks while Seraphim is open**. Visible, online sessions check roughly every five minutes. Hidden tabs, offline periods, sleep and request failures delay checks. Reconnection/visibility/focus resumes the session while respecting the shared next-check time. A gap of 24 hours or more establishes a quiet new baseline because events beyond the read horizon cannot be recovered reliably. Closing Seraphim stops checks. No closed-browser Web Push, email, periodic background sync, or OS delivery guarantee is claimed.

## Correctness and privacy boundaries

- Feature-owned storage: `seraphim:experiment:browser-geofence:v1:<account>`. Schema version, watch/vertex/hole/result/ledger quotas, supported filters, dates and UUID identities are validated. Storage errors fail closed and have explicit deletion recovery. Signed-out users cannot save or enable watches; keyed account/tier transitions remove the previous account's UI and abort its work. Device data remains until explicitly deleted or browser site data is cleared; it is not account-cloud data.
- RegionSpec is `{version:1,id,name,geometry:Polygon|MultiPolygon,createdAt}` with longitude/latitude coordinates. Viewports crossing the antimeridian become two polygons. Stored geometry accepts bounded closed nondegenerate rings with validated holes; crossing edges must be split at the antimeridian. Limits: four polygons, eight holes per polygon, 128 total vertices, three watches. This experiment has no import/drawing UI and adds no map sources or layers.
- Reads go through existing entitled `/api/news`, with `scope=viewport`, `view=sidebar`, `force_raw=true`, `time_range=1d`, and at most 1000 results per request. There are at most twelve bounded requests per polling cycle for a validated four-polygon shape across three watches; UI-created viewports use at most six. A 45-second cycle deadline cancels work. Combined membership per watch is capped at 1000 IDs. No cursor or unbounded read is introduced. Existing detail links use the existing entitled event route through HomeContent.
- Stale, capped, clustered, wrong-scope, old-cache, invalid-identity and missing-location responses cannot advance a checkpoint or generate notifications. Membership uses individual raw coordinates, including holes, rather than cluster representatives/centroids. Canonical IDs use `canonicalNewsId()`; synthetic `cluster-z` IDs are rejected. A successful observation stores `checkedAt`; `createdAt` is the saved region time. Mutable publication times never drive alert identity or checkpoint logic.
- Account-specific Web Locks serialize checks, edits and delivery reservations across tabs. A durable shared `nextCheckAt` prevents reloads/new watches/tabs from increasing API polling frequency. Failures back off to a maximum of 30 minutes. Unsupported coordination is disclosed and disabled rather than approximated with a racy storage lease.
- Identity deduplication spans overlapping watches, reloads and tabs. The delivery ledger holds at most 3000 canonical IDs for 48 hours; recent entries are not evicted to fit a burst. At most one generic notification per five minutes groups up to 20 IDs and opens the first event. Additional/suppressed candidates are consumed without later backlog delivery. Reservation is persisted before delivery: this gives **at-most-once attempts**, and can intentionally lose a notification if the browser crashes or OS delivery fails. The feature does not claim exactly-once receipt.
- Payloads contain a generic title, count, generic body, tag and one safe canonical event route. They exclude region names, geometry, filters, headlines, notes and account IDs. Only a validated root `/?eventId=<UUID>` route of the service worker's origin can open/focus a client. Arbitrary paths, external URLs, query additions and fragments are rejected. Browser/OS settings can still suppress display.
- Saved watch objects/names are absent from address-bar/share URLs, analytics, synced preferences and API/runtime caches. The necessary bounded coordinates and filter values are sent only as parameters of the existing authenticated news read, using `cache: no-store`. There is no new server persistence or telemetry.
- Default, denied, insecure, unsupported, missing-worker, permission-revocation and delivery-failure states are explicit. Permission requests occur only on the enable click. Revocation/delivery unavailability pauses globally without repeated prompting or delivery retry loops. Enabling again starts fresh baselines. Actual notification delivery always uses an active same-origin service-worker registration.

## Future delivery adapter

`DeliveryAdapter.deliver({ids}, signal)` is the transport boundary. `BrowserDeliveryAdapter` separately owns permission inspection, explicit opt-in and browser notification cleanup. `checks.ts` handles membership/checkpoints, `session.ts` handles the open-session lifecycle and reservations, and `delivery.ts` implements browser transport. No email adapter is active.

Closed-browser delivery needs a separate server-side system before it can be offered:

1. Explicit subscription opt-in and HTTPS service-worker Push API subscription, with CSRF protection, authenticated account ownership and a separate channel preference.
2. Server-only VAPID private keys in secret management, public-key distribution/rotation, and scoped encrypted subscription endpoint storage. Do not generate or commit keys for this experiment.
3. A bounded scraper-aligned authorized matcher with current entitlements, canonical event identities, independent region checkpoints, deduplication, frequency/volume quotas and minimal generic payloads.
4. Delivery receipt/failure semantics, expired endpoint cleanup (including HTTP 404/410), unsubscribe, revocation, logout/device policy, account deletion and retention cleanup. Logs must exclude private region/notes/subscription payloads.
5. Verified push-event handling and safe click routes with the existing network-only private-API/navigation cache policy preserved. Add tests and explicit user-facing capability disclosure before claiming closed-browser support.

No `user_geofences` table is activated. No live database writes, migrations, push subscriptions, credentials, real notifications, emails or charges were made in this implementation/QA.

## Verification

- `bun run typecheck` and `bun run lint`: pass.
- Focused feature and existing service-worker cache tests: **56 passed** across six files.
- Full `bun run test:coverage`: **115 files passed; 1059 tests passed; one existing todo**. Thresholds pass: statements **84.00%**, branches **76.07%**, functions **88.34%**, lines **87.23%**. Feature directory: statements **88.33%**, branches **81.46%**, functions **90.74%**, lines **95.15%**.
- `bun run build`: pass using placeholder service settings; no compatible live database is assumed. Next.js 16.3.5 production compilation, TypeScript and static generation succeed.
- Browser fixture QA: system Chromium 151 at **1440×1000** and **390×844**. Checked zero prompts on mount/save, one explicit permission prompt, zero baseline alerts, one delivery attempt across two overlapping watches and two tabs, checkpoint preservation on review/rename, account-switch private-UI clearing, signed-out restrictions and no horizontal overflow/page errors. Notification/service calls are mocks; real OS notifications and physical iOS/Safari/Firefox were not exercised.
- Existing private API caching tests and direct service-worker import tests pass: network-only navigations/private APIs and legacy API cache cleanup are preserved; no push-event listener is activated.
- Initial verification caught missing tooltips, the broad mobile-test dynamic import mock, and an incompatible Vite fixture option; these were corrected. The pre-existing Vite warning about native config-loader compatibility remains nonblocking. Browser downloads were restricted; installed system Chromium completed QA.

Reproduce the fixture without credentials or external services:

```sh
bun x vite --config scripts/fixtures/browser-geofence/vite.config.mts
# open http://127.0.0.1:4173/ with agent-browser or another browser
bun x vitest run scripts/tests/browser-geofence-*.test* scripts/tests/service-worker-cache.test.ts
```

Fixture controls are available as `window.geofenceFixture` for changing rows, clock, metadata and account. Permission and service-worker calls are mocked; actual Web Locks coordinate fixture tabs. The fixture is not a Next.js route and is not shipped as a public application page.

Screenshots: [desktop before](../../../scripts/fixtures/browser-geofence/screenshots/desktop-before.png), [desktop after](../../../scripts/fixtures/browser-geofence/screenshots/desktop-after.png), [mobile after](../../../scripts/fixtures/browser-geofence/screenshots/mobile-after.png).

## Integration hotspots

- `src/components/layout/HomeContent.tsx`: one dynamic import and the keyed panel with the current viewport/filter capture props. Preserve account/tier keys when combining with replay/region features; pass live camera bounds, not transformed replay results.
- `src/app/sw.ts`: notifications exclusively owns the additive click listener. Keep cache ordering and activation cleanup intact; this is the sole experiment allowed to edit the worker.
- `src/lib/pwa/notificationRoutes.ts`: generic event routing validation shared by browser transport and worker. Keep RegionSpec private and pass canonical UUID event identities.
- `src/features/browser-geofence/region.ts`: feature-local RegionSpec validator. It deliberately introduces no foundational dependency for other branches. A later merger can consolidate the identical shared shape while retaining geometry bounds and antimeridian semantics.
- `scripts/tests/mobile-views.test.tsx`: the WebGL dynamic mock now matches NewsMap explicitly instead of treating every dynamic import as a map. `vitest.config.ts` adds feature coverage.

Implementation and fixture-based verification used Codex. Independent Astra review is pending in the parent task; this report does not represent that review.
