/**
 * Purpose: Profiles the execution time of each stage in the ingestion pipeline (geodata loading, sourcing, GNews API, social feeds, and location extraction) to identify performance bottlenecks.
 * Usage: bun run scripts/diagnostics/benchmark-pipeline.mjs [--skip-social] [--skip-gnews] [--quick]
 */

import { performance } from 'node:perf_hooks';
import { statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Dynamically resolve project root to ensure file path reliability across different execution environments.
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');

// Terminal output formatting
const c = {
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  white: '\x1b[37m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  reset: '\x1b[0m',
  bgRed: '\x1b[41m'
};

// Parse command line arguments to allow for selective stage execution and faster debugging cycles.
const args = new Set(process.argv.slice(2).map(a => a.toLowerCase()));
const SKIP_SOCIAL = args.has('--skip-social');
const SKIP_GNEWS  = args.has('--skip-gnews');
const QUICK_MODE  = args.has('--quick');

function banner(text) {
  const line = '='.repeat(70);
  console.log(`\n${c.cyan}${line}${c.reset}`);
  console.log(`${c.bold}${c.cyan}  ${text}${c.reset}`);
  console.log(`${c.cyan}${line}${c.reset}\n`);
}

function sectionHeader(text) {
  console.log(`\n${c.bold}${c.magenta}> ${text}${c.reset}`);
  console.log(`${c.dim}${'-'.repeat(60)}${c.reset}`);
}

function formatMs(ms) {
  if (ms < 1) return `${(ms * 1000).toFixed(0)}µs`;
  if (ms < 1000) return `${ms.toFixed(1)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function pct(part, total) { return total > 0 ? `${((part / total) * 100).toFixed(1)}%` : '0%'; }

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

/**
 * Stage 1: Geodata Loading
 * Measures the time required to import and initialize the geocoding dictionary.
 */
async function benchmarkGeodataLoad(timer) {
  sectionHeader('Stage 1 Geodata Loading');

  const jsonPath = join(ROOT, 'data', 'geonames.json');
  const stats = statSync(jsonPath);
  const fileSizeMB = (stats.size / (1024 * 1024)).toFixed(2);

  timer.start('geodata_total');
  // Use the production geocoding index which handles dictionary initialization
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

/**
 * Stage 2: RSS & Reddit Sourcing
 * Measures retrieval performance using the production scraper fetchers.
 */
async function benchmarkSourcing(timer) {
  sectionHeader('Stage 2 Sourcing (RSS & Reddit)');

  const { fetchAllRSSFeeds, fetchAllRedditFeeds } = await import('../src/scraper/fetchers/rss.ts');

  timer.start('sourcing_total');

  timer.start('rss_fetch');
  const rssItems = await fetchAllRSSFeeds();
  timer.stop('rss_fetch');

  timer.start('reddit_fetch');
  const redditItems = await fetchAllRedditFeeds();
  timer.stop('reddit_fetch');

  timer.stop('sourcing_total');

  console.log(`  RSS Items:       ${c.green}${rssItems.length}${c.reset} (Time: ${formatMs(timer.get('rss_fetch'))})`);
  console.log(`  Reddit Items:    ${c.green}${redditItems.length}${c.reset} (Time: ${formatMs(timer.get('reddit_fetch'))})`);
  console.log(`  Total Time:      ${c.white}${formatMs(timer.get('sourcing_total'))}${c.reset}`);

  return [...rssItems, ...redditItems];
}

/**
 * Stage 3: GNews Sourcing
 * Profiles API performance for headlines and OSINT queries.
 */
async function benchmarkGNews(timer) {
  sectionHeader('Stage 3 GNews API');

  if (!process.env.GNEWS_API_KEY || SKIP_GNEWS) {
    console.log(`  ${c.yellow}! Skipped${c.reset} (${!process.env.GNEWS_API_KEY ? 'no GNEWS_API_KEY in env' : '--skip-gnews flag'})`);
    return [];
  }

  const { fetchGNews, fetchOSINTGNews } = await import('../src/scraper/fetchers/gnews.ts');
  
  timer.start('gnews_total');

  timer.start('gnews_headlines');
  const headlines = await fetchGNews('general', 20);
  timer.stop('gnews_headlines');

  timer.start('gnews_osint');
  const osint = await fetchOSINTGNews();
  timer.stop('gnews_osint');

  timer.stop('gnews_total');

  console.log(`  Headlines:       ${c.white}${formatMs(timer.get('gnews_headlines'))}${c.reset}`);
  console.log(`  OSINT queries:   ${c.white}${formatMs(timer.get('gnews_osint'))}${c.reset}`);
  console.log(`  Total Items:     ${c.green}${headlines.length + osint.length}${c.reset}`);

  return [...headlines, ...osint];
}

/**
 * Stage 4: Social Feeds
 * Measures multi-strategy resolution performance for Telegram and X sources.
 */
async function benchmarkSocial(timer) {
  sectionHeader('Stage 4 Social Feeds');

  if (SKIP_SOCIAL) {
    console.log(`  ${c.yellow}! Skipped${c.reset} (--skip-social flag)`);
    return [];
  }

  const { fetchSocialFeeds } = await import('../src/scraper/fetchers/social-feeds.ts');

  timer.start('social_total');
  const items = await fetchSocialFeeds();
  timer.stop('social_total');

  console.log(`  Social Items:    ${c.green}${items.length}${c.reset}`);
  console.log(`  Total Time:      ${c.white}${formatMs(timer.get('social_total'))}${c.reset}`);

  return items;
}

/**
 * Stage 5: Location Extraction
 * Profiles the production enrichment pipeline.
 */
async function benchmarkExtraction(timer, items) {
  sectionHeader('Stage 5 Location Extraction');

  const { enrichItemsWithLocation } = await import('../src/scraper/fetchers/geocoding.ts');

  timer.start('extraction_total');
  const enriched = await enrichItemsWithLocation(items);
  timer.stop('extraction_total');

  const located = enriched.filter(i => i.latitude != null).length;
  const total = items.length;

  console.log(`  Total items:     ${c.white}${total}${c.reset}`);
  console.log(`  Located:         ${c.green}${located}${c.reset} (${pct(located, total)})`);
  console.log(`  No location:     ${c.yellow}${total - located}${c.reset} (${pct(total - located, total)})`);
  console.log(`  Total Time:      ${c.white}${formatMs(timer.get('extraction_total'))}${c.reset}`);
  console.log(`  Avg Time:        ${c.white}${formatMs(timer.get('extraction_total') / Math.max(total, 1))}${c.reset} / article`);

  return enriched;
}

function printSummary(timer) {
  banner('BENCHMARK SUMMARY');

  const stages = [
    { name: 'Geodata Load', key: 'geodata_total' },
    { name: 'Sourcing (RSS/R)', key: 'sourcing_total' },
    { name: 'GNews API', key: 'gnews_total' },
    { name: 'Social Feeds', key: 'social_total' },
    { name: 'Extraction', key: 'extraction_total' },
  ];

  const totalPipeline = stages.reduce((sum, s) => sum + timer.get(s.key), 0);
  let slowest = { name: '', ms: 0 };

  console.log(`  ${'Stage'.padEnd(22)} ${'Duration'.padStart(12)} ${'% of Total'.padStart(12)}  ${'Bar'}`);
  console.log(`  ${'='.repeat(22)} ${'='.repeat(12)} ${'='.repeat(12)}  ${'='.repeat(30)}`);

  for (const stage of stages) {
    const ms = timer.get(stage.key);
    const p = (ms / totalPipeline) * 100;
    const barLen = Math.round(p / 100 * 30);
    const bar = '#'.repeat(barLen) + '.'.repeat(30 - barLen);
    const color = p > 40 ? c.red : p > 20 ? c.yellow : c.green;
    console.log(`  ${stage.name.padEnd(22)} ${formatMs(ms).padStart(12)} ${pct(ms, totalPipeline).padStart(12)}  ${color}${bar}${c.reset}`);
    if (ms > slowest.ms) slowest = { name: stage.name, ms };
  }

  console.log(`  ${'-'.repeat(22)} ${'-'.repeat(12)} ${'-'.repeat(12)}`);
  console.log(`  ${'TOTAL'.padEnd(22)} ${c.bold}${formatMs(totalPipeline).padStart(12)}${c.reset} ${'100.0%'.padStart(12)}`);
  console.log();
  console.log(`  ${c.bgRed}${c.white}${c.bold} BOTTLENECK ${c.reset} ${c.bold}${slowest.name}${c.reset} at ${c.red}${formatMs(slowest.ms)}${c.reset} (${pct(slowest.ms, totalPipeline)} of total pipeline)`);
  console.log();
}

async function main() {
  // Bypass 'server-only' protection to allow the benchmark script to access internal libraries directly.
  process.env.IS_BENCHMARK = 'true';

  banner('SERAPHIM PIPELINE BENCHMARK');
  console.log(`  ${c.dim}Timestamp:  ${new Date().toISOString()}${c.reset}`);
  console.log(`  ${c.dim}Flags:      ${SKIP_SOCIAL ? '--skip-social ' : ''}${SKIP_GNEWS ? '--skip-gnews ' : ''}${QUICK_MODE ? '--quick' : 'full'}${c.reset}`);

  const timer = new Timer();

  // Load geodata into memory and initialize the extraction engine.
  await benchmarkGeodataLoad(timer);

  // Retrieve items from standard RSS and Reddit endpoints.
  const sourceItems = await benchmarkSourcing(timer);

  // Fetch items from the GNews API headlines and OSINT search queries.
  const gnewsItems = await benchmarkGNews(timer);

  // Fetch items from social platforms using scraping and API strategies.
  const socialItems = await benchmarkSocial(timer);

  const allItems = [...sourceItems, ...gnewsItems, ...socialItems];
  console.log(`\n  ${c.bold}Total articles collected: ${c.cyan}${allItems.length}${c.reset}`);

  // Process collected articles through the geocoding extraction engine to measure NLP and lookup performance.
  if (allItems.length > 0) {
    const itemsToProcess = QUICK_MODE ? allItems.slice(0, 50) : allItems;
    if (QUICK_MODE) console.log(`  ${c.dim}Quick mode: benchmarking extraction on first 50 items only${c.reset}`);
    await benchmarkExtraction(timer, itemsToProcess);
  } else {
    console.log(`\n  ${c.yellow}No articles collected, skipping extraction benchmark ${c.reset}`);
  }

  printSummary(timer);
}

main().catch(err => {
  console.error(`${c.red}Fatal error:${c.reset}`, err);
  process.exit(1);
});
