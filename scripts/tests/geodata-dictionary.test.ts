import { describe, expect, it } from 'vitest';
import { buildGeodata } from '../build/build-geodata.mjs';
import {
    getDefaultLocationCandidate,
    getLocationCandidates,
    KNOWN_LOCATIONS,
} from '@/lib/geocoding/dictionary';
import supplements from '../../data/geodata-supplements.json';
import { LANDMARKS } from '@/lib/geocoding/constants';

function cityRow(id: number, name: string, asciiName: string, aliases: string, cc: string, admin1: string, population: number, lat = 10, lon = 20): string {
    return [id, name, asciiName, aliases, lat, lon, 'P', 'PPL', cc, '', admin1, '', '', '', population].join('\t');
}

describe('reproducible GeoNames build', () => {
    it('retains the same identity and parent for singleton and ambiguous aliases', () => {
        const raw = [
            cityRow(101, 'Köln', 'Koeln', 'Cologne,Köln', 'DE', '07', 900000),
            cityRow(102, 'Cologne', 'Cologne', '', 'IT', '09', 7000, 45, 9),
        ].join('\n');
        const result = buildGeodata(raw, '', { cityAliases: { 101: ['Cologne'] } });
        expect(result.cities.koln).toMatchObject({ id: 101, cc: 'DE', a1: '07' });
        expect(result.cities.koeln).toEqual(result.cities.koln);
        const candidates = result.cityCandidates.cologne.split('|').map((entry: string) => entry.split(','));
        expect(candidates.map((entry: string[]) => parseInt(entry[0], 36))).toEqual([101, 102]);
        expect(candidates[0].slice(-2)).toEqual(['DE', '07']);
    });

    it('normalizes accent variants before deduplicating without losing true homonyms', () => {
        const result = buildGeodata([
            cityRow(101, 'São José', 'Sao Jose', '', 'BR', '26', 100000),
            cityRow(102, 'Sao Jose', 'Sao Jose', '', 'PH', '03', 5000),
        ].join('\n'), '');
        expect(Object.keys(result.cities)).toEqual(['sao jose']);
        expect(result.cityCandidates['sao jose'].split('|')).toHaveLength(2);
    });

    it('retains regions whose names also identify major cities', () => {
        const result = buildGeodata(cityRow(101, 'Example', 'Example', '', 'DE', '07', 900000), 'DE.07\tExample\tExample\t201');
        expect(result.cities.example.id).toBe(101);
        expect(result.admin1.example.id).toBe(201);
        expect(result.admin1Meta.example).toBe('DE.07');
    });

    it('adds Saint abbreviation aliases without importing arbitrary historical names or airport codes', () => {
        const result = buildGeodata(cityRow(101, 'Saint Petersburg', 'Saint Petersburg', 'LED,Leningrad,St. Petersburg', 'RU', '66', 5000000), '');
        expect(result.cities['st. petersburg']).toEqual(result.cities['saint petersburg']);
        expect(result.cities['st petersburg']).toEqual(result.cities['saint petersburg']);
        expect(result.cities.led).toBeUndefined();
        expect(result.cities.leningrad).toBeUndefined();
    });

    it('rejects unverified curated aliases instead of inventing place-name mappings', () => {
        expect(() => buildGeodata(cityRow(101, 'Example', 'Example', '', 'DE', '07', 900000), '', { cityAliases: { 101: ['Invented'] } })).toThrow('Unverified alias');
    });
});

describe('runtime geographic identities and coverage', () => {
    it('uses one German entity for Cologne and Köln while preserving the Italian homonym', () => {
        const candidates = getLocationCandidates('Cologne');
        expect(candidates.find(entry => entry.cc === 'DE')).toMatchObject({ id: 'geonames:2886242', admin1Code: 'DE.07' });
        expect(candidates.find(entry => entry.cc === 'IT')).toBeDefined();
        expect(getLocationCandidates('Köln').map(entry => entry.id)).toEqual(['geonames:2886242']);
    });

    it('deduplicates native and accent-normalized records by geographic ID', () => {
        const native = getLocationCandidates('São Paulo');
        const normalized = getLocationCandidates('Sao Paulo');
        expect(native).toEqual(normalized);
        expect(new Set(native.map(entry => entry.id)).size).toBe(native.length);
        expect(native.filter(entry => entry.id === 'geonames:3448439')).toHaveLength(1);
    });

    it('retains a singleton city parent for explicit location pairs', () => {
        expect(getLocationCandidates('Asheville')).toHaveLength(1);
        expect(getLocationCandidates('Asheville')[0]).toMatchObject({ id: 'geonames:4453066', cc: 'US', admin1Code: 'US.NC', type: 'city' });
    });

    it('keeps Flushing in both Michigan and Queens with their respective parents', () => {
        const candidates = getLocationCandidates('Flushing');
        expect(candidates).toEqual(expect.arrayContaining([
            expect.objectContaining({ id: 'geonames:4993022', admin1Code: 'US.MI' }),
            expect.objectContaining({ id: 'geonames:5117472', admin1Code: 'US.NY', lat: 40.77, lon: -73.82 }),
        ]));
        expect(getDefaultLocationCandidate('Flushing')).toBeNull();
    });

    it('uses one ID for manual city aliases while preserving hierarchy metadata', () => {
        const kyiv = getDefaultLocationCandidate('Kyiv');
        const kiev = getDefaultLocationCandidate('Kiev');
        expect(kyiv).toMatchObject({ id: 'geonames:703448', cc: 'UA', manual: true });
        expect(kiev?.id).toBe(kyiv?.id);
        expect(getLocationCandidates('Kyiv').filter(entry => entry.id === kyiv?.id)).toHaveLength(1);
    });

    it.each([['Yemen', 'YE'], ['Bahrain', 'BH'], ['Morocco', 'MA'], ['Niger', 'NE'], ['Mali', 'ML']])('keeps %s as a country when present in manual landmarks', (name, cc) => {
        const candidates = getLocationCandidates(name);
        expect(candidates.filter(entry => entry.id === `country:${cc}`)).toHaveLength(1);
        expect(KNOWN_LOCATIONS[name.toLowerCase()]).toMatchObject({ type: 'country', cc, id: `country:${cc}` });
        expect(candidates.some(entry => entry.id === `landmark:${name.toLowerCase()}`)).toBe(false);
    });

    it('retains Greenland territory and Barbados settlement as distinct candidates', () => {
        expect(getLocationCandidates('Greenland')).toEqual(expect.arrayContaining([
            expect.objectContaining({ type: 'country', cc: 'GL', lat: 72, lon: -40 }),
            expect.objectContaining({ type: 'city', cc: 'BB' }),
        ]));
    });

    it('retains regional fallbacks as coarse entities rather than point landmarks', () => {
        expect(getLocationCandidates('Caribbean')[0]).toMatchObject({ type: 'region', id: 'region:caribbean' });
        expect(getLocationCandidates('Caribbean Sea')[0]).toMatchObject({ type: 'region', id: 'marineregions:4287' });
        expect(getLocationCandidates('Mindanao')[0]).toMatchObject({ id: 'geonames:1699597', type: 'region', cc: 'PH' });
        expect(getLocationCandidates('Maguindanao del Sur')[0]).toMatchObject({ type: 'region', cc: 'PH', admin1Code: 'PH.14' });
        expect(getLocationCandidates('West New Britain')[0]).toMatchObject({ type: 'admin1', cc: 'PG', admin1Code: 'PG.17' });
    });

    it('resolves canonical country identities across Saint abbreviations', () => {
        const ids = ['Saint Lucia', 'St. Lucia', 'St Lucia'].map(name => getLocationCandidates(name).find(entry => entry.type === 'country')?.id);
        expect(ids).toEqual(['country:LC', 'country:LC', 'country:LC']);
    });

    it('retains distinct Congo country identities across full-name aliases', () => {
        expect(getLocationCandidates('Republic of Congo')).toEqual(expect.arrayContaining([
            expect.objectContaining({ id: 'country:CG', cc: 'CG' }),
        ]));
        expect(getLocationCandidates('Democratic Republic of Congo')).toEqual(expect.arrayContaining([
            expect.objectContaining({ id: 'country:CD', cc: 'CD' }),
        ]));
    });

    it.each(supplements.broadLandmarks)('classifies the representative point for %s as coarse', name => {
        const manual = getLocationCandidates(name).find(entry => entry.manual);
        expect(LANDMARKS[name]).toBeDefined();
        expect(manual).toBeDefined();
        expect(['country', 'admin1', 'region']).toContain(manual?.type);
    });

    it.each(['Pentagon', 'White House', 'Kremlin', 'Gaza City'])('retains %s as a point landmark', name => {
        expect(getDefaultLocationCandidate(name)?.type).toBe('landmark');
    });

    it('retains administrative identity when a coarse manual point replaces generated coordinates', () => {
        expect(getDefaultLocationCandidate('Sicily')).toMatchObject({ type: 'admin1', cc: 'IT', admin1Code: 'IT.15' });
        expect(getDefaultLocationCandidate('Bashkortostan')).toMatchObject({ type: 'admin1', cc: 'RU', admin1Code: 'RU.08' });
    });
});
