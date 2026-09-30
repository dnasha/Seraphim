import { safeExternalHttpUrl } from '@/lib/security/externalUrl';
import { copyNotes, copyPacket, freezeCopy } from './schema';
import type { EvidenceExport, EvidencePacket } from './types';

export function exportCopy(packet: EvidencePacket, notes: Record<string, string>, includeNotes = false): EvidenceExport {
  const copy = copyPacket(packet);
  const selectedNotes: Record<string, string> = {};
  if (includeNotes) {
    const valid = copyNotes(notes);
    for (const entry of copy.entries) if (valid[entry.selection.id]) selectedNotes[entry.selection.id] = valid[entry.selection.id];
  }
  return freezeCopy({ version: 1, packet: copy, notesIncluded: includeNotes, ...(includeNotes ? { privateNotes: selectedNotes } : {}) });
}
export const serializeJson = (value: EvidenceExport) => JSON.stringify(value, null, 2);

/** Quote every cell (RFC 4180), preserve newlines, neutralize spreadsheet formulas. */
export function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? '' : String(value);
  text = text.replace(/\u0000/g, '');
  if (/^[\s\u0000-\u001f]*[=+\-@]/u.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}
const CSV_COLUMNS = ['row_type', 'packet_id', 'event_id', 'title', 'description', 'publisher', 'url', 'source_type', 'published_at', 'headline_published_at', 'discovered_at', 'capture_started_at', 'capture_ended_at', 'access_checked_at', 'request_started_at', 'response_received_at', 'representative', 'represented_story_count', 'latitude', 'longitude', 'location', 'credibility_tier', 'impact_score', 'timeline_restricted', 'total_sources', 'returned_sources', 'sources_truncated', 'description_provenance_json', 'scope_json', 'notes_included', 'note', 'error', 'disclaimer'];
export function serializeCsv(value: EvidenceExport): string {
  const { packet } = value;
  const rows: Record<string, unknown>[] = [{ row_type: 'packet', disclaimer: packet.disclaimer }];
  for (const entry of packet.entries) {
    const event = entry.event;
    const common = {
      event_id: entry.selection.id, request_started_at: entry.requestStartedAt, response_received_at: entry.responseReceivedAt,
      representative: entry.selection.representative, represented_story_count: entry.selection.representedStoryCount,
      timeline_restricted: entry.restrictions?.timelineRestricted, total_sources: entry.restrictions?.totalSources,
      returned_sources: entry.restrictions?.returnedSources, sources_truncated: entry.restrictions?.sourcesTruncated,
    };
    rows.push({ ...common, row_type: entry.status === 'captured' ? 'event' : 'error', title: event?.title ?? entry.selection.title,
      description: event?.description, publisher: event?.source, url: event?.url, source_type: event?.sourceType,
      published_at: event?.publishedAt, headline_published_at: event?.headlinePublishedAt, latitude: event?.latitude, longitude: event?.longitude,
      location: event?.locationName, credibility_tier: event?.credibilityTier, impact_score: event?.impactScore,
      description_provenance_json: event?.descriptionProvenance ? JSON.stringify(event.descriptionProvenance) : '', error: entry.error,
    });
    for (const source of event?.sources ?? []) rows.push({ ...common, row_type: 'source', publisher: source.name, url: source.url, source_type: source.sourceType, discovered_at: source.discoveredAt });
    if (value.notesIncluded && value.privateNotes?.[entry.selection.id]) rows.push({ ...common, row_type: 'note', note: value.privateNotes[entry.selection.id] });
  }
  const shared = {
    packet_id: packet.id, capture_started_at: packet.captureStartedAt, capture_ended_at: packet.captureEndedAt, access_checked_at: packet.checkedAt,
    scope_json: JSON.stringify(packet.scope), notes_included: value.notesIncluded,
  };
  return [CSV_COLUMNS.map(csvCell).join(','), ...rows.map(row => CSV_COLUMNS.map(key => csvCell(({ ...shared, ...row } as Record<string, unknown>)[key])).join(','))].join('\r\n');
}
export function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
function link(raw: unknown, label: string): string {
  const url = safeExternalHttpUrl(raw);
  return url ? `<a href="${escapeHtml(url.href)}" rel="noopener noreferrer" referrerpolicy="no-referrer">${escapeHtml(label)}</a>` : `${escapeHtml(label)} (unsafe or unavailable link omitted)`;
}

/** Self-contained printable brief: no script, images, tiles, fonts, or network dependencies. */
export function serializeBrief(value: EvidenceExport): string {
  const { packet } = value;
  const entries = packet.entries.map(entry => {
    const event = entry.event;
    const provenance = event?.descriptionProvenance;
    return `<article><h2>${escapeHtml(event?.title ?? entry.selection.title)}</h2><p>Canonical event: ${escapeHtml(entry.selection.id)}</p>
      ${entry.selection.representative ? `<p>Selected aggregate representative (${entry.selection.representedStoryCount} stories represented); only this individual event was resolved.</p>` : ''}
      <p>Request: ${escapeHtml(entry.requestStartedAt)} · Response: ${escapeHtml(entry.responseReceivedAt)}</p>
      ${entry.error ? `<p>Capture error: ${escapeHtml(entry.error)}</p>` : `<p>Published: ${escapeHtml(event?.publishedAt)} · Headline source time: ${escapeHtml(event?.headlinePublishedAt ?? 'not reported')}</p>
      <p>${escapeHtml(event?.locationName)} ${event?.latitude !== undefined ? `(${escapeHtml(event.latitude)}, ${escapeHtml(event.longitude)})` : ''}</p>
      <p class="text">${escapeHtml(event?.description)}</p><p>${link(event?.url, event?.source ?? 'Original source')}</p>
      ${provenance ? `<p>Description supplied by ${link(provenance.url, provenance.name)}, source time ${escapeHtml(provenance.published_at)}, credibility tier ${escapeHtml(provenance.tier)}.</p>` : '<p>Description provenance not reported.</p>'}
      <p>Timeline restricted: ${escapeHtml(entry.restrictions?.timelineRestricted)} · Returned: ${escapeHtml(entry.restrictions?.returnedSources)} / ${escapeHtml(entry.restrictions?.totalSources ?? 'unknown')} · Locally truncated: ${escapeHtml(entry.restrictions?.sourcesTruncated)} · Detail may use a server cache up to 60 seconds.</p>
      <ul>${(event?.sources ?? []).map(s => `<li>${link(s.url, s.name)} · ${escapeHtml(s.sourceType)} · Discovered: ${escapeHtml(s.discoveredAt)} <small>${escapeHtml(s.url)}</small></li>`).join('')}</ul>`}
      ${value.notesIncluded && value.privateNotes?.[entry.selection.id] ? `<h3>Private note included by request</h3><p class="text">${escapeHtml(value.privateNotes[entry.selection.id])}</p>` : ''}</article>`;
  }).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><meta name="referrer" content="no-referrer"><title>Seraphim evidence brief</title><style>
  body{font:15px/1.5 system-ui,sans-serif;color:#18202a;max-width:850px;margin:24px auto;padding:0 20px}h1,h2,h3{line-height:1.25}article{border-top:1px solid #bbb;margin-top:24px;padding-top:12px}p,li{overflow-wrap:anywhere}small{display:block}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px}.text{white-space:pre-wrap}a{color:#253eb8}@media print{body{font-size:11pt;margin:0;max-width:none}h2,h3{break-after:avoid}a{color:inherit}li{break-inside:avoid}}
  </style></head><body><h1>Seraphim evidence brief</h1><p>Packet ${escapeHtml(packet.id)}</p><p>Capture started ${escapeHtml(packet.captureStartedAt)}<br>Capture ended ${escapeHtml(packet.captureEndedAt)}<br>Access checked ${escapeHtml(packet.checkedAt)} · Tier ${escapeHtml(packet.accessTierAtCapture)}</p><p>${escapeHtml(packet.disclaimer)}</p><p>Private notes: ${value.notesIncluded ? 'explicitly included below' : 'excluded'}. Selection may include events selected under earlier dashboard scopes. Feed freshness is not reported by the dashboard hook; this packet does not assert a fresh or complete list.</p><h2>Dashboard scope at capture</h2><pre>${escapeHtml(JSON.stringify(packet.scope, null, 2))}</pre>${entries}</body></html>`;
}
