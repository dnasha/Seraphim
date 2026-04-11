/*
Dan Sharan

Geocoding re-export for the scraper worker.
The geocoding engine has no Next.js/browser dependencies, so the scraper
imports it directly from the shared lib rather than duplicating it.
This file exists purely to keep import paths consistent within src/scraper/.
*/
export * from '@/lib/geocoding';
