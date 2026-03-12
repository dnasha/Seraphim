import fs from 'fs';
import { performance } from 'perf_hooks';

const GRADED_RESULTS_PATH = 'scripts/results/graded-results.json';
const FAILURES_PATH = 'scripts/results/accuracy-failures.txt';

function normalize(val) {
  if (val === null || val === undefined) return null;
  if (typeof val === 'string' && val.toLowerCase() === 'null') return null;
  return String(val).toLowerCase().trim();
}

async function run() {
  const startTime = performance.now();
  try {
    // 1. Import the live geocoding logic
    // We do this inside run() to measure the load time if desired,
    // and because it's an async import in an ESM-like context if needed.
    const { extractLocation, geocodeLocation, NEWS_SOURCE_DEFAULTS } = await import('../src/lib/geocoding');

    // 2. Load the human-graded ground truth
    if (!fs.existsSync(GRADED_RESULTS_PATH)) {
      console.error(`Error: Graded results file not found at ${GRADED_RESULTS_PATH}`);
      return;
    }
    const gradedResults = JSON.parse(fs.readFileSync(GRADED_RESULTS_PATH, 'utf8'));

    let passCount = 0;
    let totalCount = 0;
    const failures = [];

    console.log(`\nRunning live geocode accuracy test on ${gradedResults.length} cases...\n`);

    for (const item of gradedResults) {
      totalCount++;

      // --- LIVE RERUN LOGIC ---
      // Replicate the logic in enrichItemsWithLocation
      const ext = extractLocation(item.title, item.desc || '');
      let placeName = ext.match;
      const candidates = ext.candidates;

      // Logic from enrichItemsWithLocation for fallback sources
      if (!placeName && item.source) {
        const srcKey = item.source.toLowerCase().trim();
        placeName = NEWS_SOURCE_DEFAULTS[srcKey] || null;
      }

      let actualLocationFullName = null;
      if (placeName) {
        const geo = await geocodeLocation(placeName);
        if (geo) {
          actualLocationFullName = geo.displayName;
        }
      }
      // -------------------------

      // Determine expected location
      let expectedLocationFullName;
      if (item.graded_status === 'approved') {
        // If approved, the location that was in the file at grading time is the correct one
        expectedLocationFullName = item.final_mapped_location?.displayName || null;
      } else {
        // If denied, the 'expected_location' field contains the manual correction
        expectedLocationFullName = item.expected_location;
      }

      const normExpected = normalize(expectedLocationFullName);
      const normActual = normalize(actualLocationFullName);

      if (normExpected === normActual) {
        passCount++;
      } else {
        failures.push({
          title: item.title,
          expected: expectedLocationFullName,
          actual: actualLocationFullName,
          candidates: candidates,
          statusInGraded: item.graded_status
        });
      }
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
        console.log(`      Expected: ${f.expected || 'null'}`);
        console.log(`      Actual:   ${f.actual || 'null'}`);
        console.log(`      Found:    [${f.candidates.join(', ')}]`);
        console.log('');
      });

      if (failures.length > 10) {
        console.log(`... and ${failures.length - 10} more failures.`);
      }

      // Write all failures to a file for complete inspection
      const failureOutput = failures.map((f) => {
        const type = !f.actual ? 'MISS' : (!f.expected ? 'FALSE POS' : 'WRONG');
        return `[${type}] ${f.title}\n      Expected: ${f.expected || 'null'}\n      Actual:   ${f.actual || 'null'}\n      Found:    [${f.candidates.join(', ')}]\n      Grade:    ${f.statusInGraded}\n`;
      }).join('\n');
      
      fs.writeFileSync(FAILURES_PATH, failureOutput);
      console.log(`Full list of ${failures.length} failures written to ${FAILURES_PATH}`);
    } else {
      console.log(`Perfect! All ${totalCount} tests passed with the current algorithm.`);
    }

  } catch (error) {
    console.error('Error running accuracy test:', error);
  }
}

run();
