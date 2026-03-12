/* Dan Sharan

Seraphim Pipeline Benchmark

profiles actual production code stages to find bottlenecks

run: npx tsx scripts/benchmark-pipeline.mjs [--skip-social] [--skip-gnews]
*/ 
 

import { performance } from 'node:perf_hooks';
import {  statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// dynamically resolve project root
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');

// execution flags
const args = new Set(process.argv.slice(2).map(a => a.toLowerCase()));
const SKIP_SOCIAL = args.has('--skip-social');
const SKIP_GNEWS  = args.has('--skip-gnews');
const QUICK_MODE  = args.has('--quick');

// text color helpers
const c = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
  blue: '\x1b[34m', magenta: '\x1b[35m', cyan: '\x1b[36m', white: '\x1b[37m',
  bgRed: '\x1b[41m', bgGreen: '\x1b[42m', bgYellow: '\x1b[43m',
};

// fancy styling 
function banner(text) {
  const line = '═'.repeat(70);
  console.log(`\n${c.cyan}${line}${c.reset}`);
  console.log(`${c.bold}${c.cyan}  ${text}${c.reset}`);
  console.log(`${c.cyan}${line}${c.reset}\n`);
}

function sectionHeader(text) {
  console.log(`\n${c.bold}${c.magenta}▸ ${text}${c.reset}`);
  console.log(`${c.dim}${'─'.repeat(60)}${c.reset}`);
}

// format milliseconds
function formatMs(ms) {
  if (ms < 1) return `${(ms * 1000).toFixed(0)}µs`;
  if (ms < 1000) return `${ms.toFixed(1)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

// percentage helper
function pct(part, total) { return total > 0 ? `${((part / total) * 100).toFixed(1)}%` : '0%'; }

// timer utility
class Timer {
  constructor() { this.marks = {}; this.starts = {}; }
  start(label) { this.starts[label] = performance.now(); }
  stop(label)  {
    const elapsed = performance.now() - (this.starts[label] || performance.now());
    this.marks[label] = (this.marks[label] || 0) + elapsed;
    return elapsed;
  }
  get(label) { return this.marks[label] || 0; }
}

// stage 1: Geodata Loading (via geocode.ts)
async function benchmarkGeodataLoad(timer) {
  sectionHeader('Stage 1 Geodata Loading');

  const jsonPath = join(ROOT, 'data', 'geonames.json');
  const stats = statSync(jsonPath);
  const fileSizeMB = (stats.size / (1024 * 1024)).toFixed(2);

  // measure the time it takes to import the module, 
  // which triggers the top-level loading and processing of KNOWN_LOCATIONS
  timer.start('geodata_total');
  const { KNOWN_LOCATIONS, ensureInitialized } = await import('../src/lib/geocoding/index.ts');
  ensureInitialized();
  timer.stop('geodata_total');

  const totalEntries = Object.keys(KNOWN_LOCATIONS).length;
  const cities = Object.values(KNOWN_LOCATIONS).filter(l => l.type === 'city').length;
  const admin1 = Object.values(KNOWN_LOCATIONS).filter(l => l.type === 'admin1').length;
  const countries = Object.values(KNOWN_LOCATIONS).filter(l => l.type === 'country').length;
  const landmarks = Object.values(KNOWN_LOCATIONS).filter(l => l.type === 'landmark').length;

  console.log(`  File size:       ${c.white}${fileSizeMB} MB${c.reset}`);
  console.log(`  Module Load:     ${c.white}${formatMs(timer.get('geodata_total'))}${c.reset} (Includes JSON parse + Dict build)`);
  console.log(`  Entries:         ${c.green}${totalEntries.toLocaleString()}${c.reset} (${cities} cities, ${admin1} admin1, ${countries} countries, ${landmarks} landmarks)`);

  return KNOWN_LOCATIONS;
}

// stage 2: RSS Sourcing (via rss.ts)
async function benchmarkRSS(timer) {
  sectionHeader('Stage 2 RSS Feed Sourcing');

  const { fetchSingleFeed, fetchRedditFeed } = await import('../src/lib/rss.ts');
  const { RSS_SOURCES, REDDIT_SOURCES } = await import('../src/data/sources.ts');

  const sources = QUICK_MODE ? RSS_SOURCES.slice(0, 3) : RSS_SOURCES;
  const redditSources = QUICK_MODE ? [] : REDDIT_SOURCES;
  const feedResults = [];
  const allItems = [];

  timer.start('rss_total');

  const rssPromises = sources.map(async (source) => {
    const t0 = performance.now();
    const items = await fetchSingleFeed(source);
    const elapsed = performance.now() - t0;
    feedResults.push({ name: source.name, status: items.length > 0 ? 'ok' : 'error', elapsed, items: items.length });
    allItems.push(...items);
  });

  const redditPromises = redditSources.map(async (source) => {
    const t0 = performance.now();
    const items = await fetchRedditFeed(source);
    const elapsed = performance.now() - t0;
    feedResults.push({ name: source.name, status: items.length > 0 ? 'ok' : 'error', elapsed, items: items.length });
    allItems.push(...items);
  });

  await Promise.all([...rssPromises, ...redditPromises]);
  timer.stop('rss_total');

  feedResults.sort((a, b) => b.elapsed - a.elapsed);

  const ok = feedResults.filter(r => r.status === 'ok').length;
  const failed = feedResults.filter(r => r.status === 'error').length;

  console.log(`  Feeds fetched:   ${c.green}${ok} ok${c.reset}, ${c.red}${failed} failed / empty${c.reset}  (${feedResults.length} total)`);
  console.log(`  Articles:        ${c.white}${allItems.length}${c.reset}`);
  console.log(`  Wall time:       ${c.white}${formatMs(timer.get('rss_total'))}${c.reset}`);
  console.log();

  console.log(`  ${'Feed'.padEnd(28)} ${'Status'.padEnd(10)} ${'Time'.padStart(10)} ${'Items'.padStart(6)}`);
  console.log(`  ${'─'.repeat(28)} ${'─'.repeat(10)} ${'─'.repeat(10)} ${'─'.repeat(6)}`);
  for (const r of feedResults) {
    const statusColor = r.status === 'ok' ? c.green : c.red;
    console.log(`  ${r.name.padEnd(28)} ${statusColor}${r.status.padEnd(10)}${c.reset} ${formatMs(r.elapsed).padStart(10)} ${String(r.items).padStart(6)}`);
  }

  return allItems;
}

// stage 3: GNews Sourcing (via gnews.ts)
async function benchmarkGNews(timer) {
  sectionHeader('Stage 3 · GNews API');

  if (!process.env.GNEWS_API_KEY || SKIP_GNEWS) {
    console.log(`  ${c.yellow}⚠ Skipped${c.reset} (${!process.env.GNEWS_API_KEY ? 'no GNEWS_API_KEY in env' : '--skip-gnews flag'})`);
    return [];
  }

  const { fetchGNews, fetchOSINTGNews } = await import('../src/lib/gnews.ts');
  const items = [];
  
  timer.start('gnews_total');

  timer.start('gnews_headlines');
  const headlines = await fetchGNews('general', 20);
  items.push(...headlines);
  timer.stop('gnews_headlines');

  timer.start('gnews_osint');
  const osint = await fetchOSINTGNews(5);
  items.push(...osint);
  timer.stop('gnews_osint');

  timer.stop('gnews_total');

  console.log(`  Headlines:       ${c.white}${formatMs(timer.get('gnews_headlines'))}${c.reset}`);
  console.log(`  OSINT queries:   ${c.white}${formatMs(timer.get('gnews_osint'))}${c.reset}`);
  console.log(`  Articles:        ${c.green}${items.length}${c.reset}`);

  return items;
}

// stage 4: Social Feeds (via social-feeds.ts)
async function benchmarkSocial(timer) {
  sectionHeader('Stage 4 Social Feeds (Telegram + X)');

  if (SKIP_SOCIAL) {
    console.log(`  ${c.yellow}! Skipped${c.reset} (--skip-social flag)`);
    return [];
  }

  const { TELEGRAM_CHANNELS, X_ACCOUNTS, scrapeTelegramChannel, fetchXFeed } = await import('../src/lib/social-feeds.ts');

  const results = [];
  const allItems = [];

  timer.start('social_total');

  timer.start('social_telegram');
  const tgPromises = TELEGRAM_CHANNELS.map(async (ch) => {
    const t0 = performance.now();
    const items = await scrapeTelegramChannel(ch);
    const elapsed = performance.now() - t0;
    results.push({ name: ch.name, status: items.length > 0 ? 'ok' : 'error', elapsed, items: items.length });
    allItems.push(...items);
  });
  await Promise.all(tgPromises);
  timer.stop('social_telegram');

  timer.start('social_x');
  const xSources = QUICK_MODE ? X_ACCOUNTS.slice(0, 2) : X_ACCOUNTS;
  const xPromises = xSources.map(async (ch) => {
    const t0 = performance.now();
    const items = await fetchXFeed(ch);
    const elapsed = performance.now() - t0;
    results.push({ name: ch.name, status: items.length > 0 ? 'ok' : 'error', elapsed, items: items.length });
    allItems.push(...items);
  });
  await Promise.all(xPromises);
  timer.stop('social_x');

  timer.stop('social_total');

  console.log(`  Telegram:        ${c.white}${formatMs(timer.get('social_telegram'))}${c.reset}`);
  console.log(`  X/Twitter:       ${c.white}${formatMs(timer.get('social_x'))}${c.reset}`);
  console.log(`  Articles:        ${c.green}${allItems.length}${c.reset}`);
  console.log();

  console.log(`  ${'Source'.padEnd(28)} ${'Status'.padEnd(10)} ${'Time'.padStart(10)} ${'Items'.padStart(6)}`);
  console.log(`  ${'─'.repeat(28)} ${'─'.repeat(10)} ${'─'.repeat(10)} ${'─'.repeat(6)}`);
  for (const r of results) {
    const sc = r.status === 'ok' ? c.green : c.red;
    console.log(`  ${r.name.padEnd(28)} ${sc}${r.status.padEnd(10)}${c.reset} ${formatMs(r.elapsed).padStart(10)} ${String(r.items).padStart(6)}`);
  }

  return allItems;
}

// stage 5: Location Extraction (via geocode.ts)
async function benchmarkExtraction(timer, items) {
  sectionHeader('Stage 5 Location Extraction');

  const { extractLocation } = await import('../src/lib/geocoding');

  let located = 0;
  let noLocation = 0;
  
  timer.start('extraction_total');

  const results = items.map(item => {
    const { match, candidates } = extractLocation(item.title, item.description);
    if (match) located++;
    else noLocation++;
    return { title: item.title, match, candidates };
  });

  timer.stop('extraction_total');

  const total = items.length;
  console.log(`  Total items:     ${c.white}${total}${c.reset}`);
  console.log(`  Located:         ${c.green}${located}${c.reset} (${pct(located, total)})`);
  console.log(`  No location:     ${c.yellow}${noLocation}${c.reset} (${pct(noLocation, total)})`);
  console.log(`  Total Time:      ${c.white}${formatMs(timer.get('extraction_total'))}${c.reset}`);
  console.log(`  Avg Time:        ${c.white}${formatMs(timer.get('extraction_total') / Math.max(total, 1))}${c.reset} / article`);

  return results;
}

// stage 6: Geocoding (via geocode.ts)
async function benchmarkGeocoding(timer, extractionResults) {
  sectionHeader('Stage 6 Geocoding');

  const { geocodeLocation } = await import('../src/lib/geocoding');

  let hits = 0;
  let fails = 0;
  let totalTime = 0;

  timer.start('geocoding_total');

  // deduplicate locations to simulate real-world geocoding cache/bottleneck
  const uniqueLocations = [...new Set(extractionResults.map(r => r.match).filter(Boolean))];

  const geocodeFails = [];
  for (const loc of uniqueLocations) {
    const t0 = performance.now();
    const result = await geocodeLocation(loc);
    totalTime += performance.now() - t0;
    if (result) hits++;
    else {
      fails++;
      geocodeFails.push(loc);
    }
  }

  timer.stop('geocoding_total');

  console.log(`  Unique locations: ${c.white}${uniqueLocations.length}${c.reset}`);
  console.log(`  Dict Hits:        ${c.green}${hits}${c.reset} (${pct(hits, uniqueLocations.length)})`);
  console.log(`  Fails:            ${c.red}${fails}${c.reset}`);
  if (geocodeFails.length > 0) {
    console.log(`  ${c.dim}Missed: ${geocodeFails.join(', ')}${c.reset}`);
  }
  console.log(`  Total Time:       ${c.white}${formatMs(timer.get('geocoding_total'))}${c.reset}`);
  console.log(`  Avg Time:         ${c.white}${formatMs(totalTime / Math.max(uniqueLocations.length, 1))}${c.reset} / lookup`);
}

// summary table
function printSummary(timer) {
  banner('BENCHMARK SUMMARY');

  const stages = [
    { name: 'Geodata Load', key: 'geodata_total' },
    { name: 'RSS Sourcing', key: 'rss_total' },
    { name: 'GNews API', key: 'gnews_total' },
    { name: 'Social Feeds', key: 'social_total' },
    { name: 'Extraction', key: 'extraction_total' },
    { name: 'Geocoding', key: 'geocoding_total' },
  ];

  const totalPipeline = stages.reduce((sum, s) => sum + timer.get(s.key), 0);
  let slowest = { name: '', ms: 0 };

  console.log(`  ${'Stage'.padEnd(22)} ${'Duration'.padStart(12)} ${'% of Total'.padStart(12)}  ${'Bar'}`);
  console.log(`  ${'═'.repeat(22)} ${'═'.repeat(12)} ${'═'.repeat(12)}  ${'═'.repeat(30)}`);

  for (const stage of stages) {
    const ms = timer.get(stage.key);
    const p = (ms / totalPipeline) * 100;
    const barLen = Math.round(p / 100 * 30);
    const bar = '█'.repeat(barLen) + '░'.repeat(30 - barLen);
    const color = p > 40 ? c.red : p > 20 ? c.yellow : c.green;
    console.log(`  ${stage.name.padEnd(22)} ${formatMs(ms).padStart(12)} ${pct(ms, totalPipeline).padStart(12)}  ${color}${bar}${c.reset}`);
    if (ms > slowest.ms) slowest = { name: stage.name, ms };
  }

  console.log(`  ${'─'.repeat(22)} ${'─'.repeat(12)} ${'─'.repeat(12)}`);
  console.log(`  ${'TOTAL'.padEnd(22)} ${c.bold}${formatMs(totalPipeline).padStart(12)}${c.reset} ${'100.0%'.padStart(12)}`);
  console.log();
  console.log(`  ${c.bgRed}${c.white}${c.bold} BOTTLENECK ${c.reset} ${c.bold}${slowest.name}${c.reset} at ${c.red}${formatMs(slowest.ms)}${c.reset} (${pct(slowest.ms, totalPipeline)} of total pipeline)`);
  console.log();
}

// main
async function main() {
  banner('SERAPHIM PIPELINE BENCHMARK');
  console.log(`  ${c.dim}Timestamp:  ${new Date().toISOString()}${c.reset}`);
  console.log(`  ${c.dim}Flags:      ${SKIP_SOCIAL ? '--skip-social ' : ''}${SKIP_GNEWS ? '--skip-gnews ' : ''}${QUICK_MODE ? '--quick' : 'full'}${c.reset}`);

  const timer = new Timer();

  // stage 1
  await benchmarkGeodataLoad(timer);

  // stage 2
  const rssItems = await benchmarkRSS(timer);

  // stage 3
  const gnewsItems = await benchmarkGNews(timer);

  // stage 4
  const socialItems = await benchmarkSocial(timer);

  // merge items
  const allItems = [...rssItems, ...gnewsItems, ...socialItems];
  console.log(`\n  ${c.bold}Total articles collected: ${c.cyan}${allItems.length}${c.reset}`);

  // stage 5
  if (allItems.length > 0) {
    const extractionResults = await benchmarkExtraction(timer, allItems);
    // stage 6
    await benchmarkGeocoding(timer, extractionResults);
  } else {
    console.log(`\n  ${c.yellow}No articles collected, skipping extraction and geocoding ${c.reset}`);
  }

  // summary
  printSummary(timer);
}

// catch errors
main().catch(err => {
  console.error(`${c.red}Fatal error:${c.reset}`, err);
  process.exit(1);
});
