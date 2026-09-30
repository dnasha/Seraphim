// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useReplay } from '@/components/experiments/replay/useReplay';
import ReplayTimeline from '@/components/experiments/replay/ReplayTimeline';
import type { NewsItem } from '@/lib/core/types';
import type { UserTier } from '@/lib/entitlements';

const now = Date.parse('2026-09-30T12:00:00Z');
const story = (id: string, hoursAgo: number): NewsItem => ({ id, title: `Fixture ${id}`, source: 'Fixture', sourceType: 'rss', url: 'https://example.com', publishedAt: new Date(now - hoursAgo * 3_600_000).toISOString(), latitude: 1, longitude: 2 });
let motion: MediaQueryList;
let reduced = false;
const rows = [story('early', 20), story('late', 1)];
function Harness({ owner = 'account-a:pro', items = rows, tier = 'pro', selected = 'late', ready = true }: { owner?: string; items?: NewsItem[]; tier?: UserTier; selected?: string; ready?: boolean }) {
    const replay = useReplay({ ownerKey: owner, tier, ready, mapItems: items, sidebarItems: items, selectedItemId: selected, timeRange: '1d', customStart: '', customEnd: '', isCapped: true, appliedLimit: 1000 });
    return <><ReplayTimeline replay={replay} tier={tier} resolving={false} /><output data-testid="map-items">{replay.mapItems.map(item => item.id).join(',')}</output><output data-testid="sidebar-items">{replay.sidebarItems.map(item => item.title).join(',')}</output></>;
}
beforeEach(() => {
    vi.useFakeTimers(); vi.setSystemTime(now);
    reduced = false;
    motion = new EventTarget() as MediaQueryList;
    Object.defineProperty(motion, 'matches', { get: () => reduced });
    vi.stubGlobal('matchMedia', () => motion);
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });
const button = (name: string) => screen.getByRole('button', { name });
const freeze = () => fireEvent.click(button('Freeze loaded view'));
const cursor = () => screen.getByRole('slider', { name: 'Reporting cursor' }) as HTMLInputElement;

it('freezes a loaded snapshot, ignores late data, refreshes explicitly and restores live', () => {
    const { rerender } = render(<Harness />); freeze();
    const frozenCursor = cursor().value;
    rerender(<Harness items={[story('replacement', 2)]} />);
    expect(screen.getByTestId('map-items').textContent).toBe('early,late');
    expect(cursor().value).toBe(frozenCursor);
    expect(screen.getByText(/Capped coverage/)).toBeTruthy();
    fireEvent.click(button('Refresh snapshot'));
    expect(screen.getByTestId('map-items').textContent).toBe('replacement');
    fireEvent.click(button('Return live'));
    expect(screen.queryByRole('slider')).toBeNull();
    expect(screen.getByTestId('map-items').textContent).toBe('replacement');
});
it('scrubs with a preserved selected event, plays locally, pauses and restarts at the beginning', () => {
    render(<Harness />); freeze();
    fireEvent.change(cursor(), { target: { value: String(now - 12 * 3_600_000) } });
    expect(screen.getByTestId('map-items').textContent).toBe('early');
    expect(screen.getByTestId('sidebar-items').textContent).toBe('Fixture late,Fixture early');
    expect(screen.getByText(/Selected event is outside/).textContent).toMatch(/Selected event is outside/);
    fireEvent.click(button('Play'));
    act(() => { vi.advanceTimersByTime(500); });
    const advanced = cursor().value;
    fireEvent.click(button('Pause'));
    act(() => { vi.advanceTimersByTime(1000); });
    expect(cursor().value).toBe(advanced);
    fireEvent.change(cursor(), { target: { value: String(now) } });
    fireEvent.click(button('Play'));
    expect(Number(cursor().value)).toBe(now - 24 * 3_600_000);
    act(() => { vi.advanceTimersByTime(30_000); });
    expect(Number(cursor().value)).toBe(now);
    expect(button('Play')).toBeTruthy();
});
it('clears captured private data on account/tier changes, and cancels playback on return/unmount', () => {
    const { rerender, unmount } = render(<Harness />); freeze();
    fireEvent.click(button('Play'));
    rerender(<Harness owner="account-b:free" tier="free" items={[]} />);
    expect(screen.queryByRole('slider')).toBeNull();
    expect(screen.getByTestId('sidebar-items').textContent).toBe('');
    expect((button('Replay · Pro') as HTMLButtonElement).disabled).toBe(true);
    act(() => { vi.advanceTimersByTime(1000); });
    rerender(<Harness owner="account-b:pro" />); freeze();
    fireEvent.click(button('Play'));
    fireEvent.click(button('Return live'));
    expect(vi.getTimerCount()).toBe(0);
    freeze(); fireEvent.click(button('Play')); unmount();
    expect(vi.getTimerCount()).toBe(0);
});
it('provides manual stepping under reduced motion and pauses when the preference or visibility changes', () => {
    reduced = true; render(<Harness />); freeze();
    expect((button('Play') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(cursor(), { target: { value: String(now - 12 * 3_600_000) } });
    fireEvent.click(button('Step forward'));
    expect(Number(cursor().value)).toBeGreaterThan(now - 12 * 3_600_000);
    act(() => { reduced = false; motion.dispatchEvent(new Event('change')); });
    fireEvent.click(button('Play'));
    act(() => { reduced = true; motion.dispatchEvent(new Event('change')); });
    expect(button('Play')).toBeTruthy();
    act(() => { reduced = false; motion.dispatchEvent(new Event('change')); });
    fireEvent.click(button('Play'));
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(button('Play')).toBeTruthy();
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
});
it('gates capture until data is ready and allows custom comparison bounds only for Analyst/Angel', () => {
    const { rerender } = render(<Harness ready={false} />);
    expect((button('Freeze loaded view') as HTMLButtonElement).disabled).toBe(true);
    rerender(<Harness />); freeze();
    expect(screen.queryByText('Edit comparison bounds (local time)')).toBeNull();
    fireEvent.change(cursor(), { target: { value: String(now - 12 * 3_600_000) } });
    fireEvent.click(button('Use displayed window as A'));
    expect(screen.getByText(/new represented event dates in B relative/).textContent).toMatch(/^1 new/);
    rerender(<Harness tier="analyst" owner="account-a:analyst" />); freeze();
    expect(screen.getByText('Edit comparison bounds (local time)')).toBeTruthy();
    const startInput = screen.getByLabelText('Window A start (local time)');
    fireEvent.change(startInput, { target: { value: '2026-01-01T00:00' } });
    fireEvent.submit(startInput.closest('form')!);
    expect(screen.getByRole('alert').textContent).toMatch(/inside the captured coverage/);
    fireEvent.click(button('Return live')); freeze();
    fireEvent.submit(screen.getByLabelText('Window A start (local time)').closest('form')!);
    expect(screen.queryByRole('alert')).toBeNull();
});
