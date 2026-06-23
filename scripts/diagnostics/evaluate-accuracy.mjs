/**
 * Evaluate a human-reviewed geocoding benchmark. Expectations must be explicit:
 * { expected: { displayName: string | null, lat?, lon?, toleranceKm? } }.
 *
 * Usage:
 *   GRADED_RESULTS_PATH=scripts/fixtures/geocoding-golden.v1.json bun run scripts/diagnostics/evaluate-accuracy.mjs
 */

import fs from 'fs';
import { performance } from 'perf_hooks';

const GRADED_RESULTS_PATH = process.env.GRADED_RESULTS_PATH || 'scripts/fixtures/geocoding-golden.v1.json';
const FAILURES_PATH = process.env.FAILURES_PATH || 'scripts/results/accuracy-failures.json';

const ALIASES = {
  uk: 'united kingdom', usa: 'united states', 'u.s.': 'united states',
  america: 'united states', britain: 'united kingdom', kiev: 'ukraine',
  kyiv: 'ukraine', gaza: 'palestine', uae: 'united arab emirates',
};

function normalize(value) {
  if (value == null || (typeof value === 'string' && value.toLowerCase() === 'null')) return null;
  const normalized = String(value).toLowerCase().trim();
  return ALIASES[normalized] || normalized;
}

function distanceKm(a, b) {
  const toRadians = degrees => degrees * Math.PI / 180;
  const earthRadiusKm = 6371;
  const dLat = toRadians(b.lat - a.lat);
  const dLon = toRadians(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(toRadians(a.lat)) * Math.cos(toRadians(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * earthRadiusKm * Math.asin(Math.sqrt(h));
}

function expectedFor(item) {
  if (!Object.hasOwn(item, 'expected') || !item.expected || !Object.hasOwn(item.expected, 'displayName')) {
    throw new Error(`Case ${item.id ?? item.title} has no explicit expected.displayName.`);
  }
  return item.expected;
}

function score(expected, actual) {
  const expectedName = normalize(expected.displayName);
  const actualName = normalize(actual?.displayName);
  if (expectedName === null) return { correct: actualName === null, kind: actualName === null ? 'unmapped-correct' : 'false-pin' };
  if (actualName === null) return { correct: false, kind: 'miss' };
  if (actualName !== expectedName) return { correct: false, kind: 'wrong-place' };
  if (expected.lat != null && expected.lon != null && actual?.lat != null && actual?.lon != null) {
    const km = distanceKm(expected, actual);
    if (km > (expected.toleranceKm ?? 25)) return { correct: false, kind: 'wrong-coordinate', distanceKm: km };
  }
  return { correct: true, kind: 'mapped-correct' };
}

function summarize(label, results) {
  const total = results.length;
  const correct = results.filter(result => result.score.correct).length;
  const counts = Object.groupBy(results, result => result.score.kind);
  console.log(`${label}: ${correct}/${total} (${total ? (correct / total * 100).toFixed(1) : '0.0'}%)`);
  console.log(`  mapped correct: ${(counts['mapped-correct'] || []).length}; unmapped correct: ${(counts['unmapped-correct'] || []).length}; misses: ${(counts.miss || []).length}; wrong place: ${(counts['wrong-place'] || []).length}; wrong coordinate: ${(counts['wrong-coordinate'] || []).length}; false pins: ${(counts['false-pin'] || []).length}`);
}

async function run() {
  const started = performance.now();
  process.env.IS_BENCHMARK = 'true';
  if (!fs.existsSync(GRADED_RESULTS_PATH)) throw new Error(`Benchmark file not found: ${GRADED_RESULTS_PATH}`);

  const benchmark = JSON.parse(fs.readFileSync(GRADED_RESULTS_PATH, 'utf8'));
  if (!Array.isArray(benchmark) || benchmark.length === 0) throw new Error('Benchmark must be a non-empty JSON array.');
  const { extractLocation, geocodeLocation } = await import('../../src/lib/geocoding/index.ts');
  const currentResults = [];
  const baselineResults = [];

  for (const item of benchmark) {
    if (item.grade === 'unsure') continue;
    const expected = expectedFor(item);
    const ext = extractLocation(item.title || '', item.description || '');
    const actual = ext.match ? await geocodeLocation(ext.match) : null;
    const baseline = item.engine_result || null;
    const shared = { id: item.id, db_id: item.db_id, title: item.title, expected, candidates: ext.candidates };
    currentResults.push({ ...shared, actual, score: score(expected, actual) });
    baselineResults.push({ ...shared, actual: baseline, score: score(expected, baseline) });
  }

  console.log(`\nGeocoding accuracy on ${currentResults.length} explicitly graded cases`);
  summarize('Baseline recorded in benchmark', baselineResults);
  summarize('Current extractor', currentResults);
  const failures = currentResults.filter(result => !result.score.correct);
  fs.writeFileSync(FAILURES_PATH, JSON.stringify({
    benchmark: GRADED_RESULTS_PATH,
    generated_at: new Date().toISOString(),
    failures,
  }, null, 2));
  console.log(`Failures: ${failures.length}; details: ${FAILURES_PATH}`);
  console.log(`Duration: ${((performance.now() - started) / 1000).toFixed(2)}s`);
  if (failures.length > 0) process.exitCode = 1;
}

run().catch(error => {
  console.error('Error running accuracy test:', error);
  process.exitCode = 1;
});
