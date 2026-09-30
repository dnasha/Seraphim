import type { NewsItem } from '@/lib/core/types';
import { copyPacket } from '@/lib/analyst/schema';
import { selectionFor } from '@/lib/analyst/selection';
import { PACKET_DISCLAIMER, type EvidenceScope } from '@/lib/analyst/types';

export const analystId = (index = 1) => `11111111-1111-4111-8111-${String(index).padStart(12, '0')}`;
export const observedAt = '2026-09-30T08:00:00.000Z';
export const analystEvent = (index = 1): NewsItem => ({
  id: analystId(index), title: `Fixture event ${index}`, description: 'Synthetic public-interest event for testing.',
  publishedAt: '2026-09-29T12:00:00Z', headlinePublishedAt: '2026-09-28T12:00:00Z', source: 'Fixture publisher', sourceType: 'rss',
  url: `https://example.invalid/report-${index}`, latitude: 48.85, longitude: 2.35, locationName: 'Fixture location', credibilityTier: 2,
  descriptionProvenance: { name: 'Fixture publisher', url: 'https://example.invalid/summary', published_at: '2026-09-29T12:00:00Z', tier: 2 },
  sources: [{ name: 'Fixture source', url: 'https://example.invalid/report', sourceType: 'rss', discoveredAt: '2026-09-29T12:30:00Z' }],
});
export const analystScope: EvidenceScope = {
  timeRange: '1d', from: '', to: '', query: '', sort: 'hot', sources: ['rss'], categories: ['all'], minVolume: 1, credibilityTiers: [1, 2, 3],
  viewport: null, isCapped: true, appliedLimit: 1000, feedStatus: 'freshness-not-reported', displayedCount: 3,
  selectionScope: 'explicit-selection', detailScope: 'exact-id-outside-list-window-allowed',
};
export const detailBody = (event = analystEvent()) => ({ event, description: event.description, latitude: event.latitude, longitude: event.longitude,
  sources: event.sources?.map(s => ({ name: s.name, url: s.url, source_type: s.sourceType, discovered_at: s.discoveredAt })) ?? [],
  timelineRestricted: false, totalSources: event.sources?.length ?? 0,
});
export const fixturePacket = (event = analystEvent()) => copyPacket({
  version: 1, id: analystId(100), captureStartedAt: observedAt, captureEndedAt: observedAt, checkedAt: observedAt, accessTierAtCapture: 'analyst',
  scope: analystScope, disclaimer: PACKET_DISCLAIMER,
  entries: [{ selection: selectionFor(event, observedAt), requestStartedAt: observedAt, responseReceivedAt: observedAt, status: 'captured', event,
    restrictions: { timelineRestricted: false, totalSources: event.sources?.length ?? 0, returnedSources: event.sources?.length ?? 0, sourcesTruncated: false, detailCache: 'server-cache-up-to-60s' } }],
});
