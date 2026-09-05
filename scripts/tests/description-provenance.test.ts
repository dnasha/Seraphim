import { expect, it } from 'vitest';
import { calculateMergedStory } from '@/lib/utils/merging';
import type { DbEvent } from '@/types';
const existing = { id: 'story', title: 'Initial headline', source: 'Publisher A', source_type: 'rss' as const,
  url: 'https://a.example/story', description: 'A detailed original description '.repeat(10), credibility_tier: 1,
  primary_discovered_at: '2026-09-01T00:00:00Z', published_at: '2026-09-01T04:00:00Z', sources: [],
  description_provenance: { name: 'Publisher A', url: 'https://a.example/story', published_at: '2026-09-01T00:00:00Z', tier: 1 } };
const incoming: DbEvent = { title: 'Latest headline', source: 'Publisher B', source_type: 'rss',
  url: 'https://b.example/story', description: 'Short update', credibility_tier: 1, published_at: '2026-09-01T05:00:00Z' };
it('keeps the original summary attribution when only the headline changes', () => {
  const merged = { ...existing, ...calculateMergedStory(existing, incoming) };
  expect(merged.source).toBe('Publisher B');
  expect(merged.description_provenance.name).toBe('Publisher A');
  expect(merged.sources[0].discovered_at).toBe(existing.primary_discovered_at);
});
it('attributes a new description to its own article and time', () => {
  const merged = calculateMergedStory(existing, { ...incoming, description: 'Richer description '.repeat(30) });
  expect(merged.description_provenance).toMatchObject({ name: 'Publisher B', url: incoming.url, published_at: incoming.published_at });
});
it('does not erase a useful summary when a more credible headline has no description', () => {
  expect(calculateMergedStory({ ...existing, credibility_tier: 2 }, { ...incoming, description: '' })).not.toHaveProperty('description');
});
