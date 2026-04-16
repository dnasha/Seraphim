/*
  Seraphim Accuracy Regression Suite

  Converts the graded-results.json dataset into a Vitest suite.
  Fails if accuracy drops below the configured threshold.
  Run: npm run test:accuracy
*/

import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { extractLocation, geocodeLocation, ensureInitialized } from '../../src/lib/geocoding';

// Minimum accuracy percentage to pass the suite
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
}

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
        console.warn(`Graded results file not found at ${GRADED_RESULTS_PATH} — skipping accuracy tests.`);
        return;
    }
    gradedResults = JSON.parse(fs.readFileSync(GRADED_RESULTS_PATH, 'utf8'));
});

describe('geocoding accuracy regression', () => {
    it('graded results file exists and is populated', () => {
        expect(fs.existsSync(GRADED_RESULTS_PATH)).toBe(true);
        expect(gradedResults.length).toBeGreaterThan(0);
    });

    it(`maintains accuracy above ${ACCURACY_THRESHOLD}%`, async () => {
        let passCount = 0;
        let totalCount = 0;
        let skipCount = 0;
        testResults = [];

        for (const item of gradedResults) {
            const isApproved = item.graded_status === 'approved';
            const rawExpected = isApproved
                ? (item.final_mapped_location?.displayName || null)
                : item.expected_location;

            const normExpected = normalize(rawExpected);

            // Skip items with "ignore" or "default" notes
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

            let isCorrect = false;
            if (isApproved) {
                if (normActual === null || normActual === normExpected) {
                    isCorrect = true;
                }
            } else {
                if (normActual === normExpected) {
                    isCorrect = true;
                }
            }

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

        // Print summary
        const failures = testResults.filter(r => !r.correct);
        const misses = failures.filter(f => f.type === 'MISS').length;
        const wrongs = failures.filter(f => f.type === 'WRONG').length;
        const falsePos = failures.filter(f => f.type === 'FALSE_POS').length;

        console.log('\n━━━ Geocoding Accuracy Report ━━━');
        console.log(`  Total:      ${totalCount} (skipped: ${skipCount})`);
        console.log(`  Passed:     ${passCount}/${totalCount} (${percentage.toFixed(1)}%)`);
        console.log(`  Failures:   ${failures.length}`);
        console.log(`    No match: ${misses}`);
        console.log(`    Wrong:    ${wrongs}`);
        console.log(`    False+:   ${falsePos}`);
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

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
