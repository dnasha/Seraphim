import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

dotenv.config({ path: join(dirname(fileURLToPath(import.meta.url)), '../.env.local') });

async function fetchAPI(sort: string) {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  // Include BBox parameters to trigger useServerClustering in route.ts
  const res = await fetch(`http://localhost:3000/api/news?view=sidebar&scope=global&sort=${sort}&since=${since}&include_unmapped=true&zoom=2&minLat=-85&maxLat=85&minLng=-180&maxLng=180`);
  if (!res.ok) {
      console.error(`Failed to fetch API: ${res.status} ${res.statusText}`);
      return;
  }
  const data = await res.json();
  const totalStories = data.items.reduce((acc: number, item: { storyCount?: number }) => acc + (item.storyCount || 1), 0);
  console.log(`API ${sort.toUpperCase()} Mode: returned ${data.items.length} items. Total stories: ${totalStories}`);
}

async function run() {
    await fetchAPI('new');
    await fetchAPI('hot');
}

run();
