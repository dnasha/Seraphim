import { beforeAll, describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { DbEvent } from '@/types';
import { buildEmbeddingText, cosineSimilarity, generateEmbeddings } from '@/lib/utils/vectorize';
import { resolveStoryMerges } from '@/scraper/merger';

type Challenge = { name: string; merge: boolean; first: DbEvent; second: DbEvent };
const now = Date.now();
const at = (hours: number) => new Date(now + hours * 3_600_000).toISOString();
const first = (title: string, description: string, overrides: Partial<DbEvent> = {}): DbEvent => ({
  title, description, source: 'Publisher A', source_type: 'rss', url: 'https://publisher-a.example/report',
  latitude: 51.4545, longitude: -2.5879, location_name: 'Bristol', published_at: at(-2),
  credibility_tier: 2, sources: [], event_count: 1, ...overrides,
});
const second = (title: string, description: string, overrides: Partial<DbEvent> = {}) => first(title, description, {
  source: 'Publisher B', url: 'https://publisher-b.example/report', published_at: at(-1), ...overrides,
});
const canada = { latitude: 56.13, longitude: -106.35, location_name: 'Canada' };
const turkey = { latitude: 38.96, longitude: 35.24, location_name: 'Turkey' };

// Constructed, incident-labelled challenges. The first seven preserve the audit's
// original wording. Tests use the real model and resolver, not a copied threshold
// function or invented candidate similarities. This is a regression corpus, not
// an estimate of production precision/recall.
const challenges: Challenge[] = [
  {
    name: 'same-publisher casualty update', merge: true,
    first: first('Factory explosion in Bristol kills 12 workers', 'An explosion at the Avonmouth chemical factory killed 12 workers on Monday.'),
    second: second('Factory explosion in Bristol kills 13 workers', 'The death toll from the Avonmouth chemical factory explosion rose to 13 after another worker died in hospital.',
      { source: 'Publisher A', url: 'https://publisher-a.example/update' }),
  },
  {
    name: 'different-publisher casualty update', merge: true,
    first: first('Factory explosion in Bristol kills 12 workers', 'An explosion at the Avonmouth chemical factory killed 12 workers on Monday.'),
    second: second('Factory explosion in Bristol kills 13 workers', 'The death toll from the Avonmouth chemical factory explosion rose to 13 after another worker died in hospital.'),
  },
  {
    name: 'different missile-strike targets in the same city', merge: false,
    first: first('Russian missile strike hits Kharkiv hospital, killing two', 'Two people died when a Russian missile hit the regional hospital in Kharkiv on Monday morning.',
      { latitude: 49.99, longitude: 36.23, location_name: 'Kharkiv', published_at: at(-40) }),
    second: second('Russian missile strike hits Kharkiv school, killing two', 'Two people died when a Russian missile hit a secondary school in Kharkiv on Wednesday afternoon.',
      { latitude: 49.99, longitude: 36.23, location_name: 'Kharkiv' }),
  },
  {
    name: 'different fires in the same city', merge: false,
    first: first('Firefighters tackle major warehouse blaze in Bristol', 'Crews responded to a warehouse fire in Avonmouth on Monday. No injuries were reported.'),
    second: second('Firefighters tackle major apartment blaze in Bristol', 'Crews responded to an apartment fire in Bedminster on Tuesday. Three residents were taken to hospital.'),
  },
  {
    name: 'different sports with the same countries', merge: false,
    first: first("South Korea beats Qatar in men's football at Asian Games", "South Korea defeated Qatar in the men's football tournament on Tuesday behind a midfielder's hat trick.",
      { latitude: 35.18, longitude: 136.91, location_name: 'Nagoya, Japan' }),
    second: second("South Korea beats Qatar in women's volleyball at Asian Games", "South Korea defeated Qatar in the women's volleyball tournament on Thursday to secure a quarterfinal berth.",
      { latitude: 35.18, longitude: 136.91, location_name: 'Nagoya, Japan' }),
  },
  {
    name: 'earthquakes in different cities', merge: false,
    first: first('Magnitude 6.2 earthquake strikes near Tokyo', 'A magnitude 6.2 earthquake struck near Tokyo on Monday morning. Authorities reported no tsunami threat.',
      { latitude: 35.6762, longitude: 139.6503, location_name: 'Tokyo' }),
    second: second('Magnitude 6.2 earthquake strikes near Jakarta', 'A magnitude 6.2 earthquake struck near Jakarta on Tuesday morning. Authorities reported no tsunami threat.',
      { latitude: -6.2088, longitude: 106.8456, location_name: 'Jakarta' }),
  },
  {
    name: 'paraphrases of the same overnight warehouse fire', merge: true,
    first: first('Firefighters tackle major warehouse blaze in Bristol', 'Crews responded to a warehouse fire in Avonmouth overnight. No injuries were reported.'),
    second: second('Overnight fire destroys Avonmouth warehouse', 'Dozens of firefighters battled a blaze at a Bristol warehouse in Avonmouth. Nobody was hurt.'),
  },
  {
    name: 'hospital treatment after the same factory explosion', merge: true,
    first: first('Factory explosion in Bristol injures twelve workers', 'Twelve workers were injured in an explosion at the Avonmouth chemical factory in Bristol on Monday.'),
    second: second('Hospital treats victims after Bristol explosion', "Twelve workers injured in Monday's explosion at the Avonmouth chemical factory in Bristol were admitted to hospital."),
  },
  {
    name: 'athletes from different sports in the same plane crash', merge: true,
    first: first('Football player killed in Bristol plane crash', 'A football player and a basketball player were killed when their private aircraft crashed near Bristol airport on Monday.'),
    second: second('Basketball player killed in Bristol plane crash', 'The same private aircraft crashed near Bristol airport on Monday, killing a basketball player and a football player.'),
  },
  {
    name: 'one minerals agreement with country-only pins', merge: true,
    first: first('Canada and Germany sign critical minerals cooperation agreement', 'Canada and Germany signed a memorandum on critical minerals supplies on Friday, officials said.', canada),
    second: second('Germany and Canada sign pact on critical mineral supplies', 'The two countries signed a cooperation agreement on critical minerals on Friday.', canada),
  },
  {
    name: 'one defence offer with country-only pins', merge: true,
    first: first('Turkey offers Saudi Arabia military assistance under defence pact', 'Foreign Minister Hakan Fidan said Turkey was ready to help meet Saudi military needs under their trilateral pact.', turkey),
    second: second('Fidan says Turkey ready to meet Saudi military needs', 'Turkish Foreign Minister Hakan Fidan said the country could supply Saudi Arabia with military assistance under the joint defence agreement.', turkey),
  },
  {
    name: 'one defence offer with compatible city and country pins', merge: true,
    first: first('Turkey offers Saudi Arabia military assistance under defence pact', 'Foreign Minister Hakan Fidan said Turkey was ready to help meet Saudi military needs under their trilateral pact.',
      { latitude: 39.92, longitude: 32.85, location_name: 'Ankara' }),
    second: second('Fidan says Turkey ready to meet Saudi military needs', 'Turkish Foreign Minister Hakan Fidan said the country could supply Saudi Arabia with military assistance under the joint defence agreement.', turkey),
  },
  {
    name: 'different bilateral counterparties despite highly similar wording', merge: false,
    first: first('Canada and Germany sign critical minerals cooperation agreement', 'Canada signed a memorandum with Germany on critical minerals supplies on Friday.', canada),
    second: second('Canada and Japan sign critical minerals cooperation agreement', 'Canada signed a separate memorandum with Japan on critical minerals supplies on Friday.', canada),
  },
  {
    name: 'rephrased reports of one Rostov refinery strike', merge: true,
    first: first('Russia-Ukraine war: Drones strike oil refinery in Rostov', "A large fire broke out at an oil refinery in Russia's Rostov region after a suspected drone attack.",
      { latitude: 47.23, longitude: 39.72, location_name: 'Rostov-na-Donu' }),
    second: second('Ukrainian UAVs hit Russian fuel depot in Rostov overnight', 'Kiev sources claim successful strike on strategic energy infrastructure in the Rostov area.',
      { latitude: 47.23, longitude: 39.72, location_name: 'Rostov-na-Donu' }),
  },
  {
    name: 'similar demonstrations in London and Paris', merge: false,
    first: first('Thousands protest in London against climate change', 'Demonstrators marched through central London calling for immediate government action.',
      { latitude: 51.507, longitude: -0.127, location_name: 'London' }),
    second: second('Thousands protest in Paris against climate change', 'Protesters gathered at the Place de la République to demand stricter environmental laws.',
      { latitude: 48.856, longitude: 2.352, location_name: 'Paris' }),
  },
  {
    name: 'identical global wire report with differing country fallback pins', merge: true,
    first: first('URGENT: Global health emergency declared by WHO', 'The World Health Organization has declared a new public health emergency of international concern.',
      { latitude: 37.09, longitude: -95.71, location_name: 'United States' }),
    second: second('URGENT: Global health emergency declared by WHO', 'The World Health Organization has declared a new public health emergency of international concern.',
      { latitude: 36.2, longitude: 138.25, location_name: 'Japan' }),
  },
];

const storedVectors = new Map<string, number[]>();
const similarityByCase = new Map<string, number>();

/** A bounded read-only database double; matcher scores come from the actual RPC query vector. */
function database(challenge: Challenge, stored: boolean): SupabaseClient {
  const candidate = { ...challenge.first, id: 'existing-incident', impact_score: 1.5 };
  const rows = stored ? [candidate] : [];
  return {
    from(table: string) {
      expect(table).toBe('events');
      let since = -Infinity;
      const query = {
        select() { return query; },
        gte(column: string, value: string) {
          expect(column).toBe('published_at');
          since = Date.parse(value);
          return query;
        },
        order() { return query; },
        async range(start: number, end: number) {
          return { data: rows.filter(row => Date.parse(row.published_at) >= since).slice(start, end + 1), error: null };
        },
        async in(column: string, ids: string[]) {
          expect(column).toBe('id');
          return { data: rows.filter(row => ids.includes(row.id)), error: null };
        },
      };
      return query;
    },
    async rpc(name: string, args: { p_queries: { query_index: number; embedding: string }[]; p_since: string; p_limit: number }) {
      expect(name).toBe('match_recent_event_candidates');
      expect(args.p_queries.length).toBeLessThanOrEqual(2);
      return {
        data: args.p_queries.flatMap(query => {
          const incomingVector = JSON.parse(query.embedding) as number[];
          expect(incomingVector).toHaveLength(384);
          return rows.filter(row => Date.parse(row.published_at) >= Date.parse(args.p_since))
            .map(row => ({
              query_index: query.query_index, event_id: row.id,
              similarity: cosineSimilarity(incomingVector, storedVectors.get(challenge.name)!),
              latitude: row.latitude, longitude: row.longitude, location_name: row.location_name,
            }))
            .sort((a, b) => b.similarity - a.similarity)
            .slice(0, args.p_limit);
        }),
        error: null,
      };
    },
  } as unknown as SupabaseClient;
}

describe('production story resolver with real MiniLM embeddings', () => {
  beforeAll(async () => {
    // CI already caches .cache; on a cold cache retain the production model-loading path.
    const embeddings = await generateEmbeddings(challenges.flatMap(challenge => [challenge.first, challenge.second]
      .map(event => buildEmbeddingText(event.title, event.description))));
    for (const [index, challenge] of challenges.entries()) {
      storedVectors.set(challenge.name, embeddings[index * 2]);
      similarityByCase.set(challenge.name, cosineSimilarity(embeddings[index * 2], embeddings[index * 2 + 1]));
    }
  }, 30_000);

  describe.each(['pending batch', 'stored candidate'] as const)('%s', mode => {
    it.each(challenges)('$name', async challenge => {
      const stored = mode === 'stored candidate';
      const events = stored ? [challenge.second] : [challenge.first, challenge.second];
      const result = await resolveStoryMerges(structuredClone(events), database(challenge, stored));
      const diagnostic = `${challenge.name}; measured similarity=${similarityByCase.get(challenge.name)}`;
      if (stored) {
        expect(result.merges.has('existing-incident'), diagnostic).toBe(challenge.merge);
        expect(result.newEvents, diagnostic).toHaveLength(challenge.merge ? 0 : 1);
      } else {
        expect(result.merges.size, diagnostic).toBe(0);
        expect(result.newEvents, diagnostic).toHaveLength(challenge.merge ? 1 : 2);
      }
      if (challenge.merge) {
        const merged = stored ? { ...challenge.first, ...result.merges.get('existing-incident') } : result.newEvents[0];
        expect(merged.event_count, diagnostic).toBe(2);
        expect(new Set([merged.url, ...(merged.sources ?? []).map(source => source.url)]), diagnostic)
          .toEqual(new Set([challenge.first.url, challenge.second.url]));
      }
    });
  });

  // Do not relabel this same-episode pair as a true negative or encode its current
  // split as desired behavior. Audit evidence scores it at 0.603, below the safe
  // country-only threshold: Canada/Germany "critical minerals agreement" versus
  // "Ottawa secures Berlin deal to supply battery metals". A stronger event/entity
  // signal is needed before this can become a passing same-incident regression.
  it.todo('Known recall gap: same Canada–Germany minerals agreement paraphrased as Ottawa/Berlin battery-metals deal');
});
