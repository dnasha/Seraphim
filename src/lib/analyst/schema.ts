import type { EvidenceEvent, EvidencePacket, EvidenceScope, EvidenceEntry, AnalystSelection, AnalystStore } from './types';
import { UUID, MAX_SELECTION, MAX_SOURCES, MAX_PACKETS, MAX_NOTES, MAX_NOTE_LENGTH, PACKET_DISCLAIMER } from './types';

export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid evidence data.');
  return value as Record<string, unknown>;
}
function string(value: unknown, max = 1000): string {
  if (typeof value !== 'string' || value.length > max) throw new Error('Invalid or oversized evidence field.');
  return value;
}
function number(value: unknown, min = -Infinity, max = Infinity): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error('Invalid evidence number.');
  return value;
}
function bool(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new Error('Invalid evidence flag.');
  return value;
}
function date(value: unknown): string {
  const result = string(value, 64);
  if (!Number.isFinite(Date.parse(result))) throw new Error('Invalid capture timestamp.');
  return result;
}
function id(value: unknown): string {
  const result = string(value, 36).toLowerCase();
  if (!UUID.test(result)) throw new Error('Invalid canonical event ID.');
  return result;
}
function array<T>(value: unknown, max: number, parse: (v: unknown) => T): T[] {
  if (!Array.isArray(value) || value.length > max) throw new Error('Invalid evidence list.');
  return value.map(parse);
}

export function copyEvent(value: unknown): EvidenceEvent {
  const raw = record(value);
  const sourceType = string(raw.sourceType);
  if (!['rss', 'gnews', 'social'].includes(sourceType)) throw new Error('Invalid event source type.');
  const event: EvidenceEvent = {
    id: id(raw.id), title: string(raw.title), url: string(raw.url, 4000),
    source: string(raw.source), sourceType: sourceType as EvidenceEvent['sourceType'], publishedAt: string(raw.publishedAt, 64),
  };
  for (const key of ['description', 'category', 'locationName', 'headlinePublishedAt', 'latestActivityAt'] as const) {
    if (raw[key] !== undefined) event[key] = string(raw[key], key === 'description' ? 16000 : 1000);
  }
  if (raw.latitude !== undefined) event.latitude = number(raw.latitude, -90, 90);
  if (raw.longitude !== undefined) event.longitude = number(raw.longitude, -180, 180);
  for (const key of ['credibilityTier', 'impactScore', 'independentPublisherCount'] as const) {
    if (raw[key] !== undefined) event[key] = number(raw[key], 0);
  }
  if (raw.descriptionProvenance !== undefined) {
    const p = raw.descriptionProvenance === null ? null : record(raw.descriptionProvenance);
    event.descriptionProvenance = p ? { name: string(p.name), url: string(p.url, 4000), published_at: string(p.published_at, 64), tier: number(p.tier, 0) } : null;
  }
  if (raw.sources !== undefined) {
    event.sources = array(raw.sources, MAX_SOURCES, value => {
      const s = record(value);
      return { name: string(s.name), url: string(s.url, 4000), sourceType: string(s.sourceType), discoveredAt: string(s.discoveredAt, 64) };
    });
  }
  return event;
}
function copySelection(value: unknown): AnalystSelection {
  const raw = record(value);
  return { id: id(raw.id), title: string(raw.title), selectedAt: date(raw.selectedAt), representative: bool(raw.representative), representedStoryCount: number(raw.representedStoryCount, 1, 100000) };
}
export function copyScope(value: unknown): EvidenceScope {
  const raw = record(value);
  if (!['loading', 'previous-data-after-error', 'freshness-not-reported'].includes(String(raw.feedStatus)) || raw.selectionScope !== 'explicit-selection' || raw.detailScope !== 'exact-id-outside-list-window-allowed') throw new Error('Invalid evidence scope.');
  const viewport = raw.viewport === null ? null : record(raw.viewport);
  return {
    timeRange: string(raw.timeRange, 20), from: string(raw.from, 64), to: string(raw.to, 64), query: string(raw.query, 1000), sort: string(raw.sort, 20),
    sources: array(raw.sources, 30, v => string(v, 100)), categories: array(raw.categories, 30, v => string(v, 100)),
    minVolume: number(raw.minVolume, 0), credibilityTiers: array(raw.credibilityTiers, 10, v => number(v, 0, 10)),
    viewport: viewport ? { minLat: number(viewport.minLat, -90, 90), maxLat: number(viewport.maxLat, -90, 90), minLng: number(viewport.minLng), maxLng: number(viewport.maxLng), ...(viewport.zoom !== undefined ? { zoom: number(viewport.zoom, 0, 30) } : {}) } : null,
    isCapped: bool(raw.isCapped), appliedLimit: raw.appliedLimit === null ? null : number(raw.appliedLimit, 1),
    feedStatus: raw.feedStatus as EvidenceScope['feedStatus'], displayedCount: number(raw.displayedCount, 0, 100000),
    selectionScope: 'explicit-selection', detailScope: 'exact-id-outside-list-window-allowed',
  };
}
function copyEntry(value: unknown): EvidenceEntry {
  const raw = record(value);
  const entry: EvidenceEntry = { selection: copySelection(raw.selection), requestStartedAt: date(raw.requestStartedAt), responseReceivedAt: date(raw.responseReceivedAt), status: raw.status as EvidenceEntry['status'] };
  if (raw.status === 'error') entry.error = string(raw.error, 1000);
  else if (raw.status === 'captured') {
    entry.event = copyEvent(raw.event);
    if (entry.event.id !== entry.selection.id) throw new Error('Mismatched event identity.');
    const r = record(raw.restrictions);
    entry.restrictions = { timelineRestricted: bool(r.timelineRestricted), totalSources: r.totalSources === null ? null : number(r.totalSources, 0), returnedSources: number(r.returnedSources, 0, MAX_SOURCES), sourcesTruncated: bool(r.sourcesTruncated), detailCache: 'server-cache-up-to-60s' };
    if (entry.restrictions.returnedSources !== (entry.event.sources?.length ?? 0)) throw new Error('Invalid source count.');
  } else throw new Error('Invalid capture status.');
  return entry;
}

/** Copy by allowlist and freeze recursively; live objects can never mutate a capture. */
export function freezeCopy<T>(value: T): T {
  const clone = JSON.parse(JSON.stringify(value)) as T;
  const freeze = (v: unknown) => {
    if (v && typeof v === 'object') { Object.values(v).forEach(freeze); Object.freeze(v); }
  };
  freeze(clone);
  return clone;
}
export function copyPacket(value: unknown): EvidencePacket {
  const raw = record(value);
  if (raw.version !== 1 || !['analyst', 'angel'].includes(String(raw.accessTierAtCapture))) throw new Error('Unsupported evidence packet.');
  const entries = array(raw.entries, MAX_SELECTION, copyEntry);
  if (!entries.length || new Set(entries.map(e => e.selection.id)).size !== entries.length) throw new Error('Invalid packet selection.');
  return freezeCopy({
    version: 1, id: id(raw.id), captureStartedAt: date(raw.captureStartedAt), captureEndedAt: date(raw.captureEndedAt), checkedAt: date(raw.checkedAt),
    accessTierAtCapture: raw.accessTierAtCapture as EvidencePacket['accessTierAtCapture'], scope: copyScope(raw.scope), entries, disclaimer: PACKET_DISCLAIMER,
  });
}
export function copyNotes(value: unknown): Record<string, string> {
  const raw = record(value);
  if (Object.keys(raw).length > MAX_NOTES) throw new Error('Too many local notes. Remove notes before adding more.');
  const notes: Record<string, string> = {};
  for (const [key, val] of Object.entries(raw)) notes[id(key)] = string(val, MAX_NOTE_LENGTH);
  return notes;
}
export function copyStore(value: unknown, ownerId: string): AnalystStore {
  const raw = record(value);
  if (raw.version !== 1 || raw.ownerId !== ownerId) throw new Error('Invalid account-scoped local workspace.');
  const packets = array(raw.packets, MAX_PACKETS, copyPacket);
  if (new Set(packets.map(p => p.id)).size !== packets.length) throw new Error('Duplicate local packet.');
  return { version: 1, ownerId, ...(raw.resetId !== undefined ? { resetId: id(raw.resetId) } : {}), packets, notes: copyNotes(raw.notes) };
}
