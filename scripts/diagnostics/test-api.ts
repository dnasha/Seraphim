/**
 * Purpose: Tests the local API endpoints to verify item counts and story consolidation metrics across different sort modes.
 * Usage: bun run scripts/diagnostics/test-api.ts
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

dotenv.config({ path: join(dirname(fileURLToPath(import.meta.url)), '../.env.local') });

async function fetchAPI(sort: string) {
  // Use a 24-hour lookback window to simulate typical dashboard usage.
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  // Bounding box parameters are included to trigger server-side clustering (PostGIS RPC) rather than raw table scans.
  const res = await fetch(`http://localhost:3000/api/news?view=sidebar&scope=global&sort=${sort}&since=${since}&include_unmapped=true&zoom=2&minLat=-85&maxLat=85&minLng=-180&maxLng=180`);
  
  if (!res.ok) {
      console.error(`Failed to fetch API: ${res.status} ${res.statusText}`);
      return;
  }
  
  const data = await res.json();

  // Aggregate storyCount to assess the effective density of the retrieved dataset after clustering.
  const totalStories = data.items.reduce((acc: number, item: { storyCount?: number }) => acc + (item.storyCount || 1), 0);
  console.log(`API ${sort.toUpperCase()} Mode: returned ${data.items.length} items. Total stories: ${totalStories}`);
}

async function run() {
    await fetchAPI('new');
    await fetchAPI('hot');
}

run();
