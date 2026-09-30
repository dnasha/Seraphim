import type { NewsItem, BBox } from '@/lib/core/types';
import type { UserTier } from '@/lib/entitlements';

export const MAX_SELECTION = 20;
export const MAX_SOURCES = 200;
export const MAX_PACKETS = 8;
export const MAX_NOTES = 100;
export const MAX_NOTE_LENGTH = 2000;
export const MAX_STORAGE_BYTES = 2_000_000;
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface AnalystSelection {
  id: string;
  title: string;
  representative: boolean;
  representedStoryCount: number;
  selectedAt: string;
}

/** Snapshot of the displayed dashboard scope, not a claim of a complete query. */
export interface EvidenceScope {
  timeRange: string;
  from: string;
  to: string;
  query: string;
  sort: string;
  sources: string[];
  categories: string[];
  minVolume: number;
  credibilityTiers: number[];
  viewport: Pick<BBox, 'minLat' | 'maxLat' | 'minLng' | 'maxLng' | 'zoom'> | null;
  isCapped: boolean;
  appliedLimit: number | null;
  feedStatus: 'loading' | 'previous-data-after-error' | 'freshness-not-reported';
  displayedCount: number;
  selectionScope: 'explicit-selection';
  detailScope: 'exact-id-outside-list-window-allowed';
}

// Deliberate allowlist: no image fetches, internal ingestion fields, or map clusters.
export type EvidenceEvent = Pick<NewsItem,
  'id' | 'title' | 'description' | 'descriptionProvenance' | 'headlinePublishedAt' |
  'publishedAt' | 'latestActivityAt' | 'url' | 'source' | 'sourceType' | 'category' |
  'latitude' | 'longitude' | 'locationName' | 'credibilityTier' | 'impactScore' |
  'independentPublisherCount' | 'sources'>;

export interface EvidenceEntry {
  selection: AnalystSelection;
  requestStartedAt: string;
  responseReceivedAt: string;
  status: 'captured' | 'error';
  error?: string;
  event?: EvidenceEvent;
  restrictions?: {
    timelineRestricted: boolean;
    totalSources: number | null;
    returnedSources: number;
    sourcesTruncated: boolean;
    detailCache: 'server-cache-up-to-60s';
  };
}

export interface EvidencePacket {
  version: 1;
  id: string;
  captureStartedAt: string;
  captureEndedAt: string;
  checkedAt: string;
  accessTierAtCapture: UserTier;
  scope: EvidenceScope;
  entries: EvidenceEntry[];
  disclaimer: string;
}
export interface AnalystStore {
  version: 1;
  ownerId: string;
  packets: EvidencePacket[];
  notes: Record<string, string>;
}
export interface EvidenceExport {
  version: 1;
  packet: EvidencePacket;
  notesIncluded: boolean;
  /** Explicit export-time copy; never changes the captured packet. */
  privateNotes?: Record<string, string>;
}
export const PACKET_DISCLAIMER = 'Copied observations from server-authorized event details, not an authenticated archive or a complete historical dataset. Publication times may change after story merges. Capture and response times record this observation, not publication. Links lead to original reporting; source availability and accuracy are not guaranteed.';
