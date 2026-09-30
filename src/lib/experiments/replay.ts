/** Reporting reconstruction from a bounded loaded view, never a historical database. */
import type { NewsItem } from '@/lib/core/types';
import { canUseTimeRange, hasFeature, type UserTier } from '@/lib/entitlements';
import { dateTimeInputValue } from '@/lib/utils/dateTimeInput';
import { canonicalNewsId, matchesNewsId } from '@/lib/utils/ranking';

export interface ReplayWindow { start: number; end: number }
export interface ReplayEntry {
    item: NewsItem;
    eventAt: number | null;
    activity: number[];
    onMap: boolean;
    inSidebar: boolean;
}
export interface ReplaySnapshot {
    capturedAt: number;
    feedUpdatedAt?: string | null;
    bounds: ReplayWindow;
    timeRange: string;
    entries: ReplayEntry[];
    isCapped: boolean;
    appliedLimit?: number;
    excludedRows: number;
    excludedDates: number;
    clustered: boolean;
}

const PRESET_MS: Record<string, number> = { '1d': 86_400_000, '3d': 259_200_000, '1w': 604_800_000, '1m': 2_592_000_000 };

/** Require an explicit timezone and a real calendar date; never substitute now. */
export function reportTimestamp(value: string | undefined): number | null {
    if (!value) return null;
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/i.exec(value);
    if (!match) return null;
    const [, year, month, day, hour, minute, second] = match;
    const days = new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate();
    if (Number(month) < 1 || Number(month) > 12 || Number(day) < 1 || Number(day) > days || Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) return null;
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? timestamp : null;
}

/** The capture action and its disabled explanation share the same validation. */
export function checkReplayCapture(tier: UserTier, timeRange: string, start: string, end: string, capturedAt: number): { bounds: ReplayWindow | null; reason: string | null } {
    const unavailable = (reason: string) => ({ bounds: null, reason });
    if (!hasFeature(tier, 'fullTimeline')) return unavailable('Reporting replay requires Pro or higher.');
    if (!canUseTimeRange(tier, timeRange)) return unavailable('This reporting range is unavailable on your plan.');
    if (!Number.isFinite(capturedAt)) return unavailable('The current reporting time is unavailable.');
    if (timeRange === 'custom') {
        const parseBound = (value: string) => {
            if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return reportTimestamp(`${value}T00:00:00Z`);
            if (/(Z|[+-]\d{2}:\d{2})$/i.test(value)) return reportTimestamp(value.replace(/T(\d{2}:\d{2})(Z|[+-]\d{2}:\d{2})$/i, 'T$1:00$2'));
            return replayInputTimestamp(value);
        };
        const from = parseBound(start);
        const until = parseBound(end);
        if (from === null || until === null) return unavailable('Choose valid custom start and end dates.');
        if (from >= until) return unavailable('Choose a custom end date after the start date.');
        if (from >= capturedAt) return unavailable('Choose a custom start date before now; future reporting cannot be reconstructed.');
        return { bounds: { start: from, end: Math.min(until, capturedAt) }, reason: null };
    }
    const duration = PRESET_MS[timeRange];
    return duration ? { bounds: { start: capturedAt - duration, end: capturedAt }, reason: null } : unavailable('Choose a supported reporting range.');
}

export function replayBounds(tier: UserTier, timeRange: string, start: string, end: string, capturedAt: number): ReplayWindow | null {
    return checkReplayCapture(tier, timeRange, start, end, capturedAt).bounds;
}

export function captureReplay(input: {
    mapItems: NewsItem[]; sidebarItems: NewsItem[]; bounds: ReplayWindow; capturedAt: number;
    timeRange: string; isCapped: boolean; appliedLimit?: number; feedUpdatedAt?: string | null;
}): ReplaySnapshot {
    const rows = new Map<string, { item: NewsItem; onMap: boolean; inSidebar: boolean }>();
    for (const [items, membership] of [[input.mapItems, 'onMap'], [input.sidebarItems, 'inSidebar']] as const) {
        for (const item of items) {
            const id = canonicalNewsId(item);
            // Spatial IDs without an individual representative are not event identities.
            if (id.startsWith('cluster-')) continue;
            const row = rows.get(id) ?? { item, onMap: false, inSidebar: false };
            row[membership] = true;
            rows.set(id, row);
        }
    }
    let excludedDates = 0;
    let excludedRows = 0;
    const entries: ReplayEntry[] = [];
    for (const row of rows.values()) {
        const item: NewsItem = {
            ...row.item,
            sources: row.item.sources?.map(source => ({ ...source })),
            tags: row.item.tags?.slice(),
            foundLocations: row.item.foundLocations?.slice(),
            descriptionProvenance: row.item.descriptionProvenance ? { ...row.item.descriptionProvenance } : row.item.descriptionProvenance,
        };
        const values = [item.publishedAt, item.latestActivityAt, ...(item.sources ?? []).map(source => source.discoveredAt)];
        const activity = new Set<number>();
        for (const value of values) {
            if (value === undefined) continue;
            const timestamp = reportTimestamp(value);
            if (timestamp === null || timestamp > input.capturedAt) { excludedDates++; continue; }
            if (timestamp >= input.bounds.start && timestamp <= input.bounds.end) activity.add(timestamp);
        }
        if (!activity.size) { excludedRows++; continue; }
        entries.push({ item, eventAt: reportTimestamp(item.publishedAt), activity: [...activity].sort((a, b) => a - b), onMap: row.onMap, inSidebar: row.inSidebar });
    }
    return {
        capturedAt: input.capturedAt, feedUpdatedAt: input.feedUpdatedAt, bounds: { ...input.bounds },
        timeRange: input.timeRange, entries, isCapped: input.isCapped, appliedLimit: input.appliedLimit,
        excludedRows, excludedDates,
        clustered: entries.some(entry => entry.item.id.startsWith('cluster-') || (entry.item.clusterSize ?? 1) > 1),
    };
}

/** Half-open windows share no boundary point; the snapshot's final endpoint is included. */
export function inReplayWindow(timestamp: number, window: ReplayWindow, coverageEnd: number): boolean {
    return timestamp >= window.start && (timestamp < window.end || (window.end === coverageEnd && timestamp === window.end));
}

export function validReplayWindow(window: ReplayWindow, bounds: ReplayWindow): boolean {
    return Number.isFinite(window.start) && Number.isFinite(window.end) && window.start < window.end && window.start >= bounds.start && window.end <= bounds.end;
}

export function replayFrame(snapshot: ReplaySnapshot, window: ReplayWindow) {
    const entries = snapshot.entries.filter(entry => entry.activity.some(timestamp => timestamp >= window.start && timestamp <= window.end));
    return { mapItems: entries.filter(entry => entry.onMap).map(entry => entry.item), sidebarItems: entries.filter(entry => entry.inSidebar).map(entry => entry.item) };
}

export function selectionOutsideReplay(snapshot: ReplaySnapshot, window: ReplayWindow, id: string | null): boolean {
    return Boolean(id) && !snapshot.entries.some(entry => matchesNewsId(entry.item, id) && entry.activity.some(timestamp => timestamp >= window.start && timestamp <= window.end));
}

export function compareReplayWindows(snapshot: ReplaySnapshot, a: ReplayWindow, b: ReplayWindow) {
    const summarize = (window: ReplayWindow) => {
        const events = new Set<string>();
        const active = new Set<string>();
        let points = 0;
        for (const entry of snapshot.entries) {
            const id = canonicalNewsId(entry.item);
            if (entry.eventAt !== null && inReplayWindow(entry.eventAt, window, snapshot.bounds.end)) events.add(id);
            const hits = entry.activity.filter(timestamp => inReplayWindow(timestamp, window, snapshot.bounds.end)).length;
            if (hits) active.add(id);
            points += hits;
        }
        return { events, active, points };
    };
    const first = summarize(a);
    const second = summarize(b);
    return {
        a: { events: first.events.size, active: first.active.size, points: first.points },
        b: { events: second.events.size, active: second.active.size, points: second.points },
        newRepresented: [...second.events].filter(id => !first.events.has(id)).length,
        reportingOverlap: [...second.active].filter(id => first.active.has(id)).length,
    };
}

export function advanceReplay(cursor: number, bounds: ReplayWindow): number {
    return Math.min(bounds.end, cursor + Math.max(1, Math.ceil((bounds.end - bounds.start) / 60)));
}

// Native ranges sanitize values onto their step grid. Use an integer grid whose
// endpoints always map to the exact coverage instants, including millisecond bounds.
export const REPLAY_SLIDER_STEPS = 1440;
export function replaySliderSteps(bounds: ReplayWindow): number {
    return Math.min(REPLAY_SLIDER_STEPS, bounds.end - bounds.start);
}
export function replaySliderPosition(cursor: number, bounds: ReplayWindow): number {
    return Math.round(Math.max(0, Math.min(1, (cursor - bounds.start) / (bounds.end - bounds.start))) * replaySliderSteps(bounds));
}
export function replaySliderTimestamp(position: number, bounds: ReplayWindow): number {
    const steps = replaySliderSteps(bounds);
    return bounds.start + Math.round((bounds.end - bounds.start) * Math.max(0, Math.min(steps, position)) / steps);
}

/** UTC is explicit and deterministic; local datetime inputs convert instants separately. */
export function replayTime(timestamp: number): string {
    return new Date(timestamp).toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
}

/** Keep precision and preserve the original offset for an unedited DST-fold value. */
export function replayLocalInput(timestamp: number): string {
    const iso = new Date(timestamp).toISOString();
    return dateTimeInputValue(iso) + iso.slice(16, 23);
}

export function replayInputTimestamp(value: string, original?: number): number | null {
    if (original !== undefined && value === replayLocalInput(original)) return original;
    const timestamp = Date.parse(value);
    if (!Number.isFinite(timestamp)) return null;
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/.exec(value);
    if (!match) return null;
    const date = new Date(timestamp);
    const components = [date.getFullYear(), date.getMonth() + 1, date.getDate(), date.getHours(), date.getMinutes(), date.getSeconds(), date.getMilliseconds()];
    const requested = [...match.slice(1, 7).map(part => Number(part ?? 0)), Number((match[7] ?? '').padEnd(3, '0'))];
    // Reject nonexistent local DST times rather than normalizing to another hour.
    return components.every((part, index) => part === requested[index]) ? timestamp : null;
}
