import { describe, expect, it, vi } from 'vitest';
import { captureEvidence, checkEvidenceAccess, EvidenceAccessError } from '@/lib/analyst/capture';
import { selectionFor, toggleSelection } from '@/lib/analyst/selection';
import { copyPacket, copyStore } from '@/lib/analyst/schema';
import { csvCell, escapeHtml, exportCopy, serializeBrief, serializeCsv, serializeJson } from '@/lib/analyst/serializers';
import { emptyStore, loadStore, saveStore, storageKey } from '@/lib/analyst/storage';
import { MAX_SELECTION, MAX_SOURCES, MAX_STORAGE_BYTES } from '@/lib/analyst/types';
import { analystEvent, analystId, analystScope, detailBody, fixturePacket, observedAt } from './fixtures/analyst';

const signal = () => new AbortController().signal;
const okAccess = () => Response.json({ userId: 'owner', tier: 'analyst' });
const fetcher = (fn: (url: string, options?: RequestInit) => Promise<Response> | Response) => vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => fn(String(input), options)) as unknown as typeof fetch;
const select = (index = 1) => selectionFor(analystEvent(index), observedAt)!;

describe('analyst captures', () => {
  it('deduplicates raw and aggregate identities and rejects unresolved clusters without changing the pin', () => {
    const event = analystEvent();
    const aggregate = { ...event, id: 'cluster-z4-9', originalId: event.id, storyCount: 6 };
    const selection = toggleSelection([], aggregate);
    expect(selection[0]).toMatchObject({ id: event.id, representative: true, representedStoryCount: 6 });
    expect(toggleSelection(selection, event)).toEqual([]);
    expect(selectionFor({ ...aggregate, originalId: undefined })).toBeNull();
    expect(() => toggleSelection([], { ...aggregate, originalId: undefined })).toThrow(/no resolvable/);
    expect(() => toggleSelection(Array.from({ length: MAX_SELECTION }, (_, i) => select(i + 1)), analystEvent(30))).toThrow(/20/);
  });
  it('makes immutable allowlisted copies with distinct capture/publication/response timestamps', async () => {
    const event = analystEvent();
    const source = detailBody(event);
    const fetch = fetcher(url => url.includes('/access') ? okAccess() : Response.json({ ...source, event: { ...event, imageUrl: 'https://tracker.invalid', secret: 'never-copy', originalId: 'cluster-z4-9' } }));
    let second = 0;
    const scope = structuredClone(analystScope);
    const packet = await captureEvidence({ ownerId: 'owner', selections: [select()], scope, signal: signal(), fetcher: fetch,
      now: () => new Date(Date.parse(observedAt) + second++ * 1000).toISOString() });
    event.title = 'live merge changed'; scope.query = 'later query'; source.sources[0].name = 'later publisher';
    expect(packet.entries[0].event?.title).toBe('Fixture event 1');
    expect(packet.scope.query).toBe('');
    expect(packet.entries[0].event).not.toHaveProperty('secret');
    expect(packet.entries[0].event).not.toHaveProperty('imageUrl');
    expect(packet.captureStartedAt).not.toBe(packet.captureEndedAt);
    expect(packet.entries[0].responseReceivedAt).not.toBe(packet.entries[0].event?.publishedAt);
    expect(Object.isFrozen(packet.entries[0].event?.sources?.[0])).toBe(true);
    expect(() => { packet.entries[0].event!.title = 'mutation'; }).toThrow();
    expect(fetch).toHaveBeenCalledWith(`/api/news/${analystId()}?evidence=true`, expect.objectContaining({ cache: 'no-store', signal: expect.any(AbortSignal) }));
    expect(fetch).toHaveBeenCalledTimes(3);
  });
  it('caps concurrency at three, preserves order, and records partial HTTP/malformed failures', async () => {
    let active = 0; let peak = 0;
    const fetch = fetcher(async url => {
      if (url.includes('access')) return okAccess();
      active++; peak = Math.max(peak, active);
      await new Promise(resolve => setTimeout(resolve, 3)); active--;
      const index = Number(url.match(/(\d{12})\?/)![1]);
      if (index === 2) return Response.json({}, { status: 404 });
      if (index === 4) return Response.json({ event: { id: analystId(4) } });
      return Response.json(detailBody(analystEvent(index)));
    });
    const packet = await captureEvidence({ ownerId: 'owner', selections: [1, 2, 3, 4, 5].map(select), scope: analystScope, signal: signal(), fetcher: fetch });
    expect(peak).toBe(3);
    expect(packet.entries.map(e => e.selection.id)).toEqual([1, 2, 3, 4, 5].map(analystId));
    expect(packet.entries.map(e => e.status)).toEqual(['captured', 'error', 'captured', 'error', 'captured']);
    expect(packet.entries[1].error).toContain('404');
    expect(packet.entries[3].error).toContain('restrictions');
  });
  it('preserves server restrictions, only authorized sources, and marks bounded source truncation', async () => {
    const body = detailBody();
    body.timelineRestricted = true; body.totalSources = 400;
    body.sources = Array.from({ length: MAX_SOURCES + 2 }, (_, i) => ({ ...body.sources[0], name: `Source ${i}` }));
    const packet = await captureEvidence({ ownerId: 'owner', selections: [select()], scope: analystScope, signal: signal(), fetcher: fetcher(url => url.includes('access') ? okAccess() : Response.json(body)) });
    expect(packet.entries[0].restrictions).toMatchObject({ timelineRestricted: true, totalSources: 400, returnedSources: MAX_SOURCES, sourcesTruncated: true });
    expect(packet.entries[0].event?.sources).toHaveLength(MAX_SOURCES);
  });
  it('rejects mismatched detail IDs, oversized streams and duplicate capture selections', async () => {
    const run = (fetch: typeof globalThis.fetch) => captureEvidence({ ownerId: 'owner', selections: [select()], scope: analystScope, signal: signal(), fetcher: fetch });
    const mismatched = await run(fetcher(url => url.includes('access') ? okAccess() : Response.json(detailBody(analystEvent(2)))));
    expect(mismatched.entries[0].error).toContain('match');
    const oversized = await run(fetcher(url => url.includes('access') ? okAccess() : new Response(' '.repeat(512001))));
    expect(oversized.entries[0].error).toContain('size limit');
    await expect(captureEvidence({ ownerId: 'owner', selections: [select(), select()], scope: analystScope, signal: signal() })).rejects.toThrow(/distinct/);
  });
  it('cancels pending details and discards the packet on access revocation at the final check', async () => {
    const controller = new AbortController();
    const fetching = captureEvidence({ ownerId: 'owner', selections: [select()], scope: analystScope, signal: controller.signal,
      fetcher: fetcher(async (url, options) => {
        if (url.includes('access')) return okAccess();
        return new Promise((_resolve, reject) => options?.signal?.addEventListener('abort', () => reject(options.signal?.reason), { once: true }));
      }) });
    await new Promise(resolve => setTimeout(resolve, 0)); controller.abort();
    await expect(fetching).rejects.toMatchObject({ name: 'AbortError' });
    let accessCount = 0;
    await expect(captureEvidence({ ownerId: 'owner', selections: [select()], scope: analystScope, signal: signal(), fetcher: fetcher(url => {
      if (url.includes('access')) return ++accessCount === 1 ? okAccess() : new Response('', { status: 403 });
      return Response.json(detailBody());
    }) })).rejects.toBeInstanceOf(EvidenceAccessError);
  });
  it('aborts sibling requests immediately on a detail authorization failure', async () => {
    let pendingSignal: AbortSignal | undefined;
    const request = captureEvidence({ ownerId: 'owner', selections: [select(1), select(2), select(3)], scope: analystScope, signal: signal(), fetcher: fetcher(async (url, options) => {
      if (url.includes('access')) return okAccess();
      if (url.includes(analystId(1))) {
        await new Promise(resolve => setTimeout(resolve, 1));
        return new Response('', { status: 403 });
      }
      pendingSignal = options?.signal as AbortSignal;
      return new Promise<Response>((_resolve, reject) => pendingSignal!.addEventListener('abort', () => reject(pendingSignal!.reason), { once: true }));
    }) });
    await expect(request).rejects.toBeInstanceOf(EvidenceAccessError);
    expect(pendingSignal?.aborted).toBe(true);
  });
  it('records a timed-out detail as a partial error and can still complete the packet', async () => {
    const timeouts: AbortController[] = [];
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => {
      const controller = new AbortController(); timeouts.push(controller); return controller.signal;
    });
    try {
      const request = captureEvidence({ ownerId: 'owner', selections: [select()], scope: analystScope, signal: signal(), fetcher: fetcher(async (url, options) => {
        if (url.includes('access')) return okAccess();
        queueMicrotask(() => timeouts[1].abort(new DOMException('Timed out', 'TimeoutError')));
        return new Promise<Response>((_resolve, reject) => options?.signal?.addEventListener('abort', () => reject(options.signal?.reason), { once: true }));
      }) });
      const packet = await request;
      expect(packet.entries[0]).toMatchObject({ status: 'error', error: 'Detail request timed out after 15 seconds.' });
      expect(timeouts).toHaveLength(3);
    } finally { timeout.mockRestore(); }
  });
  it('checks identity and refuses unauthenticated, expired, and unavailable access', async () => {
    for (const status of [401, 403]) await expect(checkEvidenceAccess('owner', signal(), fetcher(() => new Response('', { status })))).rejects.toBeInstanceOf(EvidenceAccessError);
    await expect(checkEvidenceAccess('other-owner', signal(), fetcher(okAccess))).rejects.toBeInstanceOf(EvidenceAccessError);
    await expect(checkEvidenceAccess('owner', signal(), fetcher(() => new Response('', { status: 503 })))).rejects.toThrow(/verify access/);
  });
});

describe('safe evidence exports and local storage', () => {
  it('excludes private notes by default and copies only packet-related notes after explicit inclusion', () => {
    const packet = fixturePacket(); const notes = { [analystId()]: 'PRIVATE', [analystId(2)]: 'UNRELATED' };
    const defaultExport = exportCopy(packet, notes);
    for (const serialize of [serializeJson, serializeCsv, serializeBrief]) {
      expect(serialize(defaultExport)).not.toContain('PRIVATE');
      expect(serialize(defaultExport)).not.toContain('UNRELATED');
    }
    const included = exportCopy(packet, notes, true); notes[analystId()] = 'later note';
    expect(included.privateNotes).toEqual({ [analystId()]: 'PRIVATE' });
    expect(packet).not.toHaveProperty('privateNotes');
    expect(serializeJson(included)).toContain('PRIVATE');
  });
  it('escapes formulas, quotes, commas, line breaks, whitespace-prefixed formulas and control characters in CSV', () => {
    for (const text of ['=HYPERLINK("bad")', ' +cmd', '-2+3', '@SUM(1)', '\t=1', '\r\n=3', '\u0000=5']) expect(csvCell(text)).toMatch(/^"'/);
    expect(csvCell('a,"b"\nc')).toBe('"a,""b""\nc"');
    expect(csvCell(null)).toBe('""');
    const csv = serializeCsv(exportCopy(fixturePacket(), {}));
    expect(csv).toContain('"event"'); expect(csv).toContain('"source"');
    expect(csv).toContain('"description_provenance_json"'); expect(csv).toContain('"scope_json"');
  });
  it('escapes every brief field and blocks javascript/data/credential links without image or script dependencies', () => {
    const event = analystEvent();
    event.title = '<script>alert("x")</script>'; event.description = '<img src=x onerror=alert(1)>';
    event.url = 'javascript:alert(1)'; event.descriptionProvenance!.url = 'data:text/html,<script>x</script>';
    event.sources = [{ name: 'bad <svg>', url: 'https://user:pass@example.invalid', sourceType: 'rss', discoveredAt: 'today' }, { name: 'safe', url: 'https://example.invalid/?a="&b=<>', sourceType: 'rss', discoveredAt: observedAt }];
    const html = serializeBrief(exportCopy(fixturePacket(event), { [event.id]: '<iframe>note</iframe>' }, true));
    expect(html).not.toMatch(/<script|<img|<iframe|href="javascript:|href="data:/);
    expect(html).not.toContain('href="https://user:pass');
    expect(html).toContain('&lt;script&gt;'); expect(html).toContain('&lt;iframe&gt;note');
    expect(html).toContain('href="https://example.invalid/');
    expect(html).toContain("default-src 'none'"); expect(html).toContain('@media print');
    expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;');
  });
  it('validates local packets and notes, omits unknown fields, isolates owners and supports deletion', () => {
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
    const store = { ...emptyStore('owner'), packets: [fixturePacket()], notes: { [analystId()]: 'note' } };
    saveStore(storage, store);
    expect(loadStore(storage, 'owner').packets[0].entries[0].event?.title).toBe('Fixture event 1');
    expect(loadStore(storage, 'other')).toEqual(emptyStore('other'));
    const raw = JSON.parse(values.get(storageKey('owner'))!); raw.packets[0].secret = 'do not export';
    expect(copyStore(raw, 'owner').packets[0]).not.toHaveProperty('secret');
    expect(() => copyStore(raw, 'other')).toThrow(/account/);
    raw.packets[0].entries[0].selection.id = 'cluster-z4-9';
    expect(() => copyStore(raw, 'owner')).toThrow(/canonical/);
    values.set(storageKey('owner'), '{broken'); expect(() => loadStore(storage, 'owner')).toThrow(/invalid/);
    storage.removeItem(storageKey('owner')); expect(loadStore(storage, 'owner')).toEqual(emptyStore('owner'));
  });
  it('refuses oversized stores, too many packets/notes and unavailable browser storage without silently evicting', () => {
    const store = { ...emptyStore('owner'), packets: Array.from({ length: 9 }, () => fixturePacket()) };
    expect(() => saveStore({ getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() }, store)).toThrow(/list/);
    expect(() => saveStore({ getItem: vi.fn(), setItem: () => { throw new Error('QuotaExceeded'); }, removeItem: vi.fn() }, emptyStore('owner'))).toThrow(/save locally/);
    expect(() => loadStore({ getItem: () => 'x'.repeat(MAX_STORAGE_BYTES), setItem: vi.fn(), removeItem: vi.fn() }, 'owner')).toThrow(/size limit/);
    const oversized = { ...emptyStore('owner'), notes: { [analystId()]: 'x'.repeat(2001) } };
    expect(() => copyStore(oversized, 'owner')).toThrow(/oversized/);
    const tampered = JSON.parse(JSON.stringify(fixturePacket())); tampered.entries[0].event.id = analystId(2);
    expect(() => copyPacket(tampered)).toThrow(/identity/);
  });
});
