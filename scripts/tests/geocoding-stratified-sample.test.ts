import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { ensureInitialized, resolveLocation } from '@/lib/geocoding';

const SAMPLE_PATH = path.resolve(
  __dirname,
  '../fixtures/geocoding-uncorroborated-stratified.v1.json',
);

const REQUIRED_STRATA = [
  'ambiguous_name',
  'common_word_collision',
  'demonym',
  'affiliation',
  'sports_team',
  'multi_country',
  'dateline',
  'explicit_parent_pair',
] as const;

interface ReviewedSample {
  stratum: typeof REQUIRED_STRATA[number];
  db_id: string;
  event_count: number;
  title: string;
  description: string;
  current_location: string | null;
  expected: {
    displayName: string;
    lat: number;
    lon: number;
  } | null;
  review_note: string;
}

let samples: ReviewedSample[] = [];

beforeAll(() => {
  ensureInitialized();
  samples = JSON.parse(readFileSync(SAMPLE_PATH, 'utf8'));
});

describe('reviewed uncorroborated-event sample', () => {
  it('covers each required false-pin stratum with event_count = 1 rows', () => {
    expect(new Set(samples.map(sample => sample.stratum))).toEqual(new Set(REQUIRED_STRATA));
    for (const sample of samples) {
      expect(sample.event_count).toBe(1);
      expect(sample.db_id).toMatch(/^[0-9a-f-]{36}$/);
      expect(sample.review_note.length).toBeGreaterThan(10);
    }
  });

  it.each(REQUIRED_STRATA)('matches the reviewed %s outcome', async stratum => {
    const sample = samples.find(item => item.stratum === stratum);
    expect(sample).toBeDefined();

    const result = await resolveLocation(sample!.title, sample!.description);
    if (sample!.expected === null) {
      expect(result).toBeNull();
      return;
    }

    expect(result).not.toBeNull();
    expect(result!.displayName).toBe(sample!.expected.displayName);
    expect(result!.lat).toBeCloseTo(sample!.expected.lat, 4);
    expect(result!.lon).toBeCloseTo(sample!.expected.lon, 4);
  });
});
