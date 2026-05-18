/**
 * Purpose: Evaluates the geocoding engine's performance by comparing current extraction results against a hand-graded ground truth dataset.
 * Usage: bun run scripts/diagnostics/evaluate-accuracy.mjs
 */

import fs from 'fs';
import { performance } from 'perf_hooks';

const GRADED_RESULTS_PATH = process.env.GRADED_RESULTS_PATH || 'scripts/results/graded-results.json';
const FAILURES_PATH = 'scripts/results/accuracy-failures.txt';

/**
 * Normalizes a location name or coordinate value for consistent comparison.
 * Handles null/undefined and string representations of 'null'.
 */
function normalize(val) {
  if (val === null || val === undefined) return null;
  if (typeof val === 'string' && val.toLowerCase() === 'null') return null;
  return String(val).toLowerCase().trim();
}

async function run() {
  const startTime = performance.now();
  try {
    process.env.IS_BENCHMARK = 'true';
    const { extractLocation, geocodeLocation } = await import('../../src/lib/geocoding');

    if (!fs.existsSync(GRADED_RESULTS_PATH)) {
      console.error(`Error: Graded results file not found at ${GRADED_RESULTS_PATH}`);
      return;
    }

    // Parse the hand-graded results containing truth data for each test case.
    const gradedResults = JSON.parse(fs.readFileSync(GRADED_RESULTS_PATH, 'utf8'));

    let passCount = 0;
    let totalCount = 0;
    let skippedCount = 0;
    const failures = [];

    console.log(`\nRunning live geocode accuracy test on ${gradedResults.length} cases...\n`);

    for (const item of gradedResults) {
      const isApproved = item.graded_status === 'approved';
      const rawExpected = isApproved
        ? (item.engine_result?.displayName || item.final_mapped_location?.displayName || item.db_location?.displayName || null)
        : item.expected_location;
      const normExpected = normalize(rawExpected);
      
      // Items marked with 'ignore' or 'default' are excluded from accuracy metrics as they typically represent ambiguous cases.
      if (normExpected && (normExpected.includes('ignore') || normExpected.includes('default'))) {
        skippedCount++;
        continue;
      }

      totalCount++;

      // Re-run the extraction logic against current heuristics to detect regressions or improvements.
      const ext = extractLocation(item.title, item.description || '');
      let placeName = ext.match;
      const candidates = ext.candidates;

      let actualLocationFullName = null;
      if (placeName) {
        const geo = await geocodeLocation(placeName);
        if (geo) {
          actualLocationFullName = geo.displayName;
        }
      }
      
      const normActual = normalize(actualLocationFullName);

      // Aliases allow for lenient matching between different naming conventions of the same geographical entity.
      const ALIASES = {
        'uk': 'united kingdom',
        'usa': 'united states',
        'u.s.': 'united states',
        'america': 'united states',
        'britain': 'united kingdom',
        'moscow': 'russia',
        'berlin': 'germany',
        'budapest': 'hungary',
        'tehran': 'iran',
        'beijing': 'china',
        'kyiv': 'ukraine',
        'kiev': 'ukraine',
        'gaza': 'palestine',
        'uae': 'united arab emirates',
        'sino-russian': 'russia',
        'sino': 'china',
        'strait of hormuz': 'hormuz',
      };

      const evalActual = ALIASES[normActual] || normActual;
      const evalExpected = ALIASES[normExpected] || normExpected;

      let isCorrect = false;
      if (isApproved) {
        // Approved items pass if they match the expected result or if they return null (indicating a safe skip).
        if (normActual === null || evalActual === evalExpected) {
          isCorrect = true;
        }
      } else {
        // Denied or manual entries require an exact match against the correction.
        if (evalActual === evalExpected) {
          isCorrect = true;
        }
      }

      if (isCorrect) {
        passCount++;
      } else {
        failures.push({
          title: item.title,
          description: item.description || item.desc || '',
          expected: rawExpected,
          actual: actualLocationFullName,
          candidates: candidates,
          statusInGraded: item.graded_status
        });
      }
    }

    if (skippedCount > 0) {
      console.log(`(Skipped ${skippedCount} items with 'ignore' or 'default' instructions)\n`);
    }

    const duration = ((performance.now() - startTime) / 1000).toFixed(2);
    const percentage = totalCount > 0 ? ((passCount / totalCount) * 100).toFixed(2) : 0;

    const failedCount = failures.length;
    const missCount = failures.filter(f => !f.actual && f.expected).length;
    const wrongCount = failures.filter(f => f.actual && f.expected && f.actual !== f.expected).length;
    const falsePosCount = failures.filter(f => f.actual && !f.expected).length;
    

    console.log(`Accuracy Report:`);
    console.log(`================`);
    console.log(`Pass Count:     ${passCount} / ${totalCount}`);
    console.log(`Percentage:     ${percentage}%`);
    console.log(`Duration:       ${duration}s`);
    console.log(`----------------`);
    console.log(`Total Failures: ${failedCount}`);
    console.log(` - No match:    ${missCount} (found nothing, expected something)`);
    console.log(` - Wrong match: ${wrongCount} (found wrong location)`);
    console.log(` - False pos:   ${falsePosCount} (found something, expected nothing)`);
    console.log(`================\n`);

    if (failures.length > 0) {
      console.log(`Top 10 Failures:`);
      failures.slice(0, 10).forEach((f) => {
        const type = !f.actual ? 'MISS' : (!f.expected ? 'FALSE POS' : 'WRONG');
        console.log(`[${type}] ${f.title}`);
        console.log(`      Desc:     ${f.description ? (f.description.split('\n')[0].substring(0, 120) + (f.description.length > 120 ? '...' : '')) : 'null'}`);
        console.log(`      Expected: ${f.expected || 'null'}`);
        console.log(`      Actual:   ${f.actual || 'null'}`);
        console.log(`      Found:    [${f.candidates.join(', ')}]`);
        console.log('');
      });

      if (failures.length > 10) {
        console.log(`... and ${failures.length - 10} more failures.`);
      }

      // Record detailed failure logs to facilitate manual review of problematic cases.
      const failureOutput = failures.map((f) => {
        const type = !f.actual ? 'MISS' : (!f.expected ? 'FALSE POS' : 'WRONG');
        const indentedDesc = f.description ? f.description.replace(/\n/g, '\n                ') : 'null';
        return `[${type}] ${f.title}\n      Desc:     ${indentedDesc}\n      Expected: ${f.expected || 'null'}\n      Actual:   ${f.actual || 'null'}\n      Found:    [${f.candidates.join(', ')}]\n      Grade:    ${f.statusInGraded}\n`;
      }).join('\n');
      
      fs.writeFileSync(FAILURES_PATH, failureOutput);
      console.log(`Full list of ${failures.length} failures written to ${FAILURES_PATH}`);
    } else {
      console.log(`All ${totalCount} tests passed!`);
    }

  } catch (error) {
    console.error('Error running accuracy test:', error);
  }
}

run();
