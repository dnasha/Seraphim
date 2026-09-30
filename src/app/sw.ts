/**
 * Service Worker configuration for Seraphim PWA support.
 * 
 * Utilizes Serwist (a forks of Workbox) to manage precaching, runtime caching, 
 * and offline capabilities. This ensures the application remains performant 
 * and accessible under varying network conditions.
 */

/// <reference lib="webworker" />
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { cacheNames, NetworkOnly, Serwist } from "serwist";
import {
  apiRuntimeCaching,
  purgeLegacyApiCache,
} from '@/lib/pwa/runtimeCaching';

import { openNotificationEvent } from '@/lib/pwa/notificationRoutes';

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST ?? [],
  precacheOptions: {
    cleanupOutdatedCaches: true,
    fallbackToNetwork: true,
  },
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [
    {
      matcher: ({ request }) => request.mode === "navigate",
      handler: new NetworkOnly(),
    },
    ...apiRuntimeCaching,
    // The dashboard is live and account-scoped. Do not let the generic Next
    // defaults cache RSC, HTML, hashed chunks, or other unclassified responses.
    { matcher: () => true, handler: new NetworkOnly() },
  ],
  disableDevLogs: true,
});

self.addEventListener('activate', (event) => {
  event.waitUntil(Promise.all([
    purgeLegacyApiCache(self.caches),
    // Retain this build's safe static precache. Serwist activation removes entries
    // absent from the new manifest; clear other legacy caches that could retain private data.
    self.caches.keys().then(keys => Promise.all(keys.filter(key => key !== cacheNames.precache && [
      'serwist-', 'start-url', 'pages', 'next-static-js-assets', 'static-js-assets', 'others', 'next-data',
    ].some(prefix => key.startsWith(prefix))).map(key => self.caches.delete(key)))),
  ]));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(openNotificationEvent(event.notification.data, self.location.origin, self.clients));
});

serwist.addEventListeners();
