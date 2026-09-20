import { describe, expect, it } from 'vitest';
import { normalizeLocationName, scoreGeocoding } from '../diagnostics/geocoding-score.mjs';

describe('geographic benchmark scoring', () => {
  it('does not count a homonymous point in the wrong country as correct', () => {
    expect(scoreGeocoding(
      { displayName: 'Greenland', bounds: { south: 59, north: 84, west: -74, east: -10 } },
      { displayName: 'Greenland', lat: 13.26, lon: -59.58 },
    )).toEqual({ correct: false, kind: 'wrong-coordinate' });
    expect(scoreGeocoding(
      { displayName: 'Greenland', bounds: { south: 59, north: 84, west: -74, east: -10 } },
      { displayName: 'Greenland', lat: 72, lon: -40 },
    ).correct).toBe(true);
  });

  it('normalizes spelling aliases without collapsing cities into countries', () => {
    expect(normalizeLocationName('Kiev')).toBe(normalizeLocationName('Kyiv'));
    expect(normalizeLocationName('UK')).toBe(normalizeLocationName('United Kingdom'));
    expect(normalizeLocationName('Bogotá')).toBe(normalizeLocationName('Bogota'));
    expect(scoreGeocoding({ displayName: 'Ukraine' }, { displayName: 'Kyiv' }).correct).toBe(false);
    expect(scoreGeocoding({ displayName: 'Palestine' }, { displayName: 'Gaza' }).correct).toBe(false);
  });

  it('enforces reviewed identity even when names and coordinates agree', () => {
    expect(scoreGeocoding(
      { displayName: 'Cambridge', gazetteerId: 'geonames:4931972' },
      { displayName: 'Cambridge', gazetteerId: 'geonames:2653941' },
    ).kind).toBe('wrong-identity');
  });

  it('requires actual coordinates whenever the fixture asks for a spatial assertion', () => {
    const expected = { displayName: 'London', lat: 51.5072, lon: -0.1276, toleranceKm: 5 };
    expect(scoreGeocoding(expected, { displayName: 'London' }).kind).toBe('wrong-coordinate');
    expect(scoreGeocoding(expected, { displayName: 'London', lat: NaN, lon: 0 }).correct).toBe(false);
    expect(scoreGeocoding(expected, { displayName: 'London', lat: 51.51, lon: -0.13 }).correct).toBe(true);
    expect(scoreGeocoding(expected, { displayName: 'London', lat: 42.98, lon: -81.25 }).kind).toBe('wrong-coordinate');
  });

  it('handles reviewed bounds crossing the antimeridian', () => {
    const expected = { displayName: 'Fiji', bounds: { south: -21, north: -12, west: 176, east: -178 } };
    expect(scoreGeocoding(expected, { displayName: 'Fiji', lat: -16, lon: -179 }).correct).toBe(true);
    expect(scoreGeocoding(expected, { displayName: 'Fiji', lat: -16, lon: 178 }).correct).toBe(true);
    expect(scoreGeocoding(expected, { displayName: 'Fiji', lat: -16, lon: 0 }).correct).toBe(false);
  });

  it('keeps misses and unsupported pins separate and rejects malformed annotations', () => {
    expect(scoreGeocoding({ displayName: 'London' }, null).kind).toBe('miss');
    expect(scoreGeocoding({ displayName: null }, null).kind).toBe('unmapped-correct');
    expect(scoreGeocoding({ displayName: null }, { displayName: 'London' }).kind).toBe('false-pin');
    expect(() => scoreGeocoding({ displayName: 'London', lat: 51 }, null)).toThrow(/coordinates/);
    expect(() => scoreGeocoding({ displayName: null, lat: 51, lon: 0 }, null)).toThrow(/abstention/);
    expect(() => scoreGeocoding({ displayName: 'London', bounds: { south: 52, north: 51, west: 0, east: 1 } }, null)).toThrow(/bounds/);
  });
});
