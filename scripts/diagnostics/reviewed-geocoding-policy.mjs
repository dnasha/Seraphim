import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const fixtureDir = fileURLToPath(new URL('../fixtures/', import.meta.url));
const review = JSON.parse(fs.readFileSync(path.join(fixtureDir, 'geocoding-actor-country-policy.v2.json'), 'utf8'));

/** Apply only explicit, reviewed policy changes to the two repository fixtures. */
export function applyReviewedGeocodingPolicy(rows, fixturePath) {
  const resolved = path.resolve(fixturePath);
  const overrides = resolved === path.join(fixtureDir, 'geocoding-golden.v1.json') ? review.golden
    : resolved === path.join(fixtureDir, 'geocoding-uncorroborated-stratified.v1.json') ? review.stratified
      : [];
  for (const override of overrides) {
    const matches = rows.filter(row => override.db_id ? row.db_id === override.db_id : row.id === override.id);
    if (matches.length !== 1 || JSON.stringify(matches[0].expected) !== JSON.stringify(override.previousExpected)) {
      throw new Error(`Policy override no longer matches its reviewed input: ${override.db_id ?? override.id}`);
    }
  }
  return rows.map(row => {
    const override = overrides.find(candidate => candidate.db_id ? candidate.db_id === row.db_id : candidate.id === row.id);
    return override ? { ...row, expected: override.expected, policy_review: override.reason } : row;
  });
}
