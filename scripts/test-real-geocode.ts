/*
Seraphim Real Geocode Live Tester
Runs the actual production geocoding pipeline against current feed items
to generate a results JSON for inspection and grading.

Run: npx tsx scripts/test-real-geocode.ts
*/

import { fetchAllRSSFeeds } from '../src/lib/rss';
import { fetchSocialFeeds } from '../src/lib/social-feeds';
import { enrichItemsWithLocation } from '../src/lib/geocoding';
import * as fs from 'fs';
import * as path from 'path';

async function run() {
    console.log("Fetching items from RSS and Social sources...");
    const rssItems = await fetchAllRSSFeeds();
    const socialItems = await fetchSocialFeeds();
    const items = [...rssItems, ...socialItems];

    console.log(`\nTesting ${items.length} items. Running through enrichItemsWithLocation...`);

    // run items through the production geocoding pipeline (extraction + geocoding)
    const enrichedItems = await enrichItemsWithLocation(items);

    const results = enrichedItems.map(item => {
        const title = item.title;
        const desc = item.description || '';
        
        const found_locations = item.foundLocations || [];

        // format final geocoded results for comparison
        const final_mapped_location = (item.latitude !== undefined && item.longitude !== undefined) 
            ? {
                lat: item.latitude,
                lon: item.longitude,
                displayName: item.locationName
            } 
            : null;

        return {
            title,
            desc,
            found_locations,
            final_mapped_location
        };
    });

    const outputPath = path.join(process.cwd(), 'scripts/results/', 'geocode-results.json');
    fs.writeFileSync(outputPath, JSON.stringify(results, null, 2), 'utf-8');
    
    console.log(`\nDONE`);
    console.log(`Wrote ${results.length} results to ${outputPath}`);
    
    const mapped = results.filter(r => r.final_mapped_location);
    console.log(`Mapped: ${mapped.length}`);
    console.log(`Unmapped: ${results.length - mapped.length}`);
}

run();
