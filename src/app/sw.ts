/**
 * Service Worker configuration for Seraphim PWA support.
 * 
 * Utilizes Serwist (a forks of Workbox) to manage precaching, runtime caching, 
 * and offline capabilities. This ensures the application remains performant 
 * and accessible under varying network conditions.
 */

/// <reference lib="webworker" />
import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { NetworkOnly, Serwist } from "serwist";
import {
  apiRuntimeCaching,
  purgeLegacyApiCache,
} from '@/lib/pwa/runtimeCaching';

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
    ...defaultCache,
  ],
  disableDevLogs: true,
});

self.addEventListener('activate', (event) => {
  event.waitUntil(purgeLegacyApiCache(self.caches));
});

serwist.addEventListeners();
