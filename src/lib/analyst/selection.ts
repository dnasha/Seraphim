import type { NewsItem } from '@/lib/core/types';
import { canonicalNewsId } from '@/lib/utils/ranking';
import { MAX_SELECTION, UUID, type AnalystSelection } from './types';

export function selectionFor(item: NewsItem, now = new Date().toISOString()): AnalystSelection | null {
  const id = canonicalNewsId(item).toLowerCase();
  if (!UUID.test(id)) return null; // Never persist a synthetic cluster ID or unresolved representative.
  return {
    id, title: item.title.slice(0, 1000), selectedAt: now,
    representative: item.id !== canonicalNewsId(item) || (item.storyCount ?? 1) > 1,
    representedStoryCount: Math.max(1, Math.min(100000, item.storyCount ?? 1)),
  };
}

export function toggleSelection(items: AnalystSelection[], item: NewsItem): AnalystSelection[] {
  const selected = selectionFor(item);
  if (!selected) throw new Error('This map row has no resolvable individual event. Select a story with a canonical event ID.');
  if (items.some(entry => entry.id === selected.id)) return items.filter(entry => entry.id !== selected.id);
  if (items.length >= MAX_SELECTION) throw new Error(`Select up to ${MAX_SELECTION} events per packet.`);
  return [...items, selected];
}
