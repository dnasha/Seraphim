# Drawing history fixture and browser verification

This fixture renders the actual drawing tools with real TerraDraw and MapLibre, a blank local map style, and synthetic accounts. It needs no database, map provider, credentials, or real user data. The browser script blocks requests outside the fixture origin.

Start the fixture from the repository root:

```sh
bun run scripts/build/prepare-map-worker.mjs
bun x vite --config scripts/qa/drawing-history/vite.config.ts
```

Install browser tooling outside the repository and run desktop/mobile checks (requires Chromium):

```sh
npm install --prefix /tmp/seraphim-drawing-qa --cache /tmp/seraphim-npm-cache @playwright/test
DRAWING_QA_PACKAGE_ROOT=/tmp/seraphim-drawing-qa CHROMIUM_PATH=/usr/bin/chromium \
  node scripts/qa/drawing-history/verify.mjs
```

`DRAWING_QA_URL` overrides `http://127.0.0.1:4175`; `DRAWING_QA_ARTIFACTS` overrides the ignored `artifacts/drawing-history` screenshot directory.

The ten browser scenarios check drawing and editing polygons/vertices/midpoints, rectangle/circle/ruler/freehand, shape and text movement, retained styles and fresh duplicate IDs, delete/clear/import reversibility, atomic rejection, the existing GeoJSON export representation, keyboard focus/native text undo, style reload, account switching, collapsed mobile controls, and real touch gestures. The interrupted regressions additionally cover eraser release over the toolbar/cancel/blur/lost capture, recovery mid-drag followed by navigation, twenty repeated undo/redo cycles, one-operation text creation and empty cancellation, protected malformed/engine-rejected saves and explicit recovery, quota errors while collapsed/closed, touch/reduced-motion computed styles, and pointer ownership against a rendered story layer. Failures produce a screenshot and document/control diagnostics. Browser runtime/console errors fail verification.

Focused unit and actual TerraDraw lifecycle tests:

```sh
bun x vitest run scripts/tests/drawing*.test.* scripts/tests/draw-import-validation.test.ts
```

Saved documents use `seraphim-experiment-drawing-history-v2:<encoded account ID>`, preserve the shape/text representation, validate schema/coordinates/IDs/styles, and are capped at 1,000 features, 50,000 shape vertices, and 2 MB. History stays in memory (50 operations / 8 MB), includes text and shapes together, and resets when the account changes or its saved document is deleted in another tab. A new edit after undo discards redo.

The previous device-wide `seraphim-map-draw-tools-v1` key is left intact. Signed-in users may explicitly import a copy through **Import device drawings**; it is never silently assigned to an account. Guests edit only in the current session. Shape/text selection and map camera/style changes are not history operations. History clears selection on restoration; the chosen drawing mode and map view remain active.

If saved drawings cannot be parsed or restored by TerraDraw, the saved bytes are protected from automatic writes and deletion. A persistent notice allows downloading the original application document or explicitly replacing it with the current drawings. Other device save failures remain visible with the panel collapsed or closed. A style/map recovery cancels an unfinished shape gesture to its before-state; it preserves completed history and persistence. Eraser release/cancel/blur completes one transaction and stops hover deletion. New text and its initial typing commit together; abandoning empty new text adds no history.

`MapDrawTools` exposes optional `onInteractionOwnershipChange(ownsMapPointer: boolean)`. It reports ownership for every active non-static tool while the map is ready and the panel is open, including click placement and selection. Annotation pointer streams also claim ownership while tools are closed, through the completed click. Close, unmount, account switch, and map recovery clear ownership; window blur clears it until focus/new input restores it. `NewsMap` keeps the signal in a ref and guards story/cluster picking, including a cluster lookup that finishes after drawing starts. The fixture uses the same ref contract and a synthetic rendered story layer.
