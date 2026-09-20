/**
 * Read-only geocoding evaluation before unresolved articles are dropped.
 * bun run scripts/diagnostics/generate-feed-geocoding-benchmark.ts --out artifacts/geocoding-review
 * Replay a saved NewsItem/database-row array without network: --input path/to/snapshot.json
 * Freeze expected labels in inputs.json before opening predictions.json.
 */
import fs from 'node:fs';
import path from 'node:path';
import { RSS_SOURCES } from '@/data/sources';
import { fetchSingleFeed } from '@/lib/api/rss';
import { resolveLocation } from '@/lib/geocoding';
import type { NewsItem } from '@/lib/core/types';
import { getQualityRejectionReason } from '@/scraper/utils/quality';
import { prepareIncomingItems } from '@/scraper/utils/content';

const DEFAULT_SOURCES = ['BBC World', 'Al Jazeera', 'NYT World', 'DW News', 'The Hindu', 'BBC Africa', 'The Guardian Australia', 'The Astana Times', 'Dawn Pakistan', 'ANTARA News', 'NPR US', 'NASA'];

type SnapshotItem = Partial<NewsItem> & {
  source_type?: NewsItem['sourceType'];
  published_at?: string;
};

async function run() {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log('Usage: bun run scripts/diagnostics/generate-feed-geocoding-benchmark.ts [--input snapshot.json] [--sources "NPR US,BBC World"] [--limit 200] [--out artifacts/geocoding-review]');
    return;
  }
  const allowed = new Set(['--input', '--sources', '--limit', '--out']);
  const options = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index], value = args[index + 1];
    if (!allowed.has(flag) || !value || value.startsWith('--')) throw new Error(`Invalid argument: ${flag}`);
    options.set(flag, value);
  }
  const limit = Number(options.get('--limit') ?? 200);
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error('--limit must be between 1 and 1000.');
  const outputDir = path.resolve(options.get('--out') ?? 'artifacts/geocoding-review');
  const outputPaths = ['inputs.json', 'predictions.json', 'summary.json'].map(name => path.join(outputDir, name));
  if (outputPaths.some(file => fs.existsSync(file))) throw new Error('Choose a new output directory to preserve existing labels and predictions.');

  const snapshotPath = options.get('--input');
  let snapshot: SnapshotItem[] = [];
  if (snapshotPath) {
    const parsed: unknown = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
    if (!Array.isArray(parsed) || parsed.some(item => !item || typeof item !== 'object')) throw new Error('Snapshot must be an array of article objects.');
    snapshot = parsed.slice(0, limit);
  } else {
    const names = [...new Set(options.get('--sources')?.split(',').map(name => name.trim()) ?? DEFAULT_SOURCES)];
    const sources = names.map(name => {
      const source = RSS_SOURCES.find(candidate => candidate.name === name);
      if (!source) throw new Error(`Unknown configured feed: ${name}`);
      return source;
    });
    for (let offset = 0; offset < sources.length && snapshot.length < limit; offset += 3) {
      const groups = await Promise.all(sources.slice(offset, offset + 3).map(source => fetchSingleFeed(source, 8000)));
      snapshot.push(...groups.flat());
    }
    snapshot = snapshot.slice(0, limit);
  }

  const inputs = snapshot.map((item, index) => ({
    id: String(item.id ?? index + 1),
    title: String(item.title ?? ''),
    description: String(item.description ?? ''),
    source: String(item.source ?? ''),
    sourceType: item.sourceType ?? item.source_type ?? 'rss',
    sourceCountryCode: item.sourceCountryCode ?? RSS_SOURCES.find(source => source.name === item.source)?.countryCode,
    url: String(item.url ?? ''),
    publishedAt: item.publishedAt ?? item.published_at ?? '',
  } satisfies NewsItem)).map(item => ({ ...item, geocoding_input: prepareIncomingItems([item])[0] ?? null }));
  fs.mkdirSync(outputDir, { recursive: true });
  // Write independent inputs first; do not include stored pins or candidate names.
  fs.writeFileSync(outputPaths[0], JSON.stringify(inputs, null, 2));
  const predictions = [];
  for (const item of inputs) {
    // Keep a raw-text replay for comparison with older audit snapshots, while
    // the primary result uses exactly the cleaned/capped ingestion input.
    const prepared = item.geocoding_input;
    const rawResult = await resolveLocation(item.title, item.description, {
      sourceName: item.source, countryCode: item.sourceCountryCode,
    });
    const engineResult = prepared
      ? (prepared.title === item.title && prepared.description === item.description ? rawResult
        : await resolveLocation(prepared.title, prepared.description ?? '', {
          sourceName: prepared.source, countryCode: prepared.sourceCountryCode,
        }))
      : null;
    predictions.push({ ...item, preparationRejected: !prepared,
      qualityRejection: prepared ? getQualityRejectionReason(prepared) : 'invalid_title_or_url',
      engine_result: engineResult, raw_engine_result: rawResult });
  }
  const summary = {
    generated_at: new Date().toISOString(),
    input: snapshotPath ?? 'fresh configured RSS feeds',
    total: predictions.length,
    qualityAccepted: predictions.filter(item => !item.qualityRejection).length,
    acceptedUnmapped: predictions.filter(item => !item.qualityRejection && !item.engine_result).length,
    textPreparationChanged: predictions.filter(item => item.geocoding_input &&
      (item.title !== item.geocoding_input.title || item.description !== item.geocoding_input.description)).length,
    warning: 'engine_result uses production text preparation; raw_engine_result preserves unprepared replay comparisons. Grade geocoding_input, including ambiguous and multi-location cases, before estimating accuracy. Unmapped is not the same as incorrect. Source selection is not random; per-item evaluation intentionally retains batch duplicates for review.',
  };
  fs.writeFileSync(outputPaths[1], JSON.stringify(predictions, null, 2));
  fs.writeFileSync(outputPaths[2], JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  console.log(`Blind inputs: ${outputPaths[0]}; predictions: ${outputPaths[1]}`);
}

run().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
