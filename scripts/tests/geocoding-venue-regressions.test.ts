import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveLocation } from '@/lib/geocoding/engine';

interface CoordinateCase {
    id: string;
    title: string;
    description: string;
    expected: { lat: number; lon: number; toleranceKm: number } | null;
}

const fixture: { cases: CoordinateCase[] } = JSON.parse(readFileSync(path.resolve(
    __dirname, '../fixtures/geocoding-venue-regressions.v1.json',
), 'utf8'));

function distanceKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
    const radians = (degrees: number) => degrees * Math.PI / 180;
    const h = Math.sin(radians(b.lat - a.lat) / 2) ** 2 +
        Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(radians(b.lon - a.lon) / 2) ** 2;
    return 6371 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
}

describe('independently labeled event venue coordinates', () => {
    it.each(fixture.cases)('$id: $title', async row => {
        const result = await resolveLocation(row.title, row.description);
        if (!row.expected) {
            expect(result).toBeNull();
            return;
        }
        expect(result).not.toBeNull();
        expect(distanceKm(result!, row.expected)).toBeLessThanOrEqual(row.expected.toleranceKm);
    });

    it('does not fall back to a child that contradicts its explicit parent', async () => {
        const result = await resolveLocation('Fire in Cologne, Portugal', '');
        expect(result?.gazetteerId).toBe('country:PT');
    });

    it('retains a manually positioned city when its municipal admin record shares the name', async () => {
        const result = await resolveLocation('Russian drones strike Odesa, Ukraine', '');
        expect(distanceKm(result!, { lat: 46.48, lon: 30.73 })).toBeLessThan(25);
    });

    it('retains a complete regional name instead of its US city fragment', async () => {
        const result = await resolveLocation('Storm hits West New Britain', '');
        expect(result?.lat).toBeLessThan(0);
        expect(result?.lon).toBeGreaterThan(140);
    });

    it('keeps a complete province name containing a lowercase connector', async () => {
        const result = await resolveLocation('Clashes in Maguindanao del Sur, Philippines', '');
        expect(result?.candidates.some(candidate => candidate.id === result.gazetteerId && candidate.cc === 'PH')).toBe(true);
        expect(result?.lat).toBeGreaterThan(5);
        expect(result?.lat).toBeLessThan(8);
    });

    it('distinguishes a reporting account from the damaged site', async () => {
        const result = await resolveLocation('Dnipro Osint says satellite images show damage in Oryol region', '');
        expect(result?.lat).toBeCloseTo(52.97, 1);
        expect(result?.lon).toBeCloseTo(36.08, 1);
    });

    it('uses a stated facility vicinity above a historical attacking country', async () => {
        const result = await resolveLocation(
            'Iran rebuilds a facility previously bombed by Israel',
            'The facility is located at Parchin, some 30 kilometers southeast of Tehran. It was hit by Israel in an earlier attack.',
        );
        expect(result?.candidates.some(candidate => candidate.id === result.gazetteerId && candidate.cc === 'IR')).toBe(true);
    });

    it('does not infer a venue from a sports team or a surname nationality', async () => {
        await expect(resolveLocation('Moldovan’s OT goal lifts Boonton over Mountain Lakes in defensive battle', 'Bombers snap three-game losing streak')).resolves.toBeNull();
    });

    it('preserves an actual dateline when there is no other venue', async () => {
        const result = await resolveLocation('LYON (AP) - Officials announce emergency measures', '');
        expect(distanceKm(result!, { lat: 45.764, lon: 4.836 })).toBeLessThan(25);
    });

    it.each([
        ['Flooding in the Republic of Congo destroys homes', 'country:CG'],
        ['Flooding in the Democratic Republic of Congo destroys homes', 'country:CD'],
        ['Jordan announces new energy policy', 'country:JO'],
        ['Turkey announces new energy policy', 'country:TR'],
    ])('preserves genuine country language: %s', async (title, id) => {
        expect((await resolveLocation(title, ''))?.gazetteerId).toBe(id);
    });
});

describe('main actor fallback with venue precedence', () => {
    it.each([
        ['Canadian pension fund buys shares in Japanese company', 'country:CA'],
        ['British researchers discover a new material', 'country:GB'],
        ['US firm announces a new investment', 'country:US'],
        ['France and Germany debate a new trade accord', 'country:FR'],
        ['Trump administration changes federal policy', 'country:US'],
        ['White House announces a new policy', 'country:US'],
        ['Kremlin announces a new policy', 'country:RU'],
    ])('uses the explicit principal actor when a venue is unavailable: %s', async (title, id) => {
        const result = await resolveLocation(title, '');
        expect(result?.gazetteerId).toBe(id);
        expect(result?.evidence).toBe('actor_country');
    });

    it.each([
        ['Yemeni man assaults driver in UK', 'country:GB'],
        ['Yemeni man assaults driver in U.S.', 'country:US'],
        ["Japan's Kanadevia to tap European demand with Italy biogas plant", 'country:IT'],
    ])('keeps the event country above the actor nationality: %s', async (title, id) => {
        expect((await resolveLocation(title, ''))?.gazetteerId).toBe(id);
    });

    it('keeps a foreign venue above an administration actor', async () => {
        const result = await resolveLocation('Trump administration officials hold a meeting in Nairobi, Kenya', '');
        expect(distanceKm(result!, { lat: -1.28, lon: 36.82 })).toBeLessThan(25);
    });

    it.each([
        ['French lawmakers pass a resolution in Brussels', 50.85, 4.35],
        ['American cinema festival opens in Cannes', 43.55, 7.02],
    ])('keeps a venue above a cultural or legislative subject: %s', async (title, lat, lon) => {
        expect(distanceKm((await resolveLocation(title, ''))!, { lat, lon })).toBeLessThan(25);
    });

    it('keeps a legislative action with its actor rather than a foreign sanctions target', async () => {
        const result = await resolveLocation('The U.S. House of Representatives has passed a bill imposing tough sanctions against Russia and Iran', '');
        expect(result?.gazetteerId).toBe('country:US');
    });

    it('uses a weak source prior before an ambiguous city default', async () => {
        const result = await resolveLocation('Major fire breaks out in London', 'Fire crews are evacuating residents.', { countryCode: 'CA' });
        expect(distanceKm(result!, { lat: 42.98, lon: -81.25 })).toBeLessThan(25);
    });

    it('keeps an explicit foreign parent above the source prior', async () => {
        const result = await resolveLocation('Major fire breaks out in London, England', '', { countryCode: 'CA' });
        expect(distanceKm(result!, { lat: 51.51, lon: -0.13 })).toBeLessThan(25);
    });

    it('does not infer nationality from a personal name without country evidence', async () => {
        await expect(resolveLocation('Trump unveils a new portrait online', '')).resolves.toBeNull();
    });
});

describe('held-out article regression controls', () => {
    it('keeps the country of a musical performance above the visiting politician', async () => {
        const result = await resolveLocation(
            'Anwar was on song in India. Will Malaysia reap the rewards?',
            'Malaysia’s Prime Minister Anwar Ibrahim caused a stir in India with his spirited rendition of a Bollywood classic. A video of Anwar singing was posted online.',
        );
        expect(result?.gazetteerId).toBe('country:IN');
    });

    it('does not turn a cited publisher into an event location', async () => {
        const result = await resolveLocation(
            "Trump administration destabilized by AI surge ahead of Xi Jinping's visit",
            'An AI error nearly led the US military to board a Chinese ship near the Strait of Hormuz. Trump fears a recession, according to The New York Times.',
            { sourceName: 'Le Monde France' },
        );
        expect(result?.displayName).toMatch(/Hormuz/);
    });

    it('preserves an actual city mention when a publisher with that city is cited', async () => {
        const result = await resolveLocation('Fire in New York', 'Crews fought a fire in New York, according to The New York Times.');
        expect(distanceKm(result!, { lat: 40.71, lon: -74.01 })).toBeLessThan(25);
    });

    it('retains an explicit protected region when the named airbase is unresolved', async () => {
        const result = await resolveLocation(
            'Falklands RAF’s Voyager tanker back in MPA after support of US efforts in Iran',
            'RAF air defenses protecting the Falklands Islands have been bolstered by re-deployment of a Voyager tanker back to Mount Pleasant airbase.',
        );
        expect(result?.displayName).toBe('Falklands');
        expect(result?.lat).toBeLessThan(-50);
        expect(result?.lon).toBeLessThan(-50);
    });

    it('does not use an incidental region to resolve an ambiguous facility', async () => {
        await expect(resolveLocation('New project at Mount Pleasant airbase', 'The report also discusses the Falklands.')).resolves.toBeNull();
    });

    it('keeps a current court venue above a hometown and the location of historical crimes', async () => {
        const result = await resolveLocation(
            'The deradicalization speech of a jihadist on trial for beheadings in Syria',
            'The man from Montpellier told the Paris special criminal court that his imprisonment in France had changed his views.',
        );
        expect(distanceKm(result!, { lat: 48.85, lon: 2.35 })).toBeLessThan(25);
    });

    it.each([
        'CNN, MS NOW, Politico reporters denied access to White House following Trump ban',
        'Trump says he is banning CNN, MS NOW and Politico from the White House',
    ])('does not replace a physical landmark with a source-country city homonym: %s', async title => {
        const result = await resolveLocation(title, '', { sourceName: 'NPR', countryCode: 'US' });
        expect(result?.gazetteerId).toBe('landmark:white house');
        expect(distanceKm(result!, { lat: 38.897, lon: -77.036 })).toBeLessThan(5);
    });

    it('does not interpret a list of native districts as a child-parent pair', async () => {
        const result = await resolveLocation(
            'Kohat Police Lines attack: clearance operation concludes',
            'PESHAWAR: Police completed the operation after an attack in Kohat. Bodies were transported to their native districts of Kohat, Karak, Lakki Marwat, Bannu and Mardan.',
        );
        expect(distanceKm(result!, { lat: 33.58, lon: 71.45 })).toBeLessThan(25);
    });

    it('preserves a dateline after a bullet summary and ignores sibling-region lists', async () => {
        const result = await resolveLocation(
            'Government finalises civil service reforms',
            '• New professional cadres proposed\nISLAMABAD: The federal government announced civil service reforms. Quota seats will be reserved for Balochistan, Sindh, minorities and women.',
        );
        expect(distanceKm(result!, { lat: 33.72, lon: 73.04 })).toBeLessThan(25);
    });

    it('does not demote a reporting dateline for a background event late in the description', async () => {
        const result = await resolveLocation(
            'Pakistan rejects Taliban dialogue remarks',
            'ISLAMABAD: Pakistan said it had pursued dialogue with the Afghan Taliban. Responding to Kabul, officials requested cooperation. Later statements referred to an earlier attack in Kohat.',
        );
        expect(distanceKm(result!, { lat: 33.72, lon: 73.04 })).toBeLessThan(25);
    });

    it('does not locate a school team at a homonymous city', async () => {
        await expect(resolveLocation('Football photos: Winslow at St. Augustine, Sept. 19. 2026', 'A pair of 3-0 WJFL-American teams going into this matchup')).resolves.toBeNull();
    });

    it('does not select a counterfactual speech destination', async () => {
        const result = await resolveLocation(
            'Carney says Canada is strong as ties deepen',
            'The speech marks strained relations with the United States, with a message that would more likely have been delivered in Washington than Brussels.',
        );
        expect(result?.gazetteerId).toBe('country:CA');
    });

    it('uses the explicitly identified institutional actor above rhetorical capitals', async () => {
        const result = await resolveLocation(
            'People’s Daily rejects US claims of malicious AI distillation',
            'China’s ruling Communist Party mouthpiece rejected US allegations. Beijing would respond if Washington continued to suppress China’s AI industry.',
        );
        expect(result?.gazetteerId).toBe('country:CN');
    });

    it.each([
        ["Japan's biomass energy boom threatens further deforestation in Indonesia", '', 'country:ID'],
        ["Russia's war in Ukraine is rooted in Moscow's imperial ambitions", '', 'country:UA'],
        ["Russia hits train on Ukraine's border with Poland", 'The route is used by foreign delegations returning from Kyiv.', 'country:UA'],
        ['Why is Trump warning Zelenskyy not to hit Russian diesel refineries?', "Ukraine's strikes target oil supplies, which Kyiv says fuel the war.", 'country:RU'],
        ['Drones hit Russian military bases in Syria', '', 'country:SY'],
    ])('keeps the actual affected geography: %s', async (title, description, expectedId) => {
        expect((await resolveLocation(title, description))?.gazetteerId).toBe(expectedId);
    });

    it('recognizes the stated capital as a venue rather than the attacking nationality', async () => {
        const result = await resolveLocation("Russia's Kapotnya Oil Refinery is on fire after a Ukrainian drone raid on the Russian capital, Moscow.", '');
        expect(distanceKm(result!, { lat: 55.75, lon: 37.62 })).toBeLessThan(25);
    });

    it('does not collapse a later multi-place sector to its first city', async () => {
        const result = await resolveLocation('Ukraine advances', "The analysis examines Ukraine's Lyman counteroffensive. A counterpoint describes tanks in the Donetsk-Dnipropetrovsk-Zaporizhzhia sector.");
        expect(result?.displayName).toMatch(/^Lyman/);
        expect(result?.lat).toBeGreaterThan(48.8);
        expect(result?.lat).toBeLessThan(49.2);
    });

    it('does not interpret America inside a complete continental name as the US', async () => {
        const result = await resolveLocation('Company announces expansion across North America', '');
        expect(result?.displayName).toBe('North America');
        expect(result?.gazetteerId).not.toBe('country:US');
    });
});
