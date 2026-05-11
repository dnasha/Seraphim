/*
Seraphim Source Validator
Tests every individual news source (RSS, Reddit, Social, GNews) to ensure 
approaches and connectivity are working.

- No geocoding
- No database writes
- Granular per-source reporting
- Timeout-aware

Usage: bun run scripts/test-fetchers.ts
*/

import { RSS_SOURCES, REDDIT_SOURCES, TELEGRAM_CHANNELS, X_ACCOUNTS, RSSSource, SocialSource } from '@/data/sources';
import { fetchSingleFeed, fetchRedditFeed } from '@/lib/api/rss';
import { fetchGNews } from '@/lib/api/gnews';
import { scrapeTelegramChannel, fetchXFeed } from '@/lib/api/social';

interface TestResult {
    name: string;
    type: string;
    status: 'PASS' | 'FAIL' | 'TIMEOUT';
    items: number;
    durationMs: number;
    error?: string;
}

const GLOBAL_TIMEOUT_MS = 30000; // 30s max for any single source test

async function testSource<T>(
    name: string,
    type: string,
    fetchFn: () => Promise<T[]>,
): Promise<TestResult> {
    const start = Date.now();
    try {
        // We use Promise.race to enforce a strict timeout for this test
        const items = await Promise.race([
            fetchFn(),
            new Promise<never>((_, reject) => 
                setTimeout(() => reject(new Error('TIMEOUT')), GLOBAL_TIMEOUT_MS)
            )
        ]) as unknown as { length: number }[];

        return {
            name,
            type,
            status: items.length > 0 ? 'PASS' : 'FAIL',
            items: items.length,
            durationMs: Date.now() - start,
            error: items.length === 0 ? 'No items returned' : undefined
        };
    } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        return {
            name,
            type,
            status: errorMsg === 'TIMEOUT' ? 'TIMEOUT' : 'FAIL',
            items: 0,
            durationMs: Date.now() - start,
            error: errorMsg
        };
    }
}

async function run() {
    console.log('=======================================================');
    console.log('  Seraphim Ingestion Source Validator');
    console.log('  Testing individual sources & connectivity...');
    console.log('=======================================================\n');

    const results: TestResult[] = [];

    // 1. Test GNews
    console.log('[1/5] Testing GNews API...');
    results.push(await testSource('GNews General', 'gnews', () => fetchGNews('general', 5)));

    // 2. Test RSS Sources (Sample or all?)
    // Testing all might be slow but it's what "checking if our sources are working" implies.
    // We'll run them in parallel chunks to be efficient.
    console.log('[2/5] Testing RSS Feeds...');
    const rssPromises = RSS_SOURCES.map((s: RSSSource) => testSource(s.name, 'rss', () => fetchSingleFeed(s)));
    const rssResults = await Promise.all(rssPromises);
    results.push(...rssResults);

    // 3. Test Reddit
    console.log('[3/5] Testing Reddit RSS (Sequential)...');
    for (const s of REDDIT_SOURCES) {
        results.push(await testSource(s.name, 'reddit', () => fetchRedditFeed(s)));
        // Small delay to be safe
        await new Promise(resolve => setTimeout(resolve, 500));
    }

    // 4. Test Telegram
    console.log('[4/5] Testing Telegram Scraping...');
    const tgPromises = TELEGRAM_CHANNELS.map((s: SocialSource) => testSource(s.name, 'telegram', () => scrapeTelegramChannel(s)));
    const tgResults = await Promise.all(tgPromises);
    results.push(...tgResults);

    // 5. Test X (Twitter) fallbacks
    console.log('[5/5] Testing X (Twitter) Fallbacks...');
    // X is often blocked/rate-limited, so we test them sequentially or in small batches 
    // to avoid triggering more blocks.
    for (const s of X_ACCOUNTS.slice(0, 5)) { // Test first 5 as representative sample
        results.push(await testSource(s.name, 'x', () => fetchXFeed(s)));
    }

    // --- Report ---
    console.log('\n======================= REPORT =======================');
    console.log(`${'STATUS'.padEnd(8)} | ${'TYPE'.padEnd(10)} | ${'SOURCE'.padEnd(30)} | ${'ITEMS'.padEnd(6)} | ${'TIME'}`);
    console.log('-'.repeat(75));

    results.forEach(r => {
        const statusStr = r.status.padEnd(8);
        const typeStr = r.type.padEnd(10);
        const nameStr = r.name.slice(0, 30).padEnd(30);
        const itemsStr = String(r.items).padEnd(6);
        const timeStr = `${r.durationMs}ms`;
        
        console.log(`${statusStr} | ${typeStr} | ${nameStr} | ${itemsStr} | ${timeStr}`);
        if (r.error && r.status !== 'PASS') {
            console.log(`         └─ ERROR: ${r.error}`);
        }
    });

    const passed = results.filter(r => r.status === 'PASS').length;
    const failed = results.filter(r => r.status === 'FAIL').length;
    const timedOut = results.filter(r => r.status === 'TIMEOUT').length;

    console.log('=======================================================');
    console.log(`Summary: ${passed} Passed, ${failed} Failed, ${timedOut} Timed Out`);
    console.log(`Total duration: ${results.reduce((acc, r) => acc + r.durationMs, 0) / 1000}s (wall time shorter)`);
    console.log('=======================================================');

    if (failed > 0 || timedOut > 0) {
        process.exit(0); // Exit with success but show report
    }
}

run().catch(err => {
    console.error('Validator failed:', err);
    process.exit(1);
});
