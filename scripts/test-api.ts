import { fetchAllRSSFeeds } from '../src/lib/rss.ts';
import { fetchSocialFeeds } from '../src/lib/social-feeds.ts';
import { enrichItemsWithLocation } from '../src/lib/geocode.ts';

async function main() {
    console.time('RSS');
    const rss = await fetchAllRSSFeeds();
    console.timeEnd('RSS');
    
    console.time('Social');
    const social = await fetchSocialFeeds();
    console.timeEnd('Social');

    const all = [...rss, ...social];
    console.log('Total items:', all.length);

    console.time('Geocode');
    const enriched = await enrichItemsWithLocation(all);
    console.timeEnd('Geocode');
}
main();
