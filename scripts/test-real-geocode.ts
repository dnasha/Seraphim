import { fetchAllRSSFeeds } from '../src/lib/rss';
import { fetchSocialFeeds } from '../src/lib/social-feeds';
import { enrichItemsWithLocation } from '../src/lib/geocoding';
import * as fs from 'fs';
import * as path from 'path';

// npx tsx scripts/test-real-geocode.ts 

async function run() {
    console.log("Fetching items from RSS and Social sources...");
    const rssItems = await fetchAllRSSFeeds();
    const socialItems = await fetchSocialFeeds();
    const items = [...rssItems, ...socialItems];

    console.log(`\nTesting ${items.length} items. Running through enrichItemsWithLocation...`);

    // Use the real geocoding pipeline built into the app
    // This handles extraction, geocoding, and source defaults!
    const enrichedItems = await enrichItemsWithLocation(items);

    const results = enrichedItems.map(item => {
        const title = item.title;
        const desc = item.description || '';
        
        // found_locations: based on the debug candidates attached by enrichItemsWithLocation
        const found_locations = item.foundLocations || [];

        // final_mapped_location: The coordinates and the display name
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
    
    console.log(`\n=== DONE ===`);
    console.log(`Wrote ${results.length} results to ${outputPath}`);
    
    const mapped = results.filter(r => r.final_mapped_location);
    console.log(`Mapped: ${mapped.length}`);
    console.log(`Unmapped: ${results.length - mapped.length}`);
}

run();
