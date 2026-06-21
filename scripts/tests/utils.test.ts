/*
  Seraphim Utility Function Tests
  Verifies core utilities for normalization, date parsing, and UI color mapping.
  These functions are fundamental to the geocoding and scraping pipelines.

  Usage: bun run test -- scripts/tests/utils.test.ts
*/

import { describe, it, expect } from 'vitest';
import { normalizeAccents, toTitleCase, cleanCandidate } from '@/lib/geocoding/utils';
import { ensureIsoDate } from '@/lib/utils/date';
import { getCategoryColor, getSourceStyle, DEFAULT_PIN_COLOR, CATEGORY_COLORS } from '@/lib/styles/colors';

/*
  normalizeAccents
  Tests removal of diacritics to ensure consistent dictionary matching.
*/
describe('normalizeAccents', () => {
    it('strips diacritics from accented characters', () => {
        expect(normalizeAccents('Irán')).toBe('Iran');
        expect(normalizeAccents('São Paulo')).toBe('Sao Paulo');
        expect(normalizeAccents('naïve')).toBe('naive');
        expect(normalizeAccents('Zürich')).toBe('Zurich');
        expect(normalizeAccents('Ödön')).toBe('Odon');
    });

    it('passes through plain ASCII unchanged', () => {
        expect(normalizeAccents('London')).toBe('London');
        expect(normalizeAccents('New York')).toBe('New York');
        expect(normalizeAccents('')).toBe('');
    });

    it('handles fully accented strings', () => {
        expect(normalizeAccents('Ångström')).toBe('Angstrom');
        expect(normalizeAccents('Ñoño')).toBe('Nono');
    });
});

/*
  toTitleCase
  Verifies proper capitalization, including abbreviations like DC and hyphenated names.
*/
describe('toTitleCase', () => {
    it('capitalizes each word', () => {
        expect(toTitleCase('new york')).toBe('New York');
        expect(toTitleCase('united states')).toBe('United States');
    });

    it('handles the special "dc" abbreviation', () => {
        expect(toTitleCase('washington dc')).toBe('Washington DC');
    });

    it('handles hyphenated words', () => {
        expect(toTitleCase('port-au-prince')).toBe('Port-Au-Prince');
        expect(toTitleCase('guinea-bissau')).toBe('Guinea-Bissau');
    });

    it('handles single word', () => {
        expect(toTitleCase('kyiv')).toBe('Kyiv');
    });

    it('handles empty/falsy input', () => {
        expect(toTitleCase('')).toBe('');
    });
});

/*
  cleanCandidate
  Tests sanitization of potential location strings extracted from text.
*/
describe('cleanCandidate', () => {
    it('strips possessives', () => {
        expect(cleanCandidate("Canada's")).toBe('Canada');
        expect(cleanCandidate("Ukraine\u2019s")).toBe('Ukraine');
    });

    it('strips trailing punctuation', () => {
        expect(cleanCandidate('Kyiv.')).toBe('Kyiv');
        expect(cleanCandidate('Moscow,')).toBe('Moscow');
        expect(cleanCandidate('London!')).toBe('London');
        expect(cleanCandidate('Paris?')).toBe('Paris');
        expect(cleanCandidate('Berlin")')).toBe('Berlin');
    });

    it('strips leading punctuation and dashes', () => {
        expect(cleanCandidate('"Kyiv')).toBe('Kyiv');
        expect(cleanCandidate('\u2014Moscow')).toBe('Moscow'); // em-dash
        expect(cleanCandidate('-London')).toBe('London');
    });

    it('strips trailing dashes', () => {
        expect(cleanCandidate('Damascus\u2014')).toBe('Damascus');
        expect(cleanCandidate('Aleppo-')).toBe('Aleppo');
    });

    it('trims whitespace', () => {
        expect(cleanCandidate('  Tokyo  ')).toBe('Tokyo');
    });

    it('handles compound edge cases', () => {
        expect(cleanCandidate('"Canada\'s,')).toBe('Canada');
    });
});

/*
  ensureIsoDate
  Validates normalization of various date formats into standard ISO strings.
*/
describe('ensureIsoDate', () => {
    it('returns valid ISO for a standard ISO string', () => {
        const iso = '2026-04-10T16:35:00.000Z';
        expect(ensureIsoDate(iso)).toBe(iso);
    });

    it('parses RFC 2822 dates', () => {
        const rfc = 'Thu, 10 Apr 2026 16:35:00 GMT';
        const result = ensureIsoDate(rfc);
        expect(result).toContain('2026-04-10');
        expect(new Date(result).getTime()).not.toBeNaN();
    });

    it('handles CrisisWatch format', () => {
        const crisisWatch = 'Friday, April 10, 2026 - 16:35';
        const result = ensureIsoDate(crisisWatch);
        expect(result).toContain('2026');
        expect(new Date(result).getTime()).not.toBeNaN();
    });

    it('returns current time for null/undefined', () => {
        const before = Date.now();
        const result = ensureIsoDate(null);
        const after = Date.now();
        const parsed = new Date(result).getTime();
        expect(parsed).toBeGreaterThanOrEqual(before - 1000);
        expect(parsed).toBeLessThanOrEqual(after + 1000);
    });

    it('returns current time for undefined', () => {
        const result = ensureIsoDate(undefined);
        expect(new Date(result).getTime()).not.toBeNaN();
    });

    it('returns current time for garbage strings', () => {
        const result = ensureIsoDate('not a date at all xyz');
        expect(new Date(result).getTime()).not.toBeNaN();
    });

    it('returns current time for empty string', () => {
        const result = ensureIsoDate('');
        expect(new Date(result).getTime()).not.toBeNaN();
    });
});

/*
  getCategoryColor
  Tests mapping of news categories to UI colors.
*/
describe('getCategoryColor', () => {
    it('returns correct hex for known categories', () => {
        expect(getCategoryColor('crisis')).toBe(CATEGORY_COLORS['crisis']);
        expect(getCategoryColor('world')).toBe(CATEGORY_COLORS['world']);
        expect(getCategoryColor('technology')).toBe(CATEGORY_COLORS['technology']);
        expect(getCategoryColor('science')).toBe(CATEGORY_COLORS['science']);
    });

    it('returns default for unknown category', () => {
        expect(getCategoryColor('nonexistent')).toBe(DEFAULT_PIN_COLOR);
    });

    it('returns default for undefined', () => {
        expect(getCategoryColor(undefined)).toBe(DEFAULT_PIN_COLOR);
    });
});

/*
  getSourceStyle
  Verifies consistent styling (colors and backgrounds) for known news sources.
*/
describe('getSourceStyle', () => {
    it('returns black bg for X/Twitter sources', () => {
        expect(getSourceStyle('OSINTdefender (X)').bg).toBe('#000000');
        expect(getSourceStyle('Some Twitter Account').bg).toBe('#000000');
    });

    it('returns Reddit orange for Reddit sources', () => {
        expect(getSourceStyle('Reddit - CombatFootage').bg).toBe('#ff4500');
    });

    it('returns Telegram blue for Telegram sources', () => {
        expect(getSourceStyle('Telegram - NEXTA').bg).toBe('#0088cc');
    });

    it('returns brand indigo for other sources', () => {
        expect(getSourceStyle('Ars Technica').bg).toBe('#6366f1');
        expect(getSourceStyle('BleepingComputer').bg).toBe('#6366f1');
    });

    it('returns brand indigo for unknown sources', () => {
        expect(getSourceStyle('BBC News').bg).toBe('#6366f1');
    });
});


