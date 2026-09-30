/*
  Seraphim Utility Function Tests
  Verifies core utilities for normalization, date parsing, and UI color mapping.
  These functions are fundamental to the geocoding and scraping pipelines.

  Usage: bun run test -- scripts/tests/utils.test.ts
*/

import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
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
        expect(normalizeAccents('Ångström')).toBe('Angstrom');
        expect(normalizeAccents('Ñoño')).toBe('Nono');
    });

    it('passes through plain ASCII unchanged', () => {
        expect(normalizeAccents('London')).toBe('London');
        expect(normalizeAccents('New York')).toBe('New York');
        expect(normalizeAccents('')).toBe('');
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
        expect(toTitleCase('kyiv')).toBe('Kyiv');
    });

    it('handles the special "dc" abbreviation', () => {
        expect(toTitleCase('washington dc')).toBe('Washington DC');
    });

    it('handles hyphenated words', () => {
        expect(toTitleCase('port-au-prince')).toBe('Port-Au-Prince');
        expect(toTitleCase('guinea-bissau')).toBe('Guinea-Bissau');
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
    const now = '2026-09-30T12:00:00.000Z';

    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(now));
    });

    afterEach(() => vi.useRealTimers());

    it('returns valid ISO for a standard ISO string', () => {
        const iso = '2026-04-10T16:35:00.000Z';
        expect(ensureIsoDate(iso)).toBe(iso);
    });

    it('parses RFC 2822 dates', () => {
        expect(ensureIsoDate('Thu, 10 Apr 2026 16:35:00 GMT')).toBe('2026-04-10T16:35:00.000Z');
    });

    it('handles CrisisWatch format', () => {
        // This feed supplies local time, so keep the expectation portable across TZs.
        expect(ensureIsoDate('Friday, April 10, 2026 - 16:35'))
            .toBe(new Date(2026, 3, 10, 16, 35).toISOString());
    });

    it('falls back to the current time for missing or unparseable dates', () => {
        for (const input of [null, undefined, '', 'not a date at all xyz']) {
            expect(ensureIsoDate(input), `input: ${String(input)}`).toBe(now);
        }
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

    it('returns brand indigo for non-social sources', () => {
        expect(getSourceStyle('Ars Technica').bg).toBe('#5f62ec');
        expect(getSourceStyle('BBC News').bg).toBe('#5f62ec');
    });
});
