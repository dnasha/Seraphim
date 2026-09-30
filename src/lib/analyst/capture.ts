import { MAX_SELECTION, MAX_SOURCES, PACKET_DISCLAIMER, UUID, type AnalystSelection, type EvidenceEntry, type EvidencePacket, type EvidenceScope } from './types';
import { copyEvent, copyPacket, copyScope, record } from './schema';
import type { UserTier } from '@/lib/entitlements';

export class EvidenceAccessError extends Error {}
export async function checkEvidenceAccess(ownerId: string, signal: AbortSignal, fetcher = fetch): Promise<UserTier> {
  const response = await fetcher('/api/analyst/access', { signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]), cache: 'no-store', credentials: 'same-origin' });
  if (response.status === 401 || response.status === 403) throw new EvidenceAccessError('Evidence access changed. Sign in with an Analyst or Angel account.');
  if (!response.ok) throw new Error('Could not verify access. Try again.');
  const value = record(await response.json());
  if (value.userId !== ownerId || !['analyst', 'angel'].includes(String(value.tier))) throw new EvidenceAccessError('The active account changed. Reopen the evidence workspace.');
  signal.throwIfAborted();
  return value.tier as UserTier;
}

async function boundedJson(response: Response): Promise<unknown> {
  if (!response.body) throw new Error('Empty detail response.');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      size += result.value.byteLength;
      if (size > 512_000) throw new Error('Detail response exceeded the capture size limit.');
      chunks.push(result.value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder().decode(bytes));
}

/** At most 20 deliberate exact-ID reads, three at a time; no listing or scraping. */
export async function captureEvidence({ ownerId, selections, scope, signal, fetcher = fetch, now = () => new Date().toISOString(), onProgress }: {
  ownerId: string; selections: AnalystSelection[]; scope: EvidenceScope; signal: AbortSignal;
  fetcher?: typeof fetch; now?: () => string; onProgress?: (done: number) => void;
}): Promise<EvidencePacket> {
  if (!selections.length || selections.length > MAX_SELECTION || selections.some(s => !UUID.test(s.id)) || new Set(selections.map(s => s.id)).size !== selections.length) throw new Error('Choose 1–20 distinct canonical events.');
  const capturedScope = copyScope(scope);
  const selected = selections.map(s => ({ ...s }));
  const captureStartedAt = now();
  const tier = await checkEvidenceAccess(ownerId, signal, fetcher);
  const entries: EvidenceEntry[] = new Array(selected.length);
  const siblings = new AbortController();
  const workSignal = AbortSignal.any([signal, siblings.signal]);
  let next = 0;
  let done = 0;
  async function worker() {
    while (next < selected.length) {
      workSignal.throwIfAborted();
      const index = next++;
      const selection = selected[index];
      const requestStartedAt = now();
      const timeout = AbortSignal.timeout(15_000);
      const requestSignal = AbortSignal.any([workSignal, timeout]);
      try {
        const res = await fetcher(`/api/news/${encodeURIComponent(selection.id)}?evidence=true`, { signal: requestSignal, cache: 'no-store', credentials: 'same-origin' });
        if (res.status === 401 || res.status === 403) throw new EvidenceAccessError('Evidence access changed during capture.');
        if (!res.ok) throw new Error(res.status === 404 ? 'Event no longer available (404).' : res.status === 429 ? 'Request limit reached (429). Try a smaller selection later.' : `Detail unavailable (HTTP ${res.status}).`);
        const raw = record(await boundedJson(res));
        workSignal.throwIfAborted();
        const returned = record(raw.event);
        if (typeof raw.timelineRestricted !== 'boolean' || !Array.isArray(raw.sources)) throw new Error('Detail response did not report source restrictions.');
        const event = copyEvent({ ...returned, sources: raw.sources.slice(0, MAX_SOURCES).map(value => {
          const source = record(value);
          return { name: source.name, url: source.url, sourceType: source.source_type, discoveredAt: source.discovered_at };
        }) });
        if (event.id !== selection.id) throw new Error('The detail response did not match the selected event.');
        entries[index] = {
          selection, requestStartedAt, responseReceivedAt: now(), status: 'captured', event,
          restrictions: { timelineRestricted: raw.timelineRestricted, totalSources: typeof raw.totalSources === 'number' && Number.isFinite(raw.totalSources) && raw.totalSources >= 0 ? raw.totalSources : null,
            returnedSources: event.sources?.length ?? 0, sourcesTruncated: raw.sources.length > MAX_SOURCES, detailCache: 'server-cache-up-to-60s' },
        };
      } catch (error) {
        workSignal.throwIfAborted();
        if (error instanceof EvidenceAccessError) { siblings.abort(error); throw error; }
        entries[index] = { selection, requestStartedAt, responseReceivedAt: now(), status: 'error', error: timeout.aborted ? 'Detail request timed out after 15 seconds.' : error instanceof Error ? error.message.slice(0, 1000) : 'Detail could not be captured.' };
      }
      onProgress?.(++done);
    }
  }
  await Promise.all(Array.from({ length: Math.min(3, selected.length) }, worker));
  const captureEndedAt = now();
  await checkEvidenceAccess(ownerId, signal, fetcher);
  signal.throwIfAborted();
  return copyPacket({ version: 1, id: crypto.randomUUID(), captureStartedAt, captureEndedAt, checkedAt: now(), accessTierAtCapture: tier, scope: capturedScope, entries, disclaimer: PACKET_DISCLAIMER });
}
