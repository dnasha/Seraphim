#!/usr/bin/env node
/**
 * ============================================================================
 *  Seraphim Pipeline Benchmark
 * ============================================================================
 *  Profiles every stage of the data pipeline to find bottlenecks.
 *
 *  Usage:   node scripts/benchmark-pipeline.mjs [--skip-social] [--skip-gnews]
 *  Flags:
 *    --skip-social   Skip Telegram + X feed fetching (they can be very slow)
 *    --skip-gnews    Skip GNews API calls even if API key is present
 *    --quick         Only fetch 3 RSS feeds (for fast iteration)
 * ============================================================================
 */

import { performance } from 'node:perf_hooks';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// ── Resolve project root ────────────────────────────────────────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');

// ── CLI flags ───────────────────────────────────────────────────────────────
const args = new Set(process.argv.slice(2).map(a => a.toLowerCase()));
const SKIP_SOCIAL = args.has('--skip-social');
const SKIP_GNEWS  = args.has('--skip-gnews');
const QUICK_MODE  = args.has('--quick');

// ── ANSI helpers ────────────────────────────────────────────────────────────
const c = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
  blue: '\x1b[34m', magenta: '\x1b[35m', cyan: '\x1b[36m', white: '\x1b[37m',
  bgRed: '\x1b[41m', bgGreen: '\x1b[42m', bgYellow: '\x1b[43m',
};

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

function formatMs(ms) {
  if (ms < 1) return `${(ms * 1000).toFixed(0)}µs`;
  if (ms < 1000) return `${ms.toFixed(1)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function pct(part, total) { return total > 0 ? `${((part / total) * 100).toFixed(1)}%` : '0%'; }

// ── Timer utility ───────────────────────────────────────────────────────────
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

// ============================================================================
//  STAGE 1: Geodata Loading
// ============================================================================
async function benchmarkGeodataLoad(timer) {
  sectionHeader('Stage 1 · Geodata Loading');

  timer.start('geodata_read');
  const raw = readFileSync(join(ROOT, 'data', 'geonames.json'), 'utf-8');
  timer.stop('geodata_read');
  const fileSizeMB = (Buffer.byteLength(raw, 'utf-8') / (1024 * 1024)).toFixed(2);

  timer.start('geodata_parse');
  const geoData = JSON.parse(raw);
  timer.stop('geodata_parse');

  timer.start('geodata_dict');
  const KNOWN = {};
  let cityCount = 0, admin1Count = 0, countryCount = 0;

  // Cities
  for (const [key, city] of Object.entries(geoData.cities || {})) {
    if (key.length <= 2) continue;
    KNOWN[key] = { lat: city.lat, lon: city.lon, pop: city.pop, type: 'city' };
    cityCount++;
  }
  // Admin1
  for (const [key, region] of Object.entries(geoData.admin1 || {})) {
    if (key.length <= 2) continue;
    const existing = KNOWN[key];
    if (existing && existing.pop > 500000) continue;
    KNOWN[key] = { lat: region.lat, lon: region.lon, pop: 0, type: 'admin1' };
    admin1Count++;
  }
  // Countries
  for (const [name, data] of Object.entries(geoData.countries || {})) {
    if (name.length <= 2) continue;
    KNOWN[name] = { lat: data.lat, lon: data.lon, pop: 0, type: 'country' };
    countryCount++;
  }
  timer.stop('geodata_dict');
  timer.marks['geodata_total'] = timer.get('geodata_read') + timer.get('geodata_parse') + timer.get('geodata_dict');

  const totalEntries = Object.keys(KNOWN).length;
  console.log(`  File size:       ${c.white}${fileSizeMB} MB${c.reset}`);
  console.log(`  JSON.parse:      ${c.white}${formatMs(timer.get('geodata_parse'))}${c.reset}`);
  console.log(`  Dict build:      ${c.white}${formatMs(timer.get('geodata_dict'))}${c.reset}`);
  console.log(`  Entries:         ${c.green}${totalEntries.toLocaleString()}${c.reset} (${cityCount} cities, ${admin1Count} admin1, ${countryCount} countries)`);

  return KNOWN;
}

// ============================================================================
//  STAGE 2: RSS Sourcing
// ============================================================================
async function benchmarkRSS(timer) {
  sectionHeader('Stage 2 · RSS Feed Sourcing');

  const Parser = (await import('rss-parser')).default;
  const parser = new Parser({
    headers: { 'User-Agent': 'Seraphim/1.0 (news aggregator)', 'Accept': 'application/rss+xml, application/xml, text/xml' },
    customFields: { item: ['media:content', 'media:thumbnail', 'enclosure'] },
  });

  const RSS_SOURCES = [
    { name: 'BBC World', url: 'https://feeds.bbci.co.uk/news/rss.xml', category: 'world' },
    { name: 'Al Jazeera', url: 'https://www.aljazeera.com/xml/rss/all.xml', category: 'world' },
    { name: 'NYT World', url: 'https://rss.nytimes.com/services/xml/rss/nyt/World.xml', category: 'world' },
    { name: 'DW News', url: 'https://rss.dw.com/rdf/rss-en-eu', category: 'world' },
    { name: 'France 24', url: 'https://www.france24.com/en/europe/rss', category: 'world' },
    { name: 'SCMP', url: 'https://www.scmp.com/rss/91/feed', category: 'world' },
    { name: 'BBC Africa', url: 'http://feeds.bbci.co.uk/news/world/africa/rss.xml', category: 'world' },
    { name: 'BBC Middle East', url: 'http://feeds.bbci.co.uk/news/world/middle_east/rss.xml', category: 'world' },
    { name: 'CNA Asia', url: 'https://www.channelnewsasia.com/api/v1/rss-outbound-feed?_format=xml&category=6511', category: 'world' },
    { name: 'Times of Israel', url: 'https://www.timesofisrael.com/feed/', category: 'world' },
    { name: 'Al Arabiya English', url: 'https://news.google.com/rss/search?q=site:english.alarabiya.net&hl=en', category: 'world' },
    { name: 'MercoPress LatAm', url: 'https://en.mercopress.com/rss/', category: 'world' },
    { name: 'USGS Earthquakes', url: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/significant_month.atom', category: 'crisis' },
    { name: 'ReliefWeb', url: 'https://reliefweb.int/updates/rss.xml', category: 'crisis' },
    { name: 'War on the Rocks', url: 'https://warontherocks.com/feed/', category: 'world' },
    { name: 'ISW Daily Updates', url: 'https://news.google.com/rss/search?q=site:understandingwar.org&hl=en', category: 'crisis' },
    { name: 'Bellingcat', url: 'https://www.bellingcat.com/feed/', category: 'world' },
    { name: 'NPR US', url: 'https://feeds.npr.org/1003/rss.xml', category: 'nation' },
    { name: 'CBC Canada', url: 'https://rss.cbc.ca/lineup/topstories.xml', category: 'nation' },
    { name: 'CNBC', url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114', category: 'business' },
    { name: 'MarketWatch', url: 'https://feeds.marketwatch.com/marketwatch/topstories/', category: 'business' },
    { name: 'Ars Technica', url: 'https://feeds.arstechnica.com/arstechnica/index', category: 'technology' },
    { name: 'The Verge', url: 'https://www.theverge.com/rss/index.xml', category: 'technology' },
    { name: 'BleepingComputer', url: 'https://www.bleepingcomputer.com/feed/', category: 'technology' },
    { name: 'The Hacker News', url: 'https://feeds.feedburner.com/TheHackersNews', category: 'technology' },
    { name: 'NASA', url: 'https://www.nasa.gov/news-release/feed/', category: 'science' },
    { name: 'Nature', url: 'https://www.nature.com/nature.rss', category: 'science' },
    { name: 'WHO News', url: 'https://www.who.int/rss-feeds/news-english.xml', category: 'health' },
  ];

  const REDDIT_SOURCES = [
    { name: 'Reddit CombatFootage', subreddit: 'CombatFootage', category: 'crisis' },
    { name: 'Reddit CredibleDefense', subreddit: 'CredibleDefense', category: 'crisis' },
  ];

  const FEED_TIMEOUT = 15000;
  const sources = QUICK_MODE ? RSS_SOURCES.slice(0, 3) : RSS_SOURCES;
  const feedResults = [];
  const allItems = [];

  timer.start('rss_total');
  // Fetch all feeds in parallel
  const feedPromises = sources.map(async (source) => {
    const t0 = performance.now();
    try {
      const feed = await Promise.race([
        parser.parseURL(source.url),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), FEED_TIMEOUT)),
      ]);
      const elapsed = performance.now() - t0;
      const items = (feed.items || []).slice(0, 5).map((item, i) => ({
        id: `rss-${source.name}-${i}`, title: item.title || '', description: item.contentSnippet || item.content || '',
        url: item.link || '', source: source.name, sourceType: 'rss', category: source.category,
        publishedAt: item.pubDate || new Date().toISOString(),
      }));
      feedResults.push({ name: source.name, status: 'ok', elapsed, items: items.length });
      allItems.push(...items);
    } catch (err) {
      const elapsed = performance.now() - t0;
      feedResults.push({ name: source.name, status: err.message === 'timeout' ? 'timeout' : 'error', elapsed, items: 0 });
    }
  });

  // Reddit feeds
  const redditPromises = (QUICK_MODE ? [] : REDDIT_SOURCES).map(async (source) => {
    const t0 = performance.now();
    try {
      const res = await fetch(`https://www.reddit.com/r/${source.subreddit}/new.json?limit=5`, {
        headers: { 'User-Agent': 'Seraphim/1.0 (news aggregator)' },
        signal: AbortSignal.timeout(FEED_TIMEOUT),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const posts = (data?.data?.children || []).slice(0, 5);
      const elapsed = performance.now() - t0;
      const items = posts.map((child, i) => ({
        id: `reddit-${source.subreddit}-${i}`, title: child.data.title || '', description: child.data.selftext || '',
        url: `https://reddit.com${child.data.permalink}`, source: source.name, sourceType: 'rss', category: source.category,
        publishedAt: new Date((child.data.created_utc || 0) * 1000).toISOString(),
      }));
      feedResults.push({ name: source.name, status: 'ok', elapsed, items: items.length });
      allItems.push(...items);
    } catch {
      feedResults.push({ name: source.name, status: 'error', elapsed: performance.now() - t0, items: 0 });
    }
  });

  await Promise.all([...feedPromises, ...redditPromises]);
  timer.stop('rss_total');

  // Sort by elapsed time desc
  feedResults.sort((a, b) => b.elapsed - a.elapsed);

  const ok = feedResults.filter(r => r.status === 'ok').length;
  const failed = feedResults.filter(r => r.status === 'error').length;
  const timedOut = feedResults.filter(r => r.status === 'timeout').length;

  console.log(`  Feeds fetched:   ${c.green}${ok} ok${c.reset}, ${c.red}${failed} err${c.reset}, ${c.yellow}${timedOut} timeout${c.reset}  (${feedResults.length} total)`);
  console.log(`  Articles:        ${c.white}${allItems.length}${c.reset}`);
  console.log(`  Wall time:       ${c.white}${formatMs(timer.get('rss_total'))}${c.reset}`);
  console.log();

  // Per-feed table
  console.log(`  ${'Feed'.padEnd(28)} ${'Status'.padEnd(10)} ${'Time'.padStart(10)} ${'Items'.padStart(6)}`);
  console.log(`  ${'─'.repeat(28)} ${'─'.repeat(10)} ${'─'.repeat(10)} ${'─'.repeat(6)}`);
  for (const r of feedResults) {
    const statusColor = r.status === 'ok' ? c.green : r.status === 'timeout' ? c.yellow : c.red;
    console.log(`  ${r.name.padEnd(28)} ${statusColor}${r.status.padEnd(10)}${c.reset} ${formatMs(r.elapsed).padStart(10)} ${String(r.items).padStart(6)}`);
  }

  return allItems;
}

// ============================================================================
//  STAGE 3: GNews Sourcing
// ============================================================================
async function benchmarkGNews(timer) {
  sectionHeader('Stage 3 · GNews API');

  const apiKey = process.env.GNEWS_API_KEY;
  if (!apiKey || SKIP_GNEWS) {
    console.log(`  ${c.yellow}⚠ Skipped${c.reset} (${!apiKey ? 'no GNEWS_API_KEY in env' : '--skip-gnews flag'})`);
    return [];
  }

  const items = [];
  timer.start('gnews_total');

  // Headlines
  timer.start('gnews_headlines');
  try {
    const res = await fetch(`https://gnews.io/api/v4/top-headlines?category=general&lang=en&max=20&apikey=${apiKey}`);
    if (res.ok) {
      const data = await res.json();
      for (const a of (data.articles || [])) {
        items.push({ id: `gnews-${items.length}`, title: a.title, description: a.description || '', url: a.url,
          source: a.source?.name || 'GNews', sourceType: 'gnews', category: 'general', publishedAt: a.publishedAt });
      }
    }
  } catch (e) { console.log(`  ${c.red}Headlines error: ${e.message}${c.reset}`); }
  timer.stop('gnews_headlines');

  // OSINT queries
  const queries = [
    '"geolocated" OR "satellite imagery"', '"confirmed strike" OR "explosion reported"',
    '"troop deployment" OR "military convoy"', '"cyber attack" OR "critical infrastructure"',
  ];

  timer.start('gnews_osint');
  for (const q of queries) {
    try {
      const res = await fetch(`https://gnews.io/api/v4/search?q=${encodeURIComponent(q)}&lang=en&max=5&apikey=${apiKey}`);
      if (res.status === 429) { console.log(`  ${c.yellow}Rate limited — stopping OSINT queries${c.reset}`); break; }
      if (res.ok) {
        const data = await res.json();
        for (const a of (data.articles || [])) {
          items.push({ id: `gnews-osint-${items.length}`, title: a.title, description: a.description || '', url: a.url,
            source: a.source?.name || 'GNews', sourceType: 'gnews', category: 'crisis', publishedAt: a.publishedAt });
        }
      }
    } catch { /* ignore */ }
  }
  timer.stop('gnews_osint');
  timer.stop('gnews_total');

  console.log(`  Headlines:       ${c.white}${formatMs(timer.get('gnews_headlines'))}${c.reset}`);
  console.log(`  OSINT queries:   ${c.white}${formatMs(timer.get('gnews_osint'))}${c.reset}`);
  console.log(`  Articles:        ${c.green}${items.length}${c.reset}`);

  return items;
}

// ============================================================================
//  STAGE 4: Social Feeds
// ============================================================================
async function benchmarkSocial(timer) {
  sectionHeader('Stage 4 · Social Feeds (Telegram + X)');

  if (SKIP_SOCIAL) {
    console.log(`  ${c.yellow}⚠ Skipped${c.reset} (--skip-social flag)`);
    return [];
  }

  let cheerio;
  try { cheerio = await import('cheerio'); } catch { console.log(`  ${c.red}cheerio not installed${c.reset}`); return []; }

  const results = [];
  const allItems = [];

  // Telegram channels
  const TG_CHANNELS = [
    { name: 'Faytuks', url: 'https://t.me/s/Faytuks' },
    { name: 'LiveUkraine', url: 'https://t.me/s/liveukraine_media' },
    { name: 'Astra Press', url: 'https://t.me/s/astrapress' },
  ];

  timer.start('social_telegram');
  for (const ch of TG_CHANNELS) {
    const t0 = performance.now();
    try {
      const res = await fetch(ch.url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', Accept: 'text/html' },
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const html = await res.text();
      const $ = cheerio.load(html);
      let count = 0;
      $('.tgme_widget_message').each((_i, el) => {
        const text = $(el).find('.tgme_widget_message_text').text().trim();
        if (text && text.length >= 10) {
          count++;
          allItems.push({ id: `tg-${ch.name}-${count}`, title: text.slice(0, 140), description: text.slice(0, 500),
            url: ch.url, source: ch.name, sourceType: 'social', category: 'world', publishedAt: new Date().toISOString() });
        }
      });
      results.push({ name: `TG: ${ch.name}`, status: 'ok', elapsed: performance.now() - t0, items: count });
    } catch {
      results.push({ name: `TG: ${ch.name}`, status: 'error', elapsed: performance.now() - t0, items: 0 });
    }
  }
  timer.stop('social_telegram');

  // X/Twitter via RSSHub (simplified — just test connectivity)
  const X_ACCOUNTS = ['GeoConfirmed', 'OSINTtechnical', 'Liveuamap', 'IntelCrab', 'AuroraIntel'];
  const RSSHUB = ['https://rsshub.app', 'https://rsshub.rssforever.com', 'https://rsshub.moeyy.cn'];
  const Parser = (await import('rss-parser')).default;
  const parser = new Parser({ timeout: 10000, headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Seraphim/1.0)' } });

  timer.start('social_x');
  for (const username of (QUICK_MODE ? X_ACCOUNTS.slice(0, 1) : X_ACCOUNTS)) {
    const t0 = performance.now();
    let found = false;
    for (const instance of RSSHUB) {
      try {
        const feed = await parser.parseURL(`${instance}/twitter/user/${username}`);
        if (feed.items && feed.items.length > 0) {
          const items = feed.items.slice(0, 5).map((item, i) => ({
            id: `x-${username}-${i}`, title: (item.title || '').slice(0, 200), description: item.contentSnippet || '',
            url: item.link || '', source: `${username} (X)`, sourceType: 'social', category: 'crisis',
            publishedAt: item.pubDate || new Date().toISOString(),
          }));
          results.push({ name: `X: @${username}`, status: 'ok', elapsed: performance.now() - t0, items: items.length });
          allItems.push(...items);
          found = true;
          break;
        }
      } catch { continue; }
    }
    if (!found) results.push({ name: `X: @${username}`, status: 'error', elapsed: performance.now() - t0, items: 0 });
  }
  timer.stop('social_x');

  timer.marks['social_total'] = timer.get('social_telegram') + timer.get('social_x');

  console.log(`  Telegram:        ${c.white}${formatMs(timer.get('social_telegram'))}${c.reset}`);
  console.log(`  X/Twitter:       ${c.white}${formatMs(timer.get('social_x'))}${c.reset}`);
  console.log(`  Total items:     ${c.green}${allItems.length}${c.reset}`);
  console.log();

  console.log(`  ${'Source'.padEnd(24)} ${'Status'.padEnd(10)} ${'Time'.padStart(10)} ${'Items'.padStart(6)}`);
  console.log(`  ${'─'.repeat(24)} ${'─'.repeat(10)} ${'─'.repeat(10)} ${'─'.repeat(6)}`);
  for (const r of results) {
    const sc = r.status === 'ok' ? c.green : c.red;
    console.log(`  ${r.name.padEnd(24)} ${sc}${r.status.padEnd(10)}${c.reset} ${formatMs(r.elapsed).padStart(10)} ${String(r.items).padStart(6)}`);
  }

  return allItems;
}

// ============================================================================
//  STAGE 5: Location Extraction Microbenchmark
// ============================================================================
async function benchmarkExtraction(timer, items, KNOWN) {
  sectionHeader('Stage 5 · Location Extraction');

  // Import extraction logic inline — replicate core patterns from geocode.ts
  const nlpLib = await loadCompromise();
  const DATELINE = /^([A-Z][A-Za-z\s]+?)\s*(?:\([^)]+\))?\s*(?:-|—|–|:)\s+/;
  const COMMA_PAIR = /([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*),\s*([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*)/g;
  const LOC_PATTERNS = [
    /\bin\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){0,3})/g,
    /\bin\s+the\s+([A-Z][a-zA-Z]+(?:\s+(?:of\s+)?[A-Z][a-zA-Z]+){0,3})/g,
    /\bfrom\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){0,3})/g,
    /\bnear\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){0,3})/g,
    /\bacross\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){0,3})/g,
    /\b[Hh]its?\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){0,3})/g,
    /\b[Ss]trikes?\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){0,3})/g,
    /\b[Aa]ttacks?\s+(?:[Oo]n\s+)?([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){0,3})/g,
  ];

  const STOP = new Set([
    'january','february','march','april','may','june','july','august','september','october',
    'november','december','monday','tuesday','wednesday','thursday','friday','saturday','sunday',
    'the','this','that','these','those','what','which','who','how','just','new','more','most',
    'some','many','much','its','his','her','their','our','all','trump','biden','putin',
    'congress','senate','parliament','reuters','associated','press','breaking','update','live',
    'north','south','east','west','says','said','war','peace','crisis','government','president',
    'military','army','force','forces','nasa','mars','venus','moon',
  ]);

  const DEMONYM = {
    american:'united states',chinese:'china',russian:'russia',indian:'india',japanese:'japan',
    german:'germany',french:'france',british:'united kingdom',canadian:'canada',ukrainian:'ukraine',
    iranian:'iran',iraqi:'iraq',syrian:'syria',turkish:'turkey',israeli:'israel',
    egyptian:'egypt',saudi:'saudi arabia',pakistani:'pakistan',korean:'south korea',
  };

  let datelineHits = 0, commaHits = 0, regexHits = 0, nlpHits = 0, demonymHits = 0, noLocation = 0;
  let totalRegexTime = 0, totalNlpTime = 0;

  timer.start('extraction_total');

  const extractionResults = [];

  for (const item of items) {
    const title = item.title || '';
    const desc  = item.description || '';
    let foundBy = null;
    let location = null;

    // Dateline
    const dm = DATELINE.exec(title) || DATELINE.exec(desc);
    if (dm) {
      const cand = dm[1].trim().toLowerCase();
      if (cand.length > 2 && !STOP.has(cand) && KNOWN[cand]) {
        foundBy = 'dateline'; location = dm[1].trim(); datelineHits++;
      }
    }

    // Comma pair
    if (!foundBy) {
      COMMA_PAIR.lastIndex = 0;
      const cm = COMMA_PAIR.exec(title) || (COMMA_PAIR.lastIndex = 0, COMMA_PAIR.exec(desc));
      if (cm) {
        const city = cm[1].trim().toLowerCase();
        if (city.length > 2 && !STOP.has(city) && KNOWN[city]) {
          foundBy = 'comma_pair'; location = cm[1].trim(); commaHits++;
        }
      }
    }

    // Regex
    if (!foundBy) {
      const rt0 = performance.now();
      for (const pat of LOC_PATTERNS) {
        pat.lastIndex = 0;
        const m = pat.exec(title);
        if (m) {
          const cand = m[1].trim().toLowerCase();
          if (cand.length > 2 && !STOP.has(cand) && KNOWN[cand]) {
            foundBy = 'regex'; location = m[1].trim(); regexHits++;
            break;
          }
        }
      }
      if (!foundBy) {
        for (const pat of LOC_PATTERNS) {
          pat.lastIndex = 0;
          const m = pat.exec(desc);
          if (m) {
            const cand = m[1].trim().toLowerCase();
            if (cand.length > 2 && !STOP.has(cand) && KNOWN[cand]) {
              foundBy = 'regex'; location = m[1].trim(); regexHits++;
              break;
            }
          }
        }
      }
      totalRegexTime += performance.now() - rt0;
    }

    // NLP
    if (!foundBy && nlpLib) {
      const nt0 = performance.now();
      try {
        const places = nlpLib(title).places().out('array');
        if (places && places.length > 0) {
          for (const p of places) {
            const key = p.trim().toLowerCase();
            if (key.length > 2 && !STOP.has(key) && KNOWN[key]) {
              foundBy = 'nlp'; location = p.trim(); nlpHits++;
              break;
            }
          }
        }
        if (!foundBy) {
          const descPlaces = nlpLib(desc).places().out('array');
          if (descPlaces && descPlaces.length > 0) {
            for (const p of descPlaces) {
              const key = p.trim().toLowerCase();
              if (key.length > 2 && !STOP.has(key) && KNOWN[key]) {
                foundBy = 'nlp'; location = p.trim(); nlpHits++;
                break;
              }
            }
          }
        }
      } catch { /* ignore */ }
      totalNlpTime += performance.now() - nt0;
    }

    // Demonym fallback
    if (!foundBy) {
      for (const word of (title + ' ' + desc).split(/\s+/)) {
        const lower = word.toLowerCase().replace(/[^a-z]/g, '');
        if (DEMONYM[lower] && KNOWN[DEMONYM[lower]]) {
          foundBy = 'demonym'; location = DEMONYM[lower]; demonymHits++;
          break;
        }
      }
    }

    if (!foundBy) noLocation++;
    extractionResults.push({ title: title.slice(0, 80), location, method: foundBy });
  }

  timer.stop('extraction_total');

  const total = items.length;
  const located = total - noLocation;
  console.log(`  Total items:     ${c.white}${total}${c.reset}`);
  console.log(`  Located:         ${c.green}${located}${c.reset} (${pct(located, total)})`);
  console.log(`  No location:     ${c.yellow}${noLocation}${c.reset} (${pct(noLocation, total)})`);
  console.log();
  console.log(`  ${'Method'.padEnd(16)} ${'Hits'.padStart(6)} ${'%'.padStart(8)}`);
  console.log(`  ${'─'.repeat(16)} ${'─'.repeat(6)} ${'─'.repeat(8)}`);
  for (const [label, count] of [['Dateline', datelineHits], ['Comma pair', commaHits], ['Regex', regexHits], ['NLP', nlpHits], ['Demonym', demonymHits]]) {
    console.log(`  ${label.padEnd(16)} ${String(count).padStart(6)} ${pct(count, located).padStart(8)}`);
  }
  console.log();
  console.log(`  Regex time:      ${c.white}${formatMs(totalRegexTime)}${c.reset}  (avg ${formatMs(totalRegexTime / Math.max(total, 1))}/item)`);
  console.log(`  NLP time:        ${c.white}${formatMs(totalNlpTime)}${c.reset}  (avg ${formatMs(totalNlpTime / Math.max(total, 1))}/item)`);
  console.log(`  Total:           ${c.white}${formatMs(timer.get('extraction_total'))}${c.reset}  (avg ${formatMs(timer.get('extraction_total') / Math.max(total, 1))}/item)`);

  return extractionResults;
}

// Helper: try to load compromise (CJS module from ESM context)
async function loadCompromise() {
  try {
    const { createRequire } = await import('node:module');
    const require = createRequire(import.meta.url);
    return require('compromise');
  } catch { return null; }
}

// ============================================================================
//  STAGE 6: Geocoding Benchmark
// ============================================================================
async function benchmarkGeocoding(timer, extractionResults, KNOWN) {
  sectionHeader('Stage 6 · Geocoding');

  let dictHits = 0, apiCalls = 0, apiFails = 0, skipped = 0;
  let dictTime = 0, apiTime = 0;

  timer.start('geocoding_total');

  const located = extractionResults.filter(r => r.location);
  const seen = new Set();

  for (const result of located) {
    const key = result.location.toLowerCase().trim();
    if (seen.has(key)) { skipped++; continue; }
    seen.add(key);

    const t0 = performance.now();
    if (KNOWN[key]) {
      dictHits++;
      dictTime += performance.now() - t0;
    } else {
      // Photon API call
      try {
        const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(result.location)}&limit=1&lang=en`;
        const res = await fetch(url, { headers: { 'User-Agent': 'Seraphim/1.0' }, signal: AbortSignal.timeout(5000) });
        if (res.ok) {
          const data = await res.json();
          if (data?.features?.length > 0) apiCalls++;
          else apiFails++;
        } else { apiFails++; }
      } catch { apiFails++; }
      apiTime += performance.now() - t0;
      // Respect rate limit
      await new Promise(r => setTimeout(r, 200));
    }
  }

  timer.stop('geocoding_total');

  const uniqueLocations = seen.size;
  console.log(`  Unique locations: ${c.white}${uniqueLocations}${c.reset}  (${skipped} deduped)`);
  console.log(`  Dict hits:        ${c.green}${dictHits}${c.reset} (${pct(dictHits, uniqueLocations)})  in ${formatMs(dictTime)}`);
  console.log(`  API calls:        ${c.yellow}${apiCalls}${c.reset}  in ${formatMs(apiTime)}`);
  console.log(`  API fails:        ${c.red}${apiFails}${c.reset}`);
  console.log(`  Total:            ${c.white}${formatMs(timer.get('geocoding_total'))}${c.reset}`);
}

// ============================================================================
//  SUMMARY TABLE
// ============================================================================
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

// ============================================================================
//  MAIN
// ============================================================================
async function main() {
  banner('SERAPHIM PIPELINE BENCHMARK');
  console.log(`  ${c.dim}Timestamp:  ${new Date().toISOString()}${c.reset}`);
  console.log(`  ${c.dim}Flags:      ${SKIP_SOCIAL ? '--skip-social ' : ''}${SKIP_GNEWS ? '--skip-gnews ' : ''}${QUICK_MODE ? '--quick' : 'full'}${c.reset}`);

  const timer = new Timer();

  // Stage 1
  const KNOWN = await benchmarkGeodataLoad(timer);

  // Stage 2
  const rssItems = await benchmarkRSS(timer);

  // Stage 3
  const gnewsItems = await benchmarkGNews(timer);

  // Stage 4
  const socialItems = await benchmarkSocial(timer);

  // Merge all items
  const allItems = [...rssItems, ...gnewsItems, ...socialItems];
  console.log(`\n  ${c.bold}Total articles across all sources: ${c.cyan}${allItems.length}${c.reset}`);

  // Stage 5
  const extractionResults = await benchmarkExtraction(timer, allItems, KNOWN);

  // Stage 6
  await benchmarkGeocoding(timer, extractionResults, KNOWN);

  // Summary
  printSummary(timer);
}

main().catch(err => {
  console.error(`${c.red}Fatal error:${c.reset}`, err);
  process.exit(1);
});
