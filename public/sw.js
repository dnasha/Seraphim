/*
 * Defensive service worker for Seraphim.
 *
 * The app is live-data heavy, and caching navigations or hashed Next chunks can
 * strand users on stale builds. Keep the worker lightweight: claim clients,
 * clear older generated caches, and otherwise let the browser use the network.
 */

const CACHE_PREFIXES_TO_CLEAR = [
  "serwist-",
  "start-url",
  "pages",
  "pages-rsc",
  "pages-rsc-prefetch",
  "next-static-js-assets",
  "static-js-assets",
  "others",
];

const clearOldCaches = async () => {
  const keys = await caches.keys();
  await Promise.all(
    keys
      .filter((key) => CACHE_PREFIXES_TO_CLEAR.some((prefix) => key.startsWith(prefix)))
      .map((key) => caches.delete(key)),
  );
};

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(clearOldCaches());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([
      clearOldCaches(),
      self.clients.claim(),
    ]),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }

  event.ports?.[0]?.postMessage(true);
});
