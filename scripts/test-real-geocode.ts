import { fetchAllRSSFeeds } from '../src/lib/rss';
import { fetchSocialFeeds } from '../src/lib/social-feeds';
import { extractLocation, geocodeLocation } from '../src/lib/geocode';

async function run() {
    const rssItems = await fetchAllRSSFeeds();
    const socialItems = await fetchSocialFeeds();
    const items = [...rssItems, ...socialItems];

    console.log(`Testing ${items.length} items.\n`);

    const extracted = [];
    const nulls = [];

    // Tally by matched rule:
    const ruleTally = {
        dateline: 0,
        comma_pair: 0,
        regex: 0,
        nlp: 0,
        country_abbrev: 0,
        demonym: 0,
        source_default: 0
    };

    // We can't see the internal score rule used easily since extractLocation just returns a string.
    // However, if we know they fall back in order, we can check. Wait, we modified extractLocation earlier, but maybe not in this session.
    // Let's just output them.

    for (const item of items) {
        // Strip out control chars that might mangle terminal output
        let title = item.title.replace(/[^\x20-\x7E]/g, ' ').trim();
        let desc = (item.description || '').replace(/[^\x20-\x7E]/g, ' ').trim();

        const rawPlaceName = extractLocation(title, desc);
        if (!rawPlaceName) {
            nulls.push({ title });
            continue;
        }

        const geo = await geocodeLocation(rawPlaceName);
        extracted.push({
            title,
            rawPlaceName,
            resolved: geo ? geo.displayName : 'FAILED'
        });
    }

    console.log(`\n\n=== SUCCESSFULLY EXTRACTED (${extracted.length}) ===\n`);
    for (const res of extracted.slice(0, 30)) { // look at 30
        console.log(`=> Loc: [${res.rawPlaceName.padEnd(20)}] ${res.title}`);
    }

    console.log(`\n\n=== FAILED TO EXTRACT (${nulls.length}) ===\n`);
    for (const res of nulls.slice(0, 30)) { // look at 30
        console.log(`   ${res.title}`);
    }
}

run();
