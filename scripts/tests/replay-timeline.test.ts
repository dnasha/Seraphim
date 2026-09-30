import { describe, expect, it } from 'vitest';
import type { NewsItem } from '@/lib/core/types';
import { advanceReplay, captureReplay, compareReplayWindows, inReplayWindow, replayBounds, replayFrame, replayTime, reportTimestamp, selectionOutsideReplay, validReplayWindow } from '@/lib/experiments/replay';

const start = Date.parse('2026-09-29T00:00:00Z');
const hour = 3_600_000;
const end = start + 24 * hour;
const iso = (timestamp: number) => new Date(timestamp).toISOString();
const item = (id: string, eventAt: number, activity: number[] = []): NewsItem => ({
    id, title: `Fixture ${id}`, source: 'Fixture', sourceType: 'rss', url: `https://example.com/${id}`,
    publishedAt: iso(eventAt), latitude: 42, longitude: 10,
    sources: activity.map((timestamp, index) => ({ name: `Fixture source ${index}`, url: `https://example.com/${id}/${index}`, sourceType: 'rss', discoveredAt: iso(timestamp) })),
});
const capture = (items: NewsItem[]) => captureReplay({ mapItems: items, sidebarItems: items, capturedAt: end, bounds: { start, end }, timeRange: '1d', isCapped: true, appliedLimit: 1000 });

describe('reporting reconstruction dates and coverage', () => {
    it('normalizes explicit offsets to the same instant, without assuming a browser timezone', () => {
        expect(reportTimestamp('2026-09-29T05:30:00+05:30')).toBe(start);
        expect(reportTimestamp('2026-09-28T17:00:00-07:00')).toBe(start);
        expect(reportTimestamp('2026-09-29T00:00:00.123456+00:00')).toBe(start + 123);
        expect(replayTime(start)).toBe('2026-09-29 00:00:00 UTC');
    });
    it.each([undefined, '', 'unknown', '2026-09-29', '2026-09-29T00:00:00', '2026-02-30T00:00:00Z', '2026-13-01T00:00:00Z', '2026-09-29T24:00:00Z', '2026-09-29T00:00:60Z'])('excludes invalid or ambiguous report date %s without inventing a fallback', value => {
        expect(reportTimestamp(value)).toBeNull();
    });
    it('enforces fullTimeline and permitted preset/custom bounds', () => {
        for (const tier of ['guest', 'free'] as const) expect(replayBounds(tier, '1d', '', '', end)).toBeNull();
        for (const range of ['1d', '3d', '1w', '1m']) expect(replayBounds('pro', range, '', '', end)?.end).toBe(end);
        expect(replayBounds('pro', 'custom', iso(start), iso(end), end)).toBeNull();
        expect(replayBounds('pro', 'all', '', '', end)).toBeNull();
        for (const tier of ['analyst', 'angel'] as const) {
            expect(replayBounds(tier, 'custom', iso(start), iso(end + hour), end)).toEqual({ start, end });
            expect(replayBounds(tier, 'custom', iso(end), iso(start), end)).toBeNull();
            expect(replayBounds(tier, 'custom', 'bad', '', end)).toBeNull();
        }
    });
    it('keeps capture time distinct from publication/feed time and freezes nested metadata', () => {
        const row = item('event', start + hour, [start + 2 * hour]);
        row.tags = ['initial'];
        const snapshot = capture([row]);
        row.title = 'Late title';
        row.publishedAt = iso(end);
        row.sources![0].discoveredAt = iso(end);
        row.tags.push('late');
        expect(snapshot.capturedAt).toBe(end);
        expect(snapshot.entries[0].item.title).toBe('Fixture event');
        expect(snapshot.entries[0].item.tags).toEqual(['initial']);
        expect(snapshot.entries[0].activity).toEqual([start + hour, start + 2 * hour]);
        expect(snapshot.isCapped).toBe(true);
    });
    it('deduplicates canonical representatives and never counts spatial cluster ids as events', () => {
        const representative = { ...item('cluster-z1-spatial', start), originalId: 'event', clusterSize: 9 };
        const snapshot = capture([representative, item('event', start), item('cluster-z2-unknown', start)]);
        expect(snapshot.entries.map(entry => entry.item.originalId)).toEqual(['event']);
        expect(snapshot.clustered).toBe(true);
        expect(compareReplayWindows(snapshot, { start, end }, { start, end }).a.events).toBe(1);
        expect(snapshot.entries[0].item.clusterSize).toBe(9);
    });
    it('ignores invalid/future timestamps and dates outside coverage; no fallback to now', () => {
        const noDates = { ...item('invalid', start), publishedAt: 'bad' };
        const sourceOnly = { ...item('source-only', start, [start + hour]), publishedAt: 'bad', latestActivityAt: iso(end + hour) };
        const snapshot = capture([noDates, sourceOnly, item('too-old', start - 1), item('future', end + 1)]);
        expect(snapshot.excludedRows).toBe(3);
        expect(snapshot.excludedDates).toBe(4);
        expect(snapshot.entries[0].eventAt).toBeNull();
        expect(snapshot.entries[0].activity).toEqual([start + hour]);
        expect(compareReplayWindows(snapshot, { start, end }, { start, end }).a).toEqual({ events: 0, active: 1, points: 1 });
    });
});

describe('deterministic frames and window comparisons', () => {
    const snapshot = capture([item('old-active', start - hour, [start, start + 12 * hour]), item('new', start + 12 * hour, [end]), item('early', start + hour), item('end', end)]);
    it('includes exact scrub boundaries and keeps out-of-window selection as a separate signal', () => {
        expect(replayFrame(snapshot, { start, end: start + hour }).mapItems.map(row => row.id)).toEqual(['old-active', 'early']);
        expect(selectionOutsideReplay(snapshot, { start, end: start + hour }, 'new')).toBe(true);
        expect(selectionOutsideReplay(snapshot, { start, end: start + hour }, 'early')).toBe(false);
        expect(selectionOutsideReplay(snapshot, { start, end }, 'missing')).toBe(true);
        expect(selectionOutsideReplay(snapshot, { start, end }, null)).toBe(false);
        expect(replayFrame(snapshot, { start: end, end }).mapItems.map(row => row.id)).toEqual(['new', 'end']);
    });
    it('avoids double-counting adjacent windows and retains the final endpoint', () => {
        const midpoint = start + 12 * hour;
        expect(inReplayWindow(midpoint, { start, end: midpoint }, end)).toBe(false);
        expect(inReplayWindow(midpoint, { start: midpoint, end }, end)).toBe(true);
        expect(inReplayWindow(end, { start: midpoint, end }, end)).toBe(true);
        expect(compareReplayWindows(snapshot, { start, end: midpoint }, { start: midpoint, end })).toEqual({
            a: { events: 1, active: 2, points: 2 }, b: { events: 2, active: 3, points: 4 }, newRepresented: 2, reportingOverlap: 1,
        });
    });
    it('computes overlap and newly represented dates for overlapping windows', () => {
        expect(compareReplayWindows(snapshot, { start, end }, { start: start + 12 * hour, end }).newRepresented).toBe(0);
        expect(compareReplayWindows(snapshot, { start, end }, { start, end }).reportingOverlap).toBe(4);
    });
    it('rejects unbounded, empty, reversed and nonfinite windows', () => {
        for (const window of [{ start: start - 1, end }, { start, end: end + 1 }, { start, end: start }, { start: NaN, end }, { start: end, end: start }]) expect(validReplayWindow(window, { start, end })).toBe(false);
        expect(validReplayWindow({ start, end }, { start, end })).toBe(true);
    });
    it('advances deterministically and clamps playback at the end', () => {
        expect(advanceReplay(start, { start, end })).toBe(start + 24 * hour / 60);
        expect(advanceReplay(end - 1, { start, end })).toBe(end);
        expect(advanceReplay(end, { start, end })).toBe(end);
    });
});
