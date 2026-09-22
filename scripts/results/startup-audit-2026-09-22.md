# Initial load investigation — September 22, 2026

## Measurements

Read-only HTTP samples from this workstation against https://www.seraphi.me:

| Resource | Observed duration |
| --- | ---: |
| Home HTML | 263–455 ms |
| Guest news feed | 141–614 ms |
| One base-map vector tile | 2,249 ms |

The live HTML referenced 13 initial JavaScript files totaling 1,095,312 bytes **after decompression**, before dynamic map/drawing imports and map workers. These samples do not measure browser parsing, WebGL initialization, or a complete cold navigation. The reported ten-second experience was not independently reproduced with a controlled production browser trace.

## Changes

- Publish the actual initial viewport as soon as the MapLibre instance exists. Previously news waited for style/layer readiness plus a 150 ms debounce, or a 1,200 ms fallback. News and map resources can now load concurrently; the fallback still serves visitors whose map cannot initialize.
- Skip the redundant initial `setStyle(..., { diff: false })`, which rebuilt the style just supplied to the constructor. Actual style and clustering changes still rebuild as before.
- Always deliver arriving news to the map source, including during resize. Previously the resize guard could discard an update without scheduling a replacement.
- Load drawing tools on first use, retaining them after closing and restoring them automatically when saved annotations exist. The current drawing bundle is approximately 234 KB of decoded JavaScript. Load the authentication modal only when it is open.
- Share timestamps through a small utility instead of importing the map configuration from sidebar cards.
- Start connections to tile/glyph hosts from the initial HTML.
- Render a unified loading screen in the server fallback and hydrated app. Keep the dashboard mounted at its final dimensions but hidden and inert. Reveal it after session/preferences, stories, and a rendered map frame with its current news source are ready.
- Advance the progress bar through completed startup milestones, with no artificial minimum delay. Errors reveal existing retry controls; slow connections offer available content after eight seconds, and Escape also dismisses the screen. Later panning and refreshes do not cover the dashboard again. The native loading dialog keeps cookie controls and other root UI from receiving focus behind the screen.

## Verification

- Production build, TypeScript, and targeted ESLint checks passed.
- 63 focused tests passed, covering readiness, error recovery, request deduplication, auth cache isolation, shared-event selection, and modal/upgrade flows.
- Browser checks confirmed the loading screen at desktop and 390 × 844 mobile sizes, and a complete basemap with visible news rows after reveal.
- An intentionally five-second-delayed news response kept both surfaces covered until ready (6.27 seconds total in that preview).
- A normal local production preview reached readiness in 0.86 seconds with previously cached resources. **This is not a production cold-load benchmark or a measured before/after speedup.**

Local production previews required a loopback reverse proxy: the API expects the hosting edge's client-IP header, and the tile host restricts browser origins. The preview proxy supplies the real loopback client address and proxies public tiles; production authentication and tile configuration were not changed.

## Follow-up measurement

Run `node scripts/diagnostics/audit-startup.mjs` for repeatable HTTP samples. Once deployed, record guest and signed-in cold loads on desktop and mobile with cache disabled. In browser DevTools, `performance.getEntriesByName('seraphim:startup')` reports navigation-to-ready duration, and `seraphim:ready` marks the reveal point. These measurements stay in the browser and do not send telemetry.

If cold loads remain slow, inspect the tile worker's edge-cache misses and upstream range requests, followed by glyph/sprite request timing and authenticated session/profile/preferences sequencing. The sampled tile already advertised a one-year immutable cache lifetime, so simply increasing that header would not address a slow cache miss. Signed-in startup still waits for verified authentication and entitlements; it needs its own timing trace before changing that contract.

Changes are local and have not been deployed.
