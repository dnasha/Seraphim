/*
  Explicit human-reviewed geocoding regression suite.
  The golden fixture is immutable test data: database pins and a prior engine
  result must never be substituted for its expected value.
*/

import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { resolveLocation, ensureInitialized } from '@/lib/geocoding';
import { scoreGeocoding } from '../diagnostics/geocoding-score.mjs';
import { applyReviewedGeocodingPolicy } from '../diagnostics/reviewed-geocoding-policy.mjs';

const ACCURACY_THRESHOLD = 95;
const MAX_FALSE_PINS = 0;
const GOLDEN_PATH = path.resolve(__dirname, '../fixtures/geocoding-golden.v1.json');

interface GoldenCase {
    id: number;
    title: string;
    description?: string;
    grade: 'correct' | 'incorrect' | 'should-unmap' | 'unsure';
    expected: { displayName: string | null };
}

let cases: GoldenCase[] = [];

beforeAll(() => {
    ensureInitialized();
    cases = applyReviewedGeocodingPolicy(JSON.parse(fs.readFileSync(GOLDEN_PATH, 'utf8')), GOLDEN_PATH);
});

describe('geocoding accuracy regression', () => {
    it('places qualified labels in their expected regions without changing the golden labels', async () => {
        const regions = [
            { id: 19, lat: [30, 35], lon: [-86, -80] },
            { id: 23, lat: [45, 50], lon: [-125, -116] },
            { id: 34, lat: [25, 26], lon: [-101, -99] },
            { id: 42, lat: [38.7, 39.1], lon: [-77.3, -76.8] },
            { id: 46, lat: [38.7, 39.1], lon: [-77.3, -76.8] },
            { id: 63, lat: [33, 35], lon: [-120, -117] },
            { id: 116, lat: [40.7, 40.9], lon: [-74, -73.7] },
            { id: 130, lat: [33, 34], lon: [-88, -86] },
            { id: 146, lat: [24, 31], lon: [-88, -80] },
            { id: 150, lat: [48, 50], lon: [-124, -122] },
        ];
        for (const region of regions) {
            const item = cases.find(item => item.id === region.id)!;
            const actual = await resolveLocation(item.title, item.description || '');
            expect(actual, `case ${region.id}`).not.toBeNull();
            expect(actual!.lat).toBeGreaterThanOrEqual(region.lat[0]);
            expect(actual!.lat).toBeLessThanOrEqual(region.lat[1]);
            expect(actual!.lon).toBeGreaterThanOrEqual(region.lon[0]);
            expect(actual!.lon).toBeLessThanOrEqual(region.lon[1]);
        }
    });

    it('uses a populated, explicit human-reviewed 100–200 case fixture', () => {
        expect(fs.existsSync(GOLDEN_PATH)).toBe(true);
        expect(cases.length).toBeGreaterThanOrEqual(100);
        expect(cases.length).toBeLessThanOrEqual(200);
        for (const item of cases) {
            expect(item.expected).toHaveProperty('displayName');
            expect(['correct', 'incorrect', 'should-unmap', 'unsure']).toContain(item.grade);
        }
    });

    it(`maintains at least ${ACCURACY_THRESHOLD}% exact accuracy with no more than ${MAX_FALSE_PINS} false pins`, async () => {
        const reviewedCases = cases.filter(item => item.grade !== 'unsure');
        let correct = 0;
        let misses = 0;
        let wrong = 0;
        let falsePins = 0;

        for (const item of reviewedCases) {
            const actual = await resolveLocation(item.title, item.description || '');
            const score = scoreGeocoding(item.expected, actual);
            if (score.correct) correct++;
            else if (score.kind === 'false-pin') falsePins++;
            else if (score.kind === 'miss') misses++;
            else wrong++;
        }

        const accuracy = correct / reviewedCases.length * 100;
        console.log(`\nGeocoding Golden Report`);
        console.log(`  Cases:       ${reviewedCases.length} (${cases.length - reviewedCases.length} unsure excluded)`);
        console.log(`  Accuracy:    ${correct}/${reviewedCases.length} (${accuracy.toFixed(1)}%)`);
        console.log(`  Misses:      ${misses}`);
        console.log(`  Different non-null label: ${wrong} (includes more specific place names)`);
        console.log(`  False pins:  ${falsePins}\n`);

        expect(accuracy).toBeGreaterThanOrEqual(ACCURACY_THRESHOLD);
        expect(falsePins).toBeLessThanOrEqual(MAX_FALSE_PINS);
    });
});
