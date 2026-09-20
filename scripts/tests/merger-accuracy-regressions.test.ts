import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DbEvent } from '@/types';

const vectors = vi.hoisted(() => ({ generate: vi.fn(async (texts: string[]) => texts.map(() => [1, ...Array(383).fill(0)])) }));
vi.mock('@/lib/utils/vectorize', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/utils/vectorize')>(), generateEmbeddings: vectors.generate,
}));
import { resolveStoryMerges } from '@/scraper/merger';
import { hasConflictingStoryEvidence, hasPreciseLocation, passesSemanticThreshold } from '@/scraper/storyMatching';

const event = (overrides: Partial<DbEvent> = {}): DbEvent => ({
  title: 'Factory explosion in Bristol kills 12 workers',
  description: 'An explosion at the Avonmouth factory killed workers on Monday.',
  url: 'https://publisher.example/report', source: 'Publisher', source_type: 'rss',
  latitude: 51.4545, longitude: -2.5879, location_name: 'Bristol',
  published_at: '2026-09-19T10:00:00Z', credibility_tier: 2, sources: [], event_count: 1,
  ...overrides,
});
const row = (id: string, overrides: Partial<DbEvent> = {}) => ({
  ...event({ url: `https://existing.example/${id}`, published_at: '2026-09-19T09:00:00Z', ...overrides }), id, impact_score: 1.5,
});
function database(rows: ReturnType<typeof row>[] = [], scores: number[] = [], fallback = false) {
  const details = vi.fn(async (_key: string, ids: string[]) => ({ data: rows.filter(row => ids.includes(row.id)), error: null }));
  const db = {
    from() {
      const query = { select: () => query, gte: () => query, order: () => query, not: () => query,
        range: async () => ({ data: rows, error: null }), in: details };
      return query;
    },
    rpc: vi.fn(async (_name: string, args: { p_queries: { query_index: number }[]; p_limit: number }) => ({
      error: fallback ? { message: 'matcher not deployed' } : null,
      data: fallback ? null : args.p_queries.flatMap(query => rows.slice(0, args.p_limit).map((row, i) => ({
        query_index: query.query_index, event_id: row.id, similarity: scores[i] ?? 0.9,
        latitude: row.latitude, longitude: row.longitude, location_name: row.location_name,
      }))),
    })),
  };
  return { db, details };
}

describe('incident identity regression checks', () => {
  beforeEach(() => { vectors.generate.mockClear(); });

  it('merges an updated casualty count from the same publisher in both resolver paths', async () => {
    const first = event();
    const second = event({ title: 'Factory explosion in Bristol kills 13 workers',
      description: 'The death toll at the Avonmouth factory rose to 13.', url: 'https://publisher.example/update' });
    const batch = await resolveStoryMerges([first, second], database().db as never);
    expect(batch.newEvents).toHaveLength(1);
    const existing = row('factory', first);
    const stored = await resolveStoryMerges([second], database([existing], [0.94]).db as never);
    expect([...stored.merges.keys()]).toEqual(['factory']);
  });

  it('accepts a casualty update after three days through a recently active cluster', async () => {
    const existing = row('factory', { published_at: '2026-09-19T09:00:00Z', primary_discovered_at: '2026-09-16T09:00:00Z',
      description: 'An explosion at a Bristol factory killed workers on Wednesday.' });
    const incoming = event({ title: 'Factory explosion in Bristol kills 13 workers',
      description: 'An injured worker died in hospital three days later on Saturday.', url: 'https://publisher.example/update' });
    const result = await resolveStoryMerges([incoming], database([existing], [0.94]).db as never);
    expect([...result.merges.keys()]).toEqual(['factory']);
  });

  it('tries a valid runner-up after rejecting a dated edition with the highest score', async () => {
    const incoming = event({ title: 'Russian Offensive Campaign Assessment, September 19, 2026' });
    const candidates = [row('old-edition', { title: 'Russian Offensive Campaign Assessment, September 18, 2026' }),
      row('same-edition', { title: 'Russian Offensive Campaign Assessment for September 19, 2026' })];
    const { db, details } = database(candidates, [0.99, 0.9]);
    const result = await resolveStoryMerges([incoming], db as never);
    expect(details).toHaveBeenCalledWith('id', ['old-edition', 'same-edition']);
    expect([...result.merges.keys()]).toEqual(['same-edition']);
    expect(db.rpc).toHaveBeenCalledOnce();
  });

  it('expands a full blocked page to find a qualifying thirteenth candidate', async () => {
    const candidates = Array.from({ length: 12 }, (_, index) => row(`far-${index}`, {
      title: 'Factory explosion damages buildings in Singapore', latitude: 1.3521, longitude: 103.8198, location_name: 'Singapore',
    }));
    candidates.push(row('local', { title: 'Avonmouth factory explosion kills a dozen workers' }));
    const { db } = database(candidates, Array(13).fill(0.8));
    const result = await resolveStoryMerges([event()], db as never);
    expect(db.rpc.mock.calls.map(call => call[1].p_limit)).toEqual([12, 50]);
    expect([...result.merges.keys()]).toEqual(['local']);
  });

  it('expands only blocked query indices and never reruns an exact match', async () => {
    const title = "Korea wins men's football at Asian Games";
    const candidates = Array.from({ length: 12 }, (_, index) => row(`football-${index}`, { title }));
    candidates.push(row('volleyball', { title: "Korea wins the women's volleyball contest at Asian Games" }));
    const { db } = database(candidates);
    const result = await resolveStoryMerges([event({ title }), event({ title: "Korea wins women's volleyball at Asian Games", url: 'https://b.example/volleyball' })], db as never);
    expect(db.rpc.mock.calls.map(call => ({ limit: call[1].p_limit, indices: call[1].p_queries.map(query => query.query_index) })))
      .toEqual([{ limit: 12, indices: [1] }, { limit: 50, indices: [1] }]);
    expect([...result.merges.keys()]).toEqual(['football-0', 'volleyball']);
  });

  it('does not expand an incomplete rejected page or a full page with a valid match', async () => {
    const wrong = row('wrong', { title: 'Russian Offensive Campaign Assessment, September 18, 2026' });
    const incoming = event({ title: 'Russian Offensive Campaign Assessment, September 19, 2026' });
    const incomplete = database([wrong]);
    const rejected = await resolveStoryMerges([incoming], incomplete.db as never);
    expect(rejected.newEvents).toHaveLength(1);
    expect(incomplete.db.rpc).toHaveBeenCalledOnce();
    const full = database(Array.from({ length: 12 }, (_, index) => row(`valid-${index}`, { title: 'A dozen workers killed in Avonmouth factory explosion' })));
    const accepted = await resolveStoryMerges([event()], full.db as never);
    expect(accepted.merges.size).toBe(1);
    expect(full.db.rpc).toHaveBeenCalledOnce();
  });

  it('keeps the initial result usable if the optional expanded lookup fails', async () => {
    const candidates = Array.from({ length: 12 }, (_, index) => row(`wrong-${index}`, { title: "Korea wins men's football at Asian Games" }));
    const { db } = database(candidates);
    db.rpc.mockResolvedValueOnce({ data: candidates.map(candidate => ({ query_index: 0, event_id: candidate.id,
      similarity: 0.99, latitude: candidate.latitude, longitude: candidate.longitude, location_name: candidate.location_name })), error: null });
    db.rpc.mockResolvedValueOnce({ data: null, error: { message: 'temporary outage' } });
    const result = await resolveStoryMerges([event({ title: "Korea wins women's volleyball at Asian Games" })], db as never);
    expect(result.newEvents).toHaveLength(1);
    expect(db.rpc).toHaveBeenCalledTimes(2);
  });

  it('also retries candidate detail conflicts in the compatibility fallback', async () => {
    const candidates = [row('wrong-sport', { title: "South Korea beats Qatar in men's football", embedding: [1, ...Array(383).fill(0)] }),
      row('right-sport', { title: "South Korea defeats Qatar in women's volleyball", embedding: [0.9, Math.sqrt(0.19), ...Array(382).fill(0)] })];
    const result = await resolveStoryMerges([event({ title: "South Korea beats Qatar in women's volleyball" })], database(candidates, [], true).db as never);
    expect([...result.merges.keys()]).toEqual(['right-sport']);
  });

  it('rejects a contradictory exact-title location and resumes semantic matching', async () => {
    const generic = { title: 'Factory explosion kills twelve workers', description: 'An explosion at a factory in Bristol.' };
    const candidates = [row('far-away', { ...generic, description: 'An explosion at a factory in Singapore.', latitude: 1.3521, longitude: 103.8198, location_name: 'Singapore' }),
      row('local', { title: 'Avonmouth factory explosion kills a dozen workers' })];
    const { db } = database(candidates, [1, 0.9]);
    const result = await resolveStoryMerges([event(generic)], db as never);
    expect(vectors.generate).toHaveBeenCalledOnce();
    expect([...result.merges.keys()]).toEqual(['local']);
  });

  it('checks every exact-title row instead of choosing the first location', async () => {
    const generic = { title: 'Factory explosion kills twelve workers', description: 'An explosion at a factory in Bristol.' };
    const candidates = [row('far-away', { ...generic, description: 'An explosion at a factory in Singapore.', latitude: 1.3521, longitude: 103.8198, location_name: 'Singapore' }), row('local', generic)];
    const result = await resolveStoryMerges([event(generic)], database(candidates).db as never);
    expect([...result.merges.keys()]).toEqual(['local']);
    expect(vectors.generate).not.toHaveBeenCalled();
  });

  it('does not join exact generic headlines in different cities within a batch', async () => {
    const generic = { title: 'Factory explosion kills twelve workers', description: 'An explosion at a factory in Bristol.' };
    const result = await resolveStoryMerges([event(generic), event({ ...generic, description: 'An explosion at a factory in Singapore.', url: 'https://other.example/fire',
      latitude: 1.3521, longitude: 103.8198, location_name: 'Singapore' })], database().db as never);
    expect(result.newEvents).toHaveLength(2);
  });

  it('counts a mirrored X status once and retains an original source URL', async () => {
    // The four source URLs of audited story 4c651a1d-de4c-449a-bb69-d4634a0b0e78.
    const urls = ['http://nitter.jaydenha.uk/Osinttechnical/status/2099676114410946890',
      'https://nitter.kareem.one/Osinttechnical/status/2099676114410946890',
      'http://x.yuuki.sh/Osinttechnical/status/2099676114410946890',
      'https://nitter.netbub.com/Osinttechnical/status/2099676114410946890'];
    const result = await resolveStoryMerges(urls.map(url => event({ title: 'R to @Osinttechnical: Jeddah as well',
      source_type: 'social', source: 'OSINTtechnical (X)', url })), database().db as never);
    expect(result.newEvents).toHaveLength(1);
    expect(result.newEvents[0].event_count).toBe(1);
    expect(urls).toContain(result.newEvents[0].url);
    expect(result.newEvents[0].sources).toEqual([]);
  });

  it('updates a pending representative vector and coordinates before matching the next report', async () => {
    const a = [1, 0, ...Array(382).fill(0)];
    const b = [0.8, 0.6, ...Array(382).fill(0)];
    const c = [0.28, 0.96, ...Array(382).fill(0)];
    vectors.generate.mockResolvedValueOnce([a, b, c]);
    const first = event({ title: 'Warehouse fire reported in Bristol', description: '', published_at: '2026-09-19T08:00:00Z' });
    const second = event({ title: 'Avonmouth warehouse fire damages buildings', description: '', url: 'https://b.example/fire',
      published_at: '2026-09-19T09:00:00Z', latitude: 51.45, longitude: -2.58 });
    const third = event({ title: 'Firefighters extinguish Avonmouth warehouse blaze', description: '', url: 'https://c.example/fire', published_at: '2026-09-19T10:00:00Z' });
    const result = await resolveStoryMerges([first, second, third], database().db as never);
    expect(result.newEvents).toHaveLength(1);
    expect(JSON.parse(result.newEvents[0].embedding as string)).toEqual(c);
    expect(result.newEvents[0].title).toBe(third.title);
    expect(result.newEvents[0].latitude).toBe(third.latitude);
    expect(vectors.generate).toHaveBeenCalledOnce();
    vectors.generate.mockResolvedValueOnce([b, a, c]);
    const reordered = await resolveStoryMerges(structuredClone([second, first, third]), database().db as never);
    expect(reordered.newEvents).toHaveLength(1);
    expect(reordered.newEvents[0].title).toBe(third.title);
    expect(JSON.parse(reordered.newEvents[0].embedding as string)).toEqual(c);
  });

  it('embeds the actual combined representative rather than just the incoming article', async () => {
    vectors.generate.mockResolvedValueOnce([[1, ...Array(383).fill(0)], [1, ...Array(383).fill(0)]]);
    const combinedVector = [0, 1, ...Array(382).fill(0)];
    vectors.generate.mockResolvedValueOnce([combinedVector]);
    const first = event({ description: 'A lengthy initial account with eyewitness details at the factory.' });
    const second = event({ title: 'Death toll rises to 13 after Bristol factory explosion', description: 'Updated toll.',
      url: 'https://b.example/fire', published_at: '2026-09-19T11:00:00Z' });
    const result = await resolveStoryMerges([first, second], database().db as never);
    expect(vectors.generate).toHaveBeenLastCalledWith([`${second.title}. ${first.description}`]);
    expect(JSON.parse(result.newEvents[0].embedding as string)).toEqual(combinedVector);
    expect(result.newEvents[0].description_provenance?.url).toBe(first.url);
  });

  it('recomputes a combined headline/description vector and omits it if generation fails', async () => {
    vectors.generate.mockResolvedValueOnce([[1, ...Array(383).fill(0)], [1, ...Array(383).fill(0)]]);
    vectors.generate.mockRejectedValueOnce(new Error('model failure'));
    const result = await resolveStoryMerges([event({ description: 'A lengthy initial account with eyewitness details at the factory.' }),
      event({ title: 'Death toll rises to 13 after Bristol factory explosion', description: 'Updated toll.',
        url: 'https://b.example/fire', published_at: '2026-09-19T11:00:00Z' })], database().db as never);
    expect(result.newEvents).toHaveLength(1);
    expect(result.newEvents[0].description).toContain('lengthy initial account');
    expect(result.newEvents[0].embedding).toBeUndefined();
  });
});

describe('conservative detail and location evidence', () => {
  it.each([
    ["South Korea beats Qatar in men's football at Asian Games", "South Korea beats Qatar in women's volleyball at Asian Games"],
    ['England wins football match at World Cup', 'England wins football match at Olympic Games'],
    ['Korea wins table tennis gold', 'Korea wins tennis gold'],
    ["Korea wins men's volleyball final", "Korea wins women's volleyball final"],
    ['Russian missile strike hits Kharkiv hospital', 'Russian missile strike hits Kharkiv school'],
    ['Firefighters tackle warehouse blaze in Bristol', 'Firefighters tackle apartment blaze in Bristol'],
  ])('blocks explicit incident contradictions: %s / %s', (a, b) => {
    expect(hasConflictingStoryEvidence(event({ title: a }), event({ title: b, url: 'https://second.example/report' }))).toBe(true);
  });

  it('allows absent details, synonyms and same-incident follow-ups', () => {
    expect(hasConflictingStoryEvidence(event({ title: 'Brazil wins football final' }), event({ title: 'Brazil wins soccer final', url: 'https://second.example/report' }))).toBe(false);
    expect(hasConflictingStoryEvidence(event(), event({ title: 'Death toll rises after factory explosion',
      description: 'On Friday, officials announced the death toll from Monday\'s explosion.',
      published_at: '2026-09-22T12:00:00Z', url: 'https://second.example/report' }))).toBe(false);
    expect(hasConflictingStoryEvidence(event({ title: 'Hurricane Maria causes widespread flooding', primary_discovered_at: '2026-09-14T10:00:00Z' }),
      event({ title: 'Hurricane Maria continues to batter the coast', url: 'https://second.example/storm' }))).toBe(false);
    expect(hasConflictingStoryEvidence(event({ title: 'Factory explosion in Bristol injures twelve workers' }),
      event({ title: 'Hospital treats victims after Bristol explosion', url: 'https://second.example/hospital' }))).toBe(false);
    expect(hasConflictingStoryEvidence(event({ title: 'Fire at Bristol factory leaves twelve injured' }),
      event({ title: 'Bristol hospital admits fire survivors', url: 'https://second.example/hospital' }))).toBe(false);
    expect(hasConflictingStoryEvidence(event({ title: 'Football player killed in Bristol plane crash' }),
      event({ title: 'Basketball player killed in Bristol plane crash', url: 'https://second.example/crash' }))).toBe(false);
  });

  it('distinguishes explicit bilateral counterparties without inventing missing names', () => {
    const agreement = event({ title: 'Canada and Germany sign critical minerals cooperation agreement' });
    expect(hasConflictingStoryEvidence(agreement, event({ title: 'Canada and Japan sign critical minerals cooperation agreement', url: 'https://b.example/pact' }))).toBe(true);
    expect(hasConflictingStoryEvidence(agreement, event({ title: 'Germany and Canada sign critical minerals pact', url: 'https://b.example/pact' }))).toBe(false);
    expect(hasConflictingStoryEvidence(agreement, event({ title: 'Germany signs critical minerals cooperation agreement', url: 'https://b.example/pact' }))).toBe(false);
  });

  it('separates explicit different incident days, but allows reports around midnight', () => {
    const a = event({ description: 'A factory exploded on Monday morning.', published_at: '2026-09-14T10:00:00Z' });
    const b = event({ description: 'A factory exploded on Wednesday afternoon.', published_at: '2026-09-16T15:00:00Z', url: 'https://second.example/report' });
    expect(hasConflictingStoryEvidence(a, b)).toBe(true);
    expect(hasConflictingStoryEvidence({ ...a, published_at: '2026-09-14T23:50:00Z' },
      { ...b, description: 'A factory exploded on Tuesday morning.', published_at: '2026-09-15T00:10:00Z' })).toBe(false);
    expect(hasConflictingStoryEvidence(a, event({ title: 'Names of Bristol explosion victims released',
      description: 'Police released the names on Wednesday.', published_at: '2026-09-16T15:00:00Z', url: 'https://b.example/names' }))).toBe(false);
  });

  it('separates editorial quizzes and daily market sessions without excluding incident analysis', () => {
    const verdict = event({ title: 'Court finds former president guilty of war crimes' });
    expect(hasConflictingStoryEvidence(verdict, event({ title: 'Daily quiz on war criminals', url: 'https://b.example/quiz' }))).toBe(true);
    expect(hasConflictingStoryEvidence(verdict, event({ title: 'Analysis: what the war crimes verdict means', url: 'https://b.example/analysis' }))).toBe(false);
    expect(hasConflictingStoryEvidence(event({ title: 'Quiz show host wins defamation case' }),
      event({ title: 'Television host wins defamation case', url: 'https://b.example/host' }))).toBe(false);
    const session = event({ title: 'Seoul shares close nearly flat', published_at: '2026-09-18T08:00:00Z' });
    expect(hasConflictingStoryEvidence(session, event({ title: 'Seoul stocks rebound on foreign buying', published_at: '2026-09-19T08:00:00Z', url: 'https://b.example/markets' }))).toBe(true);
    expect(hasConflictingStoryEvidence(session, event({ title: 'Seoul stocks end little changed', published_at: '2026-09-18T08:30:00Z', url: 'https://b.example/markets' }))).toBe(false);
  });

  it('does not treat country centroids or ambiguous equal labels as local evidence', () => {
    const country = event({ latitude: 32, longitude: 53, location_name: 'Iran' });
    expect(hasPreciseLocation(country)).toBe(false);
    expect(passesSemanticThreshold(country, country, 0.7)).toBe(false);
    expect(passesSemanticThreshold(event({ latitude: 39.8, longitude: -89.65, location_name: 'Springfield' }),
      event({ latitude: 42.1, longitude: -72.59, location_name: 'Springfield' }), 0.8)).toBe(false);
    expect(passesSemanticThreshold(event(), event(), 0.7)).toBe(true);
    expect(passesSemanticThreshold(country, country, 0.9)).toBe(true);
  });

  it('does not use broad seas, islands or regions as local proximity evidence', () => {
    for (const [location_name, latitude, longitude] of [['Red Sea', 20, 38.5], ['South China Sea', 12, 113],
      ['Siberia', 60, 105], ['Sicily', 37.6, 14.01]] as const) {
      const region = event({ location_name, latitude, longitude });
      expect(hasPreciseLocation(region), location_name).toBe(false);
      expect(passesSemanticThreshold(region, region, 0.65), location_name).toBe(false);
    }
    expect(hasPreciseLocation(event({ location_name: 'Pentagon', latitude: 38.87, longitude: -77.06 }))).toBe(true);
  });
});
