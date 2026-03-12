import fs from 'fs';
import { performance } from 'perf_hooks';

const GRADED_RESULTS_PATH = 'scripts/results/graded-results.json';
const FAILURES_PATH = 'scripts/results/accuracy-failures.txt';

function normalize(val) {
  if (val === null || val === undefined) return null;
  if (typeof val === 'string' && val.toLowerCase() === 'null') return null;
  return String(val).toLowerCase().trim();
}

//npx tsx scripts/evaluate-accuracy.mjs

async function run() {
  const startTime = performance.now();
  try {
    // 1. Import the live geocoding logic
    // We do this inside run() to measure the load time if desired,
    // and because it's an async import in an ESM-like context if needed.
    const { extractLocation, geocodeLocation } = await import('../src/lib/geocoding');

    // 2. Load the human-graded ground truth
    if (!fs.existsSync(GRADED_RESULTS_PATH)) {
      console.error(`Error: Graded results file not found at ${GRADED_RESULTS_PATH}`);
      return;
    }
    const gradedResults = JSON.parse(fs.readFileSync(GRADED_RESULTS_PATH, 'utf8'));

    let passCount = 0;
    let totalCount = 0;
    let skippedCount = 0;
    const failures = [];

    console.log(`\nRunning live geocode accuracy test on ${gradedResults.length} cases...\n`);

    for (const item of gradedResults) {
      const isApproved = item.graded_status === 'approved';
      const rawExpected = isApproved 
        ? (item.final_mapped_location?.displayName || null)
        : item.expected_location;

      const normExpected = normalize(rawExpected);
      
      // Skip items with "ignore" or "default" in the expected notes
      if (normExpected && (normExpected.includes('ignore') || normExpected.includes('default'))) {
        skippedCount++;
        continue;
      }

      totalCount++;

      // --- LIVE RERUN LOGIC ---
      // Replicate the logic in extractLocation
      const ext = extractLocation(item.title, item.desc || '');
      let placeName = ext.match;
      const candidates = ext.candidates;

      // Determine actual location based on current logic
      let actualLocationFullName = null;
      if (placeName) {
        const geo = await geocodeLocation(placeName);
        if (geo) {
          actualLocationFullName = geo.displayName;
        }
      }
      
      const normActual = normalize(actualLocationFullName);

      let isCorrect = false;
      if (isApproved) {
        // "Don't care" about approved entries missing locations (likely defaults)
        // If it found nothing, we assume it's avoiding a default location correctly.
        // If it found something, it must match the approval.
        if (normActual === null || normActual === normExpected) {
          isCorrect = true;
        }
      } else {
        // For denied/manual entries, it must match exactly.
        if (normActual === normExpected) {
          isCorrect = true;
        }
      }

      if (isCorrect) {
        passCount++;
      } else {
        failures.push({
          title: item.title,
          description: item.desc,
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

      // Write all failures to a file for complete inspection
      const failureOutput = failures.map((f) => {
        const type = !f.actual ? 'MISS' : (!f.expected ? 'FALSE POS' : 'WRONG');
        const indentedDesc = f.description ? f.description.replace(/\n/g, '\n                ') : 'null';
        return `[${type}] ${f.title}\n      Desc:     ${indentedDesc}\n      Expected: ${f.expected || 'null'}\n      Actual:   ${f.actual || 'null'}\n      Found:    [${f.candidates.join(', ')}]\n      Grade:    ${f.statusInGraded}\n`;
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
