# Region checkpoints experiment

Branch: `experiment/region-checkpoints`, based on immutable PR20 commit
`4c693ccd78e7d0c26842488db77be3ae0ede0fd5`.

Signed-in users open **Region checkpoints** on the map, name and save the current
viewport and entitled filter snapshot, then select the saved region. **Check
changes** reads that fixed scope independently of the moving camera/current
filters. The first successful fresh check creates a baseline, without reporting
all existing events as new. Subsequent checks show newly observed events,
source/report additions, and observable title or location corrections. **Mark
reviewed** commits exactly the displayed observation, without fetching again.
Lean feed rows are resolved through bounded exact-event detail requests. When
identities remain unseen, a source-count increase is labelled uncertain instead
of silently reporting no change. Plan/coverage changes require **Establish
compatible baseline** after a successful compatible check.
Rename, delete, reset saved scope, replace with current filters, and clear account
storage are available. Keyboard access, Escape, and mobile scrolling are supported.

## Boundaries and limitations

- Client-only, versioned account storage: eight regions, two MiB total per account,
  4,000 retained event identities and 20,000 report keys per region. Quota,
  corruption, write-denial and other-tab deletion are surfaced; failed writes
  never claim a saved review. Account/tier changes clear private UI and cancel work.
- `RegionSpec` version 1 uses lon/lat GeoJSON Polygon/MultiPolygon. Geometry is
  validated with at most 512 vertices, eight polygons and sixteen rings per
  polygon. Holes, boundaries and antimeridian splitting are supported. The UI
  captures rectangular viewports; it does not import drawing-tool annotations.
- At most sixteen sequential `/api/news` reads per check; each requests entitled,
  raw, viewport data and a tier-bounded limit. A 30-second deadline cancels the
  whole check, including at most 24 exact detail requests with three concurrent
  requests. Count increases get priority within that budget; remaining work
  rotates through the oldest or never-resolved timelines across reviews. Detail
  IDs must have
  appeared inside the saved geometry in the entitled raw feed; detail resolution
  cannot add events or replace positions/titles with moved or merged detail rows.
  Polygon membership is evaluated on raw positions; representatives
  with multiple events and unverifiable response coverage are rejected.
- Only bounding boxes and the saved news filters use the existing feed request
  transport. Region names, complete geometry, holes, local IDs, and baselines
  never enter page/share URLs, analytics, cloud preferences, or a client cache.
  Exact public event UUIDs use the existing entitled `/api/news/[id]?refresh=true`
  route. There are no DB writes, migrations, geofence writes, detail-route changes,
  notification dispatches, or service-worker edits.
- The feed can reuse its existing bounded server cache. `capturedAt` records the
  oldest feed capture across split reads; `checkedAt` records this check's end.
  Fresh means the endpoint has not flagged stale fallback; it does not imply a
  transactionally consistent, uncached, complete census.
  Each split read and event retains capture metadata. Captures older than the
  reviewed boundary are rejected, including a regressed split hidden by a newer
  aggregate minimum and an older overlapping event observation. Detail reads
  request a fresh capture; known report identities are never removed.
- `canonicalNewsId` and `reportIdentityKey` drive observation comparisons.
  Publication/discovery dates, ordering, publisher-name changes, and tracking URL
  noise do not define newness. Title and location differences are observations,
  not verification of a factual correction. Full descriptions are not retained.
  Equivalent ±180 longitude aliases are normalized; comparisons use circular
  distance across the antimeridian. Fully resolved report counts use canonical
  identities so tracking aliases do not become count-only source alerts.
- Missing/aged-out events are not removals. Known identities and report keys are
  retained through capped and complete reads, until explicit reset/deletion or
  quota exhaustion. Capped and plan-limited source coverage are disclosed.
- Stale/error/unverifiable reads cannot advance a baseline. Detail failures or
  inconsistent detail responses disable review. Budget-limited or plan-limited
  source observations disclose incomplete coverage and retain known fingerprints.
  An unexpected server event limit or timeline restriction invalidates baseline
  compatibility, with that flag retained across reloads. Tier changes and legacy
  observations also require explicit rebaseline after a fresh compatible check.
  The old baseline remains historical data until reset; it is not used for change
  comparisons while compatibility is unresolved. Unavailable saved filters require
  explicit
  replacement/reset. Normal current-filter/camera changes leave saved scope alone.
- Merge lineage is unavailable. Shared-report identity changes are labelled
  uncertain; a newly observed canonical ID can also represent an unknown merge.
  Events moved outside the queried region cannot be assessed by this bounded read.

## Integration points

`HomeContent` provides the account/tier key, current viewport/filter snapshot, and
account-tagged preview geometry. `NewsMap` adds one optional `checkpointRegion`
prop and invokes the feature-owned map hook. Source/layers use
`experiment-region-checkpoints-*`, reinstall on style changes/idle and clean up
on close, account change, or unmount. Other experiments may touch these two files;
keep their hooks/props additive. Drawing internals, notification dedup, replay,
heatmap data and analyst serializers are independent.

## Verification

```sh
bun run typecheck
bun run lint
bun x vitest run scripts/tests/region-checkpoints.test.ts scripts/tests/region-checkpoints-ui.test.tsx
bun x vitest run scripts/tests/region-checkpoints-resolution.test.ts
bun run test:coverage
bun run build
```

The repeatable browser QA in `scripts/qa/region-checkpoints.browser.mjs` exercises
the real app at 1440×1000 and 390×844. It intercepts every auth, news, preference,
and map-provider request with synthetic responses; it permits only the local app
assets to reach the dev server. Start Next with `supabase.invalid` placeholder
configuration. Install Playwright outside the repository and run:

```sh
QA_PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs \
QA_CHROMIUM_PATH=/usr/bin/chromium \
node scripts/qa/region-checkpoints.browser.mjs
```

Screenshots are written to ignored `artifacts/region-checkpoints`. The browser QA
covers capture, fixed geometry after zoom, first baseline, late old-published
arrival, displayed-review boundary, sources/corrections, stale/503 refusal,
lean-feed detail additions, detail error refusal and source-count uncertainty,
server/client limit drift, older captures, explicit compatible rebaseline, ±180
alias stability in a saved crossing viewport,
reload, rename/delete, responsive bounds, keyboard dismissal, and absence of
private region data in page URLs/cloud preference writes. Unit/UI tests cover
account switches, local-storage recovery, geometry holes/antimeridian, identity
transitions and source reorder/tracking noise. Live database/provider behavior
has not been exercised.

Before final repair validation, `bun install --frozen-lockfile` restored the
installed Next.js version to the lockfile's 16.3.7. A forced frozen reinstall also
restored a missing nested MIMEType 5 dependency required by jsdom 30. All 745
installed lockfile entries matched their locked versions after reinstall (with
the equivalent `v` prefix normalized). Neither manifest nor lockfile changed.
Typecheck, lint, build and full coverage passed: 1,059 tests plus one existing
todo; global coverage was 83.80% statements, 76.60% branches, 88.77% functions and
86.83% lines. Desktop/mobile mocked browser QA passed with zero page errors.
