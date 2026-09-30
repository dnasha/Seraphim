# Combined six experiment: testing guide

Branch: `experiment/combined-six`. This is the seventh testing branch, built from immutable baseline `4c693ccd78e7d0c26842488db77be3ae0ede0fd5`. All six approved feature histories are preserved. The first combined Astra review blocked the short landscape layout; its repair is implemented and awaiting independent re-review. This branch has no production deployment.

## Where to start

Open the dashboard. On compact screens, **Map** contains map tools and replay controls; **Stories** contains story selection and the evidence workspace. Switching tabs keeps replay mounted. Close a floating panel or story popup when you need the canvas or another launcher underneath it. At short landscape heights, region checkpoints, watch alerts, map settings, environmental overlays, drawing tools and expanded heatmap information use scrollable sheets above the Map/Stories navigation. They can temporarily cover replay controls; closing them reveals the same frozen frame. Collapse drawing tools to leave the canvas available for the active tool. Zoom and map actions use separate horizontal rows. This behavior is verified from 480×320 through 920×412; other device/browser combinations remain unverified.

| Experiment | Entry point | Access | What to try |
| --- | --- | --- | --- |
| Reporting replay | Bottom panel → **Freeze loaded view** | Pro, Analyst, Angel; custom dates need Analyst/Angel | Scrub or play the loaded snapshot; compare A/B reporting windows; **Return live**. Reduced motion uses manual controls. |
| Activity heatmap | **Map settings** → **Activity heatmap** | All tiers | Toggle density, inspect a small dot, change style, and reset the account/guest device choice. |
| Drawing history | **Draw & Measure** | Signed-in Free and above; GeoJSON import/export need Analyst/Angel | Draw a pin/shape/text, Undo/Redo, duplicate, import a file, export, and clear. The active tool owns canvas gestures. |
| Region checkpoints | **Region checkpoints** | Signed-in accounts, within current entitlements | Name and **Save viewport**, select it, **Check changes**, then **Mark reviewed**. Saved filters and geometry remain fixed when you pan. |
| Browser watch alerts | **Watch alerts** | Signed-in accounts; supported secure browser with Web Locks and an active worker | Save a viewport/filter watch. Permission is requested only by **Enable browser notifications**. The first check is a quiet baseline. |
| Analyst evidence | **Add to evidence** on a story, then **Evidence workspace** | Analyst/Angel, verified again by the server | Select up to 20 canonical events, capture, inspect partial errors, and export JSON/CSV/HTML or print. Private notes require explicit export inclusion. |

## Combined checks

1. Turn on heatmap, freeze replay, and scrub to an empty or earlier frame. Density follows the displayed frame. Late live updates must not replace its locations, weights, cap disclosure, or camera. A selected event outside the frame can remain in the sidebar; it contributes no normal marker or density.
2. While replay is empty, check a saved region and an enabled watch. Both read independent live, unclustered scopes. Region **Mark reviewed** commits the displayed result; it does not fetch again or change the alert delivery checkpoint. **Review saved scope** in alerts does not mark a region reviewed.
3. Return to a populated replay frame. Use Pin over an actual story dot with heatmap on, then off. A vertex must not select a story or fly the map. Undo/Redo must restore the same document. Close drawing tools to resume story picking.
4. Select an event during replay and capture evidence while playback or live data changes. The packet records the frozen replay window and current exact detail observations. Change the cursor and export again: the packet remains unchanged. Notes are excluded until explicitly checked. Escape closes the dialog without clearing the selected event; dashboard shortcuts remain isolated while it is open.
5. Change style, switch Map/Stories, and try keyboard controls. Close the current sheet/popup before switching tools; each launcher and its controls should then be reachable. Try 568×320 specifically: freeze replay, save/check a region, and close the sheet without returning live. Change account or downgrade: private work and pending requests must stop immediately; replay must clear when access is lost, and account-specific saved records must remain isolated.
6. In the synthetic fixture, try storage denial/corruption and malformed imports. Evidence recovery retains completed packets. Drawing protects unreadable saved data until explicit replacement, and legacy device drawings require explicit account import. Failed imports are atomic; quota failures must remain visible even with drawing tools closed.

## Limits to keep in mind

Replay reconstructs reporting timestamps from the loaded view, not historical event state or a complete archive. Grouped dots represent their canonical individual, not every cluster member. Heatmap shows relative reporting activity, not danger. Selected detail hydration and evidence capture can return current server-authorized details, including an event outside the displayed window; the export states this temporal caveat.

Region checks are bounded observations, not a complete census or proof of a factual correction. Missing events are not removals. Capped, stale, incompatible, or failed results cannot silently advance review. Drawing annotations are separate from saved checkpoint/watch geometry.

Alerts run only in an open, visible, online session, on UTC minutes **2, 17, 32, 47**. They use quiet baselines and bounded history across overlapping watches. Delivery is an at-most-once attempt; OS/browser settings can suppress it. There is no closed-browser push or email. Automated QA intercepts permission/display and sends no real notifications.

Local limits: drawing documents 1,000 features / 2 MB, in-memory history 50 operations / 8 MB; eight checkpoint regions / 2 MiB; three alert watches with bounded memberships/history; evidence eight packets / 2 MB per account, 100 notes of 2,000 characters. Storage is device/account scoped and unencrypted. Downloads and prints are separate copies.

## Safe local QA and evidence

Install with `bun install --frozen-lockfile`, then run `node scripts/diagnostics/combined-dependency-parity.mjs`. The package build remains `next build --webpack` so Serwist compiles and registers the real worker. Coverage thresholds are unchanged.

For an isolated synthetic dashboard, run:

```sh
node scripts/diagnostics/combined-browser-server.mjs
# Open http://127.0.0.1:4176/?lat=32.5&lng=14&zoom=4&t=1d&s=new
```

Use a Playwright module installed outside the application checkout and an installed Chromium:

```sh
PLAYWRIGHT_MODULE_PATH=/path/to/playwright/index.mjs CHROMIUM_PATH=/path/to/chromium \
  node scripts/diagnostics/test-combined-browser.mjs
PLAYWRIGHT_MODULE_PATH=/path/to/playwright/index.mjs CHROMIUM_PATH=/path/to/chromium \
  node scripts/diagnostics/test-combined-storage.mjs
```

The fixture uses real HomeContent, MapLibre, Terra Draw and native IndexedDB with synthetic auth/feed/provider boundaries. Nothing installs a fixture application route. The compiled-dashboard, six-viewport compact regression and worker checks are described in [QA evidence](QA.md). [Screenshots](evidence/) contain only original synthetic data.

Physical devices, hardware GPU performance, Safari/Firefox, live providers/database policies, actual OS notification receipt, and native print dialogs remain unverified. Chromium checks use SwiftShader and emulated touch.

## Approved source heads

| Feature | Exact approved head |
| --- | --- |
| Replay | `333413dd12e5aa1a9ba65897231d602070338874` |
| Heatmap | `b11ee39e4c9ca506eb064448253aa968fa8a46d2` |
| Regions | `decba13b5ea89753dc5c67d17cf24044fc5fc758` |
| Notifications | `ec3eb1bbe33bff03c02ad36c26949bb737ea7c6f` |
| Analyst | `9b6b899c5562c6cc972266e404511ec8154b12e6` |
| Drawing | `0c55327ff8fe9adea5764fcef2159a3f8c95cf64` |

Detailed feature handoffs remain at [replay](../../REPLAY_EXPERIMENT.md), [heatmap](../activity-heatmap/README.md), [regions](../region-checkpoints.md), [alerts](../../src/features/browser-geofence/README.md), [analyst](../../scripts/qa/analyst/README.md), and [drawing](../../scripts/qa/drawing-history/README.md). Implementation/integration assistance: Codex GPT-6.1 Sol; approved feature review: Astra. The final combo requires its separate Astra review.
