import type { NewsItem } from '@/lib/core/types';

/** Synthetic 1,000-event map workload; no publisher content or live services. */
export const mapActivityFixture: NewsItem[] = Array.from({ length: 1_000 }, (_, index) => ({
    id: `fixture-${index}`, title: `Synthetic event ${index}`, description: 'Synthetic test summary.',
    source: 'Fixture', sourceType: 'rss', url: `https://example.invalid/${index}`,
    category: index % 2 ? 'world' : 'crisis', publishedAt: '2026-09-30T06:00:00Z',
    latitude: 30 + (index % 25) * 0.2, longitude: 10 + Math.floor(index / 25) * 0.2,
    storyCount: 1, sourcesCount: 10, impactScore: index % 5,
}));
