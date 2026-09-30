'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { NewsItem } from '@/lib/core/types';
import type { UserTier } from '@/lib/entitlements';
import { matchesNewsId } from '@/lib/utils/ranking';
import { advanceReplay, captureReplay, checkReplayCapture, replayFrame, selectionOutsideReplay, validReplayWindow, type ReplaySnapshot, type ReplayWindow } from '@/lib/experiments/replay';

interface ReplayState {
    snapshot: ReplaySnapshot;
    cursor: number;
    duration: number | null;
    playing: boolean;
    a: ReplayWindow;
    b: ReplayWindow;
}
interface ReplayInput {
    ownerKey: string;
    tier: UserTier;
    ready: boolean;
    mapItems: NewsItem[];
    sidebarItems: NewsItem[];
    selectedItemId: string | null;
    timeRange: string;
    customStart: string;
    customEnd: string;
    isCapped: boolean;
    appliedLimit?: number;
    feedUpdatedAt?: string | null;
}

function currentDetails(captured: NewsItem, live: NewsItem | undefined): NewsItem {
    if (!live) return captured;
    return {
        ...captured,
        description: live.description ?? captured.description,
        sources: live.sources ?? captured.sources,
        descriptionProvenance: live.descriptionProvenance ?? captured.descriptionProvenance,
        headlinePublishedAt: live.headlinePublishedAt ?? captured.headlinePublishedAt,
        independentPublisherCount: live.independentPublisherCount ?? captured.independentPublisherCount,
        timelineRestricted: live.timelineRestricted ?? captured.timelineRestricted,
        totalSources: live.totalSources ?? captured.totalSources,
    };
}

export function useReplay(input: ReplayInput) {
    const [ownerKey, setOwnerKey] = useState(input.ownerKey);
    const [state, setState] = useState<ReplayState | null>(null);
    const [checkedAt, setCheckedAt] = useState(() => Date.now());
    // Discard private captured details in the same render as an account/tier change.
    if (ownerKey !== input.ownerKey) {
        setOwnerKey(input.ownerKey);
        setState(null);
    }
    const current = ownerKey === input.ownerKey ? state : null;

    useEffect(() => {
        if (input.timeRange !== 'custom') return;
        // Recheck edits and wake when a future start becomes reconstructable.
        // This clock never fetches data or alters an existing snapshot.
        const start = Date.parse(input.customStart);
        let timer: ReturnType<typeof setTimeout>;
        const check = () => {
            const now = Date.now();
            setCheckedAt(now);
            if (Number.isFinite(start) && start >= now) timer = setTimeout(check, Math.min(start - now + 1, 2_147_483_647));
        };
        timer = setTimeout(check, 0);
        return () => clearTimeout(timer);
    }, [input.timeRange, input.customStart, input.customEnd, input.ownerKey]);

    const captureCheck = checkReplayCapture(input.tier, input.timeRange, input.customStart, input.customEnd, checkedAt);
    const captureDisabledReason = !input.ready ? 'Wait for the current live view to finish loading.' : captureCheck.reason;

    useEffect(() => {
        if (!current?.playing) return;
        const interval = setInterval(() => {
            setState(previous => {
                if (!previous?.playing) return previous;
                const cursor = advanceReplay(previous.cursor, previous.snapshot.bounds);
                return { ...previous, cursor, playing: cursor < previous.snapshot.bounds.end };
            });
        }, 500);
        const pause = () => setState(previous => previous ? { ...previous, playing: false } : null);
        const visibility = () => { if (document.visibilityState === 'hidden') pause(); };
        // Pause on reduced-motion changes, tab switches, and component cleanup.
        const motion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
        motion?.addEventListener('change', pause);
        document.addEventListener('visibilitychange', visibility);
        return () => {
            clearInterval(interval);
            motion?.removeEventListener('change', pause);
            document.removeEventListener('visibilitychange', visibility);
        };
    }, [current?.playing, input.ownerKey]);

    const capture = useCallback(() => {
        if (!input.ready) return;
        const capturedAt = Date.now();
        const { bounds } = checkReplayCapture(input.tier, input.timeRange, input.customStart, input.customEnd, capturedAt);
        if (!bounds) return;
        const snapshot = captureReplay({ ...input, bounds, capturedAt });
        const midpoint = bounds.start + Math.floor((bounds.end - bounds.start) / 2);
        setState({ snapshot, cursor: bounds.end, duration: null, playing: false, a: { start: bounds.start, end: midpoint }, b: { start: midpoint, end: bounds.end } });
    }, [input]);

    const replayWindow = useMemo(() => current ? {
        start: current.duration === null ? current.snapshot.bounds.start : Math.max(current.snapshot.bounds.start, current.cursor - current.duration),
        end: current.cursor,
    } : null, [current]);
    const frame = useMemo(() => current && replayWindow ? replayFrame(current.snapshot, replayWindow) : null, [current, replayWindow]);
    const outside = current && replayWindow ? selectionOutsideReplay(current.snapshot, replayWindow, input.selectedItemId) : false;
    const selectedLiveItem = input.sidebarItems.find(item => matchesNewsId(item, input.selectedItemId))
        ?? input.mapItems.find(item => matchesNewsId(item, input.selectedItemId));
    const mapItems = useMemo(() => frame ? frame.mapItems.map(item => matchesNewsId(item, input.selectedItemId)
        ? currentDetails(item, selectedLiveItem) : item) : input.mapItems, [frame, input.mapItems, input.selectedItemId, selectedLiveItem]);
    const sidebarItems = useMemo(() => {
        if (!frame || !current) return input.sidebarItems;
        // Preserve the URL-selected event as an explicitly marked current-detail exception.
        // Do not let detail hydration change the captured temporal evidence or map frame.
        const captured = current.snapshot.entries.find(entry => matchesNewsId(entry.item, input.selectedItemId))?.item;
        const selected = captured ? currentDetails(captured, selectedLiveItem) : selectedLiveItem;
        const items = frame.sidebarItems.filter(item => !matchesNewsId(item, input.selectedItemId));
        return selected ? [selected, ...items] : items;
    }, [frame, current, input.sidebarItems, input.selectedItemId, selectedLiveItem]);

    return {
        state: current,
        window: replayWindow,
        outside,
        mapItems,
        sidebarItems,
        capture,
        canCapture: captureDisabledReason === null,
        captureDisabledReason,
        returnLive: () => setState(null),
        scrub: (cursor: number) => setState(previous => previous ? { ...previous, cursor: Math.max(previous.snapshot.bounds.start, Math.min(previous.snapshot.bounds.end, cursor)), playing: false } : null),
        setDuration: (duration: number | null) => setState(previous => previous ? { ...previous, duration, playing: false } : null),
        togglePlayback: () => setState(previous => previous ? { ...previous, playing: !previous.playing, cursor: previous.cursor >= previous.snapshot.bounds.end ? previous.snapshot.bounds.start : previous.cursor } : null),
        setComparison: (key: 'a' | 'b', next: ReplayWindow) => setState(previous => previous && validReplayWindow(next, previous.snapshot.bounds) ? { ...previous, [key]: next, playing: false } : previous),
    };
}
