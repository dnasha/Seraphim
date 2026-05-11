/*
  Seraphim Geocoding Accuracy Regression Suite

  This suite benchmarks the geocoding pipeline against a manually graded
  dataset (ground truth). It ensures that changes to NLP heuristics or
  the GeoNames dictionary do not regress the overall accuracy.
*/

import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { extractLocation, geocodeLocation, ensureInitialized } from '../../src/lib/geocoding';

/*
  ACCURACY_THRESHOLD
  The minimum percentage of correctly geocoded items required for the
  test suite to pass.
*/
const ACCURACY_THRESHOLD = 70;

const GRADED_RESULTS_PATH = path.resolve(__dirname, '../results/graded-results.json');

interface GradedResult {
    title: string;
    desc: string;
    graded_status: string;
    expected_location?: string;
    final_mapped_location?: {
        displayName?: string;
    };
    db_location?: {
        displayName?: string;
    };
}

/*
  normalize
  Standardizes strings for comparison by trimming, lowercasing,
  and handling 'null' string literals.
*/
function normalize(val: unknown): string | null {
    if (val === null || val === undefined) return null;
    if (typeof val === 'string' && val.toLowerCase() === 'null') return null;
    return String(val).toLowerCase().trim();
}

let gradedResults: GradedResult[] = [];
let testResults: { title: string; expected: string | null; actual: string | null; correct: boolean; type: string }[] = [];

beforeAll(() => {
    ensureInitialized();

    if (!fs.existsSync(GRADED_RESULTS_PATH)) {
        console.warn(`Graded results file not found at ${GRADED_RESULTS_PATH} - skipping accuracy tests.`);
        return;
    }
    gradedResults = JSON.parse(fs.readFileSync(GRADED_RESULTS_PATH, 'utf8'));
});

describe('geocoding accuracy regression', () => {
    it('graded results file exists and is populated', () => {
        expect(fs.existsSync(GRADED_RESULTS_PATH)).toBe(true);
        expect(gradedResults.length).toBeGreaterThan(0);
    });

    /*
      Accuracy Benchmark
      Iterates through the graded dataset, executes the live geocoding
      pipeline, and compares the results against the expected locations.
    */
    it(`maintains accuracy above ${ACCURACY_THRESHOLD}%`, async () => {
        let passCount = 0;
        let totalCount = 0;
        let skipCount = 0;
        testResults = [];

        for (const item of gradedResults) {
            const isApproved = item.graded_status === 'approved';
            
            /*
              Determine the expected location from the graded item.
              Approved items use the final mapped location; otherwise,
              we use the manually specified expected location.
            */
            const rawExpected = isApproved
                ? (item.final_mapped_location?.displayName || item.db_location?.displayName || null)
                : item.expected_location;

            const normExpected = normalize(rawExpected);

            // Skip items flagged for exclusion
            if (normExpected && (normExpected.includes('ignore') || normExpected.includes('default'))) {
                skipCount++;
                continue;
            }

            totalCount++;

            // Run the live geocoding pipeline
            const ext = extractLocation(item.title, item.desc || '');
            let actualLocationFullName: string | null = null;

            if (ext.match) {
                const geo = await geocodeLocation(ext.match);
                if (geo) {
                    actualLocationFullName = geo.displayName;
                }
            }

            const normActual = normalize(actualLocationFullName);

            /*
              Verification Logic
              Ensure that the actual geocoded result matches the expected ground truth.
              Previously, approved items allowed a 'null' result to pass, which hid
              regressions where the engine failed to find a previously identified location.
            */
            const isCorrect = normActual === normExpected;

            if (isCorrect) passCount++;

            const type = !actualLocationFullName
                ? 'MISS'
                : (!rawExpected ? 'FALSE_POS' : (isCorrect ? 'PASS' : 'WRONG'));

            testResults.push({
                title: item.title,
                expected: rawExpected || null,
                actual: actualLocationFullName,
                correct: isCorrect,
                type,
            });
        }

        const percentage = totalCount > 0 ? (passCount / totalCount) * 100 : 0;

        // Print accuracy summary to console for CI visibility
        const failures = testResults.filter(r => !r.correct);
        const misses = failures.filter(f => f.type === 'MISS').length;
        const wrongs = failures.filter(f => f.type === 'WRONG').length;
        const falsePos = failures.filter(f => f.type === 'FALSE_POS').length;

        console.log('\n--- Geocoding Accuracy Report ---');
        console.log(`  Total:      ${totalCount} (skipped: ${skipCount})`);
        console.log(`  Passed:     ${passCount}/${totalCount} (${percentage.toFixed(1)}%)`);
        console.log(`  Failures:   ${failures.length}`);
        console.log(`    No match: ${misses}`);
        console.log(`    Wrong:    ${wrongs}`);
        console.log(`    False+:   ${falsePos}`);
        console.log('----------------------------------');

        if (failures.length > 0) {
            console.log('\n  Top failures:');
            for (const f of failures.slice(0, 5)) {
                console.log(`  [${f.type}] ${f.title.slice(0, 80)}`);
                console.log(`         expected: ${f.expected || 'null'} → got: ${f.actual || 'null'}`);
            }
        }

        expect(percentage).toBeGreaterThanOrEqual(ACCURACY_THRESHOLD);
    });
});

