// Shared by the CLI evaluator and regression tests. Geographic containment is
// deliberately not a spelling alias: Kyiv and Ukraine are different results.
const ALIASES = {
  uk: 'united kingdom', usa: 'united states', 'u.s.': 'united states',
  america: 'united states', britain: 'united kingdom', kiev: 'kyiv',
  uae: 'united arab emirates',
};

export function normalizeLocationName(value) {
  if (value == null || String(value).trim().toLowerCase() === 'null') return null;
  const normalized = String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  return ALIASES[normalized] || normalized;
}

function hasCoordinates(value) {
  return Number.isFinite(value?.lat) && Number.isFinite(value?.lon)
    && Math.abs(value.lat) <= 90 && Math.abs(value.lon) <= 180;
}

function distanceKm(a, b) {
  const radians = degrees => degrees * Math.PI / 180;
  const h = Math.sin(radians(b.lat - a.lat) / 2) ** 2
    + Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(radians(b.lon - a.lon) / 2) ** 2;
  return 12_742 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, h))));
}

export function validateExpectedLocation(expected) {
  if (!expected || !Object.hasOwn(expected, 'displayName')) {
    throw new Error('Each graded case must have an explicit expected.displayName, including null for abstention.');
  }
  if (expected.lat != null || expected.lon != null) {
    if (!hasCoordinates(expected)) throw new Error('Expected coordinates must be a valid latitude/longitude pair.');
    if (expected.toleranceKm != null && (!Number.isFinite(expected.toleranceKm) || expected.toleranceKm < 0)) {
      throw new Error('Expected toleranceKm must be finite and nonnegative.');
    }
  }
  if (expected.bounds) {
    const { south, north, west, east } = expected.bounds;
    if (![south, north, west, east].every(Number.isFinite)
      || south < -90 || north > 90 || south > north || Math.abs(west) > 180 || Math.abs(east) > 180) {
      throw new Error('Expected bounds must contain valid south/north/west/east coordinates.');
    }
  }
  if (normalizeLocationName(expected.displayName) === null
    && (expected.lat != null || expected.lon != null || expected.bounds || expected.gazetteerId)) {
    throw new Error('An expected abstention cannot also require a geographic identity or coordinates.');
  }
}

export function scoreGeocoding(expected, actual) {
  validateExpectedLocation(expected);
  const expectedName = normalizeLocationName(expected.displayName);
  const actualName = normalizeLocationName(actual?.displayName);
  if (expectedName === null) return { correct: actualName === null, kind: actualName === null ? 'unmapped-correct' : 'false-pin' };
  if (actualName === null) return { correct: false, kind: 'miss' };
  if (actualName !== expectedName) return { correct: false, kind: 'wrong-place' };
  if (expected.gazetteerId && expected.gazetteerId !== actual.gazetteerId) {
    return { correct: false, kind: 'wrong-identity' };
  }
  if (expected.bounds || expected.lat != null) {
    if (!hasCoordinates(actual)) return { correct: false, kind: 'wrong-coordinate' };
    if (expected.bounds) {
      const { south, north, west, east } = expected.bounds;
      const longitudeMatches = west <= east
        ? actual.lon >= west && actual.lon <= east
        : actual.lon >= west || actual.lon <= east;
      if (actual.lat < south || actual.lat > north || !longitudeMatches) {
        return { correct: false, kind: 'wrong-coordinate' };
      }
    }
    if (expected.lat != null) {
      const km = distanceKm(expected, actual);
      if (km > (expected.toleranceKm ?? 25)) return { correct: false, kind: 'wrong-coordinate', distanceKm: km };
    }
  }
  return { correct: true, kind: 'mapped-correct' };
}
