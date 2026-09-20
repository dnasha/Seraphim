/**
 * Evaluate a human-reviewed geocoding benchmark. Expectations must be explicit:
 * { expected: { displayName: string | null, lat?, lon?, toleranceKm? } }.
 *
 * Usage:
 *   GRADED_RESULTS_PATH=scripts/fixtures/geocoding-golden.v1.json bun run scripts/diagnostics/evaluate-accuracy.mjs
 */

import fs from 'fs';
import { performance } from 'perf_hooks';
import { scoreGeocoding, validateExpectedLocation } from './geocoding-score.mjs';
import { applyReviewedGeocodingPolicy } from './reviewed-geocoding-policy.mjs';

const GRADED_RESULTS_PATH = process.env.GRADED_RESULTS_PATH || 'scripts/fixtures/geocoding-golden.v1.json';
const FAILURES_PATH = process.env.FAILURES_PATH || 'scripts/results/accuracy-failures.json';

function expectedFor(item) {
  if (!Object.hasOwn(item, 'expected') || !item.expected || !Object.hasOwn(item.expected, 'displayName')) {
    throw new Error(`Case ${item.id ?? item.title} has no explicit expected.displayName.`);
  }
  validateExpectedLocation(item.expected);
  return item.expected;
}

function summarize(label, results) {
  const total = results.length;
  const correct = results.filter(result => result.score.correct).length;
  const counts = Object.groupBy(results, result => result.score.kind);
  console.log(`${label}: ${correct}/${total} (${total ? (correct / total * 100).toFixed(1) : '0.0'}%)`);
  console.log(`  mapped correct: ${(counts['mapped-correct'] || []).length}; unmapped correct: ${(counts['unmapped-correct'] || []).length}; misses: ${(counts.miss || []).length}; wrong place: ${(counts['wrong-place'] || []).length}; wrong identity: ${(counts['wrong-identity'] || []).length}; wrong coordinate: ${(counts['wrong-coordinate'] || []).length}; false pins: ${(counts['false-pin'] || []).length}`);
}

async function run() {
  const started = performance.now();
  process.env.IS_BENCHMARK = 'true';
  if (!fs.existsSync(GRADED_RESULTS_PATH)) throw new Error(`Benchmark file not found: ${GRADED_RESULTS_PATH}`);

  const originalBenchmark = JSON.parse(fs.readFileSync(GRADED_RESULTS_PATH, 'utf8'));
  if (!Array.isArray(originalBenchmark) || originalBenchmark.length === 0) throw new Error('Benchmark must be a non-empty JSON array.');
  const benchmark = applyReviewedGeocodingPolicy(originalBenchmark, GRADED_RESULTS_PATH);
  const { resolveLocation } = await import('../../src/lib/geocoding/index.ts');
  const currentResults = [];
  const baselineResults = [];

  for (const item of benchmark) {
    if (item.grade === 'unsure') continue;
    const expected = expectedFor(item);
    const actual = await resolveLocation(item.title || '', item.description || '', {
      sourceName: item.source,
      countryCode: item.sourceCountryCode,
    });
    const baseline = item.engine_result || null;
    const shared = { id: item.id, db_id: item.db_id, title: item.title, expected, candidates: actual?.candidates ?? [] };
    currentResults.push({ ...shared, actual, score: scoreGeocoding(expected, actual) });
    if (Object.hasOwn(item, 'engine_result')) {
      baselineResults.push({ ...shared, actual: baseline, score: scoreGeocoding(expected, baseline) });
    }
  }

  console.log(`\nGeocoding accuracy on ${currentResults.length} explicitly graded cases`);
  console.log(`  Reviewed actor-country policy overrides: ${benchmark.filter(item => item.policy_review).length}`);
  if (baselineResults.length) summarize('Baseline recorded in benchmark', baselineResults);
  summarize('Current production resolver', currentResults);
  const spatialCases = currentResults.filter(({ expected }) => expected.bounds || expected.lat != null || expected.gazetteerId).length;
  console.log(`  Spatial/identity assertions: ${spatialCases}; unsure excluded: ${benchmark.length - currentResults.length}`);
  const failures = currentResults.filter(result => !result.score.correct);
  fs.writeFileSync(FAILURES_PATH, JSON.stringify({
    benchmark: GRADED_RESULTS_PATH,
    generated_at: new Date().toISOString(),
    resolver: 'resolveLocation',
    reviewed_count: currentResults.length,
    spatial_assertion_count: spatialCases,
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
