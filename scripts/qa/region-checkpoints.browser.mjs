/**
 * Browser QA against the real HomeContent/NewsMap. All API/provider traffic is
 * synthetic or blocked. Start Next with supabase.invalid placeholder settings.
 * Install Playwright in a temporary tool directory, then run:
 * QA_PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node scripts/qa/region-checkpoints.browser.mjs
 */
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
const { chromium } = await import(
  process.env.QA_PLAYWRIGHT_MODULE || "playwright"
);
const base = process.env.QA_BASE_URL || "http://localhost:3000";
const out = process.env.QA_OUTPUT_DIR || "artifacts/region-checkpoints";
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.QA_CHROMIUM_PATH || "/usr/bin/chromium",
  args: ["--no-sandbox", "--enable-unsafe-swiftshader"],
  env: {
    ...process.env,
    XDG_CONFIG_HOME: "/tmp/region-checkpoints-browser/config",
    XDG_CACHE_HOME: "/tmp/region-checkpoints-browser/cache",
  },
});
const user = {
  id: "00000000-0000-4000-8000-000000000001",
  aud: "authenticated",
  role: "authenticated",
  email: "fixture@example.test",
  app_metadata: {},
  user_metadata: {},
  created_at: "2026-01-01T00:00:00Z",
};
// Deliberately unsigned fixture, accepted only by intercepted auth responses.
const token = `${Buffer.from('{"alg":"none"}').toString("base64url")}.${Buffer.from(JSON.stringify({ sub: user.id, exp: 4102444800 })).toString("base64url")}.fixture`;
const session = {
  access_token: token,
  refresh_token: "fixture-only",
  token_type: "bearer",
  expires_in: 3600,
  expires_at: 4102444800,
  user,
};
const cookie = `base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`;
const event = (id, extra = {}) => ({
  id,
  title: `Synthetic checkpoint event ${id}`,
  url: `https://example.test/${id}`,
  source: "Synthetic Publisher",
  sourceType: "rss",
  category: "general",
  credibilityTier: 1,
  publishedAt: new Date().toISOString(),
  latitude: 0,
  longitude: 0,
  ...extra,
});
const transparentPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
  "base64",
);
const results = [];
try {
  for (const [name, viewport] of [
    ["desktop", { width: 1440, height: 1000 }],
    ["mobile", { width: 390, height: 844 }],
  ]) {
    const context = await browser.newContext({
      viewport,
      serviceWorkers: "block",
    });
    await context.addCookies([
      { name: "sb-supabase-auth-token", value: cookie, url: base },
    ]);
    let stage = 0;
    const requests = [],
      external = [],
      errors = [],
      preferenceWrites = [];
    await context.route("**/*", async (route) => {
      const request = route.request(),
        url = new URL(request.url());
      if (url.hostname === "supabase.invalid") {
        if (url.pathname.startsWith("/auth/v1/"))
          return route.fulfill({ json: user });
        if (url.pathname.includes("user_preferences")) {
          if (request.method() !== "GET")
            preferenceWrites.push(request.postData() || "");
          return route.fulfill({
            json:
              request.method() === "GET"
                ? { preferences: { animatedEffects: false } }
                : {},
          });
        }
        return route.fulfill({ json: {} });
      }
      if (url.origin === base) {
        if (url.pathname === "/api/account/profile")
          return route.fulfill({
            json: { effectiveTier: "free", tierSource: "billing" },
          });
        if (url.pathname === "/api/news") {
          const raw = url.searchParams.get("force_raw") === "true";
          if (raw) requests.push(url);
          if (raw && stage === 4)
            return route.fulfill({
              status: 503,
              json: { error: "Synthetic unavailable" },
            });
          const items = [
            event(
              "a",
              raw && stage >= 2
                ? {
                    title: "Synthetic corrected event a",
                    sources: [
                      {
                        name: "Synthetic additional publisher",
                        url: "https://other.example.test/a",
                        sourceType: "rss",
                        discoveredAt: new Date().toISOString(),
                      },
                    ],
                  }
                : {},
            ),
          ];
          if (raw && stage >= 1)
            items.push(event("late", { publishedAt: "2000-01-01T00:00:00Z" }));
          return route.fulfill({
            json: {
              items,
              lastUpdated: new Date().toISOString(),
              meta: {
                sort: url.searchParams.get("sort") || "hot",
                view: url.searchParams.get("view") || "map",
                scope: url.searchParams.get("scope") || "viewport",
                clustered: false,
                isCapped: raw && stage === 3,
                stale: raw && stage === 3,
                appliedLimit: 50,
                zoomBucket: null,
              },
              sources: { gnews: null, rss: null, social: null },
            },
          });
        }
        if (url.pathname.startsWith("/api/"))
          return route.fulfill({ json: {} });
        return route.continue();
      }
      // No external traffic reaches providers. Empty tiles/sprites are fixtures.
      external.push(url.hostname);
      if (url.pathname.endsWith(".mvt") || url.pathname.endsWith(".pbf"))
        return route.fulfill({
          body: Buffer.alloc(0),
          contentType: "application/x-protobuf",
        });
      if (url.pathname.endsWith(".json")) return route.fulfill({ json: {} });
      if (url.pathname.endsWith(".png"))
        return route.fulfill({
          body: transparentPng,
          contentType: "image/png",
        });
      return route.fulfill({ body: "", status: 200 });
    });
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`${base}/?lat=0&lng=0&zoom=4`, {
      waitUntil: "domcontentloaded",
    });
    if (name === "mobile")
      await page.getByRole("button", { name: "Map", exact: true }).click();
    const essential = page.getByRole("button", {
      name: "Essential Only",
      exact: true,
    });
    await essential.waitFor({ timeout: 10_000 });
    await essential.click();
    const launcher = page.getByRole("button", {
      name: "Region checkpoints",
      exact: true,
    });
    await launcher.waitFor({ timeout: 30_000 });
    await launcher.click();
    const panel = page.getByRole("region", { name: "Region checkpoints" });
    await panel
      .getByLabel("Region name", { exact: true })
      .fill(`Synthetic ${name} watch`);
    await panel.getByRole("button", { name: "Save viewport" }).click();
    await panel
      .getByRole("button", { name: `Synthetic ${name} watch`, exact: true })
      .click();
    await panel.getByRole("button", { name: "Check changes" }).click();
    await panel.getByText(/Baseline saved/).waitFor();
    const storeKey = `seraphim:experiment:region-checkpoints:v1:${user.id}`;
    let stored = JSON.parse(
      await page.evaluate((key) => localStorage.getItem(key), storeKey),
    );
    assert.equal(stored.regions[0].baseline.events.length, 1);
    const savedGeometry = JSON.stringify(stored.regions[0].region.geometry);
    await panel
      .getByRole("button", { name: "Close region checkpoints" })
      .click();
    await page.getByRole("button", { name: "Zoom in", exact: true }).click();
    await launcher.click();
    stage = 1;
    await panel.getByRole("button", { name: "Check changes" }).click();
    await panel.getByText("Newly observed event", { exact: true }).waitFor();
    await panel
      .getByRole("button", { name: "Mark reviewed" })
      .scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${out}/${name}-changes.png` });
    // Feed changes after the displayed snapshot: reviewing must not refetch.
    stage = 2;
    const readsBeforeReview = requests.length;
    await panel.getByRole("button", { name: "Mark reviewed" }).click();
    await panel.getByText(/Baseline saved/).waitFor();
    assert.equal(requests.length, readsBeforeReview);
    stored = JSON.parse(
      await page.evaluate((key) => localStorage.getItem(key), storeKey),
    );
    assert.equal(
      JSON.stringify(stored.regions[0].region.geometry),
      savedGeometry,
    );
    assert.equal(
      stored.regions[0].baseline.events[0].title,
      "Synthetic checkpoint event a",
    );
    await panel.getByRole("button", { name: "Check changes" }).click();
    await panel
      .getByText(
        /newly observed source\(s\).*Observable title or location correction/,
      )
      .waitFor();
    await panel
      .getByRole("button", { name: "Mark reviewed" })
      .scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${out}/${name}-corrections.png` });
    const prior = await page.evaluate(
      (key) => localStorage.getItem(key),
      storeKey,
    );
    stage = 3;
    await panel.getByRole("button", { name: "Check changes" }).click();
    await panel.getByText(/Stale results/).waitFor();
    assert.equal(
      await panel.getByRole("button", { name: "Mark reviewed" }).isDisabled(),
      true,
    );
    assert.equal(
      await page.evaluate((key) => localStorage.getItem(key), storeKey),
      prior,
    );
    stage = 4;
    await panel.getByRole("button", { name: "Check changes" }).click();
    await panel.getByRole("alert").getByText(/503/).waitFor();
    assert.equal(
      await page.evaluate((key) => localStorage.getItem(key), storeKey),
      prior,
    );
    // Reload restores baseline, and the saved region does not follow camera URLs.
    stage = 2;
    await page.reload({ waitUntil: "domcontentloaded" });
    if (name === "mobile")
      await page.getByRole("button", { name: "Map", exact: true }).click();
    await launcher.click();
    await panel
      .getByRole("button", { name: `Synthetic ${name} watch`, exact: true })
      .click();
    await panel.getByLabel("Rename region").fill(`Renamed ${name} watch`);
    await panel.getByRole("button", { name: "Rename", exact: true }).click();
    await panel
      .getByRole("button", { name: `Renamed ${name} watch`, exact: true })
      .waitFor();
    const rect = await panel.boundingBox();
    assert(
      rect &&
        rect.x >= 0 &&
        rect.x + rect.width <= viewport.width &&
        rect.y >= 0 &&
        rect.y + rect.height <= viewport.height,
    );
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    assert(
      preferenceWrites.every(
        (body) => !/checkpoint|Synthetic|Renamed/.test(body),
      ),
      "Private region must not enter cloud preference writes",
    );
    assert(
      !page.url().includes("watch"),
      "Private region must not enter page URLs",
    );
    assert(
      requests.every(
        (url) =>
          url.searchParams.get("force_raw") === "true" &&
          url.searchParams.get("scope") === "viewport",
      ),
    );
    assert.equal(errors.length, 0, errors.join("\n"));
    await panel.getByRole("button", { name: "Delete region" }).click();
    assert.equal(
      JSON.parse(
        await page.evaluate((key) => localStorage.getItem(key), storeKey),
      ).regions.length,
      0,
    );
    await panel.getByLabel("Region name", { exact: true }).press("Escape");
    assert.equal(await launcher.getAttribute("aria-expanded"), "false");
    results.push({
      viewport: name,
      passed: true,
      rawReads: requests.length,
      externalRequestsMocked: external.length,
      pageErrors: errors,
    });
    await context.close();
  }
  console.log(JSON.stringify(results, null, 2));
} finally {
  await browser.close();
}
