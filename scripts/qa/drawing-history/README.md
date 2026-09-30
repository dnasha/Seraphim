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

The browser checks drawing and editing polygons/vertices/midpoints, rectangle/circle/ruler/freehand, shape and text movement, retained styles and fresh duplicate IDs, delete/clear/import reversibility, atomic rejection, the existing GeoJSON export representation, keyboard focus/native text undo, style reload, account switching, collapsed mobile controls, and real touch gestures. Failures produce a screenshot and document/control diagnostics. Browser runtime/console errors fail verification.

Focused unit and actual TerraDraw lifecycle tests:

```sh
bun x vitest run scripts/tests/drawing*.test.* scripts/tests/draw-import-validation.test.ts
```

Saved documents use `seraphim-experiment-drawing-history-v2:<encoded account ID>`, preserve the shape/text representation, validate schema/coordinates/IDs/styles, and are capped at 1,000 features, 50,000 shape vertices, and 2 MB. History stays in memory (50 operations / 8 MB), includes text and shapes together, and resets when the account changes or its saved document is deleted in another tab. A new edit after undo discards redo.

The previous device-wide `seraphim-map-draw-tools-v1` key is left intact. Signed-in users may explicitly import a copy through **Import device drawings**; it is never silently assigned to an account. Guests edit only in the current session. Shape/text selection and map camera/style changes are not history operations. History clears selection on restoration; the chosen drawing mode and map view remain active.
