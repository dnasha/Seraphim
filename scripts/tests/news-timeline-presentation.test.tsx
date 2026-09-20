// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NewsItem } from '@/lib/core/types';

vi.mock('@/components/ui/TimelineGateCta', () => ({ default: () => null }));

import EventCard from '@/components/ui/EventCard';
import MapPopup from '@/components/map/MapPopup';

const now = Date.UTC(2026, 8, 20);
const baseItem: NewsItem = {
  id: 'story',
  title: 'Story',
  url: 'https://example.com/story',
  source: 'Headline publisher',
  sourceType: 'rss',
  publishedAt: new Date(now - 3 * 60 * 60 * 1000).toISOString(),
};

describe.each([
  ['sidebar card', (item: NewsItem) => <EventCard item={item} index={0} isSelected isExpanded onCardClick={() => {}} userTier="pro" />],
  ['map popup', (item: NewsItem) => <MapPopup item={item} userTier="pro" />],
] as const)('%s source dates', (_name, renderItem) => {
  beforeEach(() => vi.spyOn(Date, 'now').mockReturnValue(now));
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('shows the latest source time and a descending timeline without mutating sources', () => {
    const sources: NonNullable<NewsItem['sources']> = [
      { name: 'Older', url: 'https://older.example/report', sourceType: 'rss', discoveredAt: new Date(now - 2 * 60 * 60 * 1000).toISOString() },
      { name: 'Latest', url: 'https://latest.example/report', sourceType: 'rss', discoveredAt: new Date(now - 30 * 60 * 1000).toISOString() },
    ];
    render(renderItem({ ...baseItem, sources }));

    const timelineLinks = screen.getAllByRole('link', { name: /^(older|latest)\.example$/ });
    expect(timelineLinks.map((link) => link.textContent)).toEqual(['latest.example', 'older.example']);
    expect(screen.getAllByText('30m ago')).toHaveLength(2);
    expect(sources.map(({ name }) => name)).toEqual(['Older', 'Latest']);
  });

  it('falls back to activity time when sources are empty', () => {
    render(renderItem({ ...baseItem, sources: [], latestActivityAt: new Date(now - 60 * 60 * 1000).toISOString() }));
    expect(screen.getByText('1h ago')).toBeTruthy();
  });

  it('falls back to publication time before details are loaded', () => {
    render(renderItem(baseItem));
    expect(screen.getByText('3h ago')).toBeTruthy();
  });
});
