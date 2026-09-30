// @vitest-environment jsdom

import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PWAInstallPrompt from '@/components/ui/PWAInstallPrompt';
import { PWA_COOLDOWN_MS, readPwaDismissal } from '@/lib/pwaPreferences';

const onPreferencesChange = vi.fn();
const props = { userId: null, ready: true, preferences: null, onPreferencesChange };

function installEvent(outcome: 'accepted' | 'dismissed' = 'dismissed') {
  const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
    prompt: vi.fn(async () => {}),
    userChoice: Promise.resolve({ outcome, platform: 'web' }),
  });
  act(() => { window.dispatchEvent(event); });
  return event;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-29T12:00:00Z'));
  onPreferencesChange.mockClear();
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value); },
    removeItem: (key: string) => { storage.delete(key); },
  });
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue('Chrome');
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('PWA install dismissal', () => {
  it('keeps the first cooldown and permanently suppresses after the second dismissal across remounts', () => {
    let view = render(<PWAInstallPrompt {...props} />);
    installEvent();
    act(() => vi.advanceTimersByTime(5000));
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss install prompt' }));
    expect(readPwaDismissal(null).pwaDismissCount).toBe(1);
    view.unmount();
    view = render(<PWAInstallPrompt {...props} />);
    installEvent();
    act(() => vi.advanceTimersByTime(5000));
    expect(screen.queryByRole('alert')).toBeNull();
    view.unmount();

    act(() => vi.advanceTimersByTime(PWA_COOLDOWN_MS));
    view = render(<PWAInstallPrompt {...props} />);
    installEvent();
    act(() => vi.advanceTimersByTime(5000));
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss install prompt' }));
    expect(readPwaDismissal(null).pwaDismissCount).toBe(2);
    view.unmount();

    act(() => vi.advanceTimersByTime(PWA_COOLDOWN_MS * 100));
    render(<PWAInstallPrompt {...props} />);
    const event = installEvent();
    act(() => vi.advanceTimersByTime(5000));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(event.defaultPrevented).toBe(true);
    expect(onPreferencesChange).not.toHaveBeenCalled();
  });

  it('waits for account preferences while retaining the browser install event', () => {
    const view = render(<PWAInstallPrompt {...props} ready={false} />);
    installEvent();
    act(() => vi.advanceTimersByTime(10000));
    expect(screen.queryByRole('alert')).toBeNull();
    view.rerender(<PWAInstallPrompt {...props} userId="user-a" ready />);
    act(() => vi.advanceTimersByTime(5000));
    expect(screen.queryByRole('alert')).not.toBeNull();
  });

  it('honors cloud suppression on a fresh browser', () => {
    const view = render(<PWAInstallPrompt {...props} userId="user-a" ready={false} />);
    installEvent();
    view.rerender(<PWAInstallPrompt {...props} userId="user-a" preferences={{ pwaDismissCount: 2, pwaLastDismissedAt: 1 }} />);
    act(() => vi.advanceTimersByTime(10000));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('counts an existing legacy dismissal and immediately persists the second to the account', () => {
    localStorage.setItem('seraphim_pwa_dismissed', String(Date.now() - PWA_COOLDOWN_MS - 1));
    render(<PWAInstallPrompt {...props} userId="user-a" />);
    installEvent();
    act(() => vi.advanceTimersByTime(5000));
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss install prompt' }));
    expect(onPreferencesChange).toHaveBeenCalledWith({ pwaDismissCount: 2, pwaLastDismissedAt: Date.now() }, { immediate: true });
  });

  it.each(['accepted', 'dismissed'] as const)('handles a native install choice of %s', async outcome => {
    render(<PWAInstallPrompt {...props} />);
    const event = installEvent(outcome);
    act(() => vi.advanceTimersByTime(5000));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Install Now' })); });
    expect(event.prompt).toHaveBeenCalledOnce();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(readPwaDismissal(null).pwaDismissCount).toBe(outcome === 'dismissed' ? 1 : 0);
  });

  it.each(['Close instructions', 'Got It'])('counts closing iOS instructions using %s', button => {
    vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue('iPhone Safari');
    render(<PWAInstallPrompt {...props} />);
    act(() => vi.advanceTimersByTime(6000));
    fireEvent.click(screen.getByRole('button', { name: 'Install Now' }));
    expect(readPwaDismissal(null).pwaDismissCount).toBe(0);
    fireEvent.click(screen.getByRole('button', { name: button }));
    expect(readPwaDismissal(null).pwaDismissCount).toBe(1);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('rechecks iOS dismissal while its delay is pending', () => {
    vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue('iPhone Safari');
    render(<PWAInstallPrompt {...props} />);
    localStorage.setItem('seraphim_pwa_preference:guest', JSON.stringify({ pwaDismissCount: 2 }));
    act(() => vi.advanceTimersByTime(6000));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('keeps account dismissals separate in a shared browser', () => {
    localStorage.setItem('seraphim_pwa_preference:user-a', JSON.stringify({ pwaDismissCount: 2 }));
    render(<PWAInstallPrompt {...props} userId="user-b" />);
    installEvent();
    act(() => vi.advanceTimersByTime(5000));
    expect(screen.queryByRole('alert')).not.toBeNull();
  });

  it('still hides and saves to the account when local storage is blocked', () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } });
    render(<PWAInstallPrompt {...props} userId="user-a" />);
    installEvent();
    act(() => vi.advanceTimersByTime(5000));
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss install prompt' }));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(onPreferencesChange).toHaveBeenCalledWith(expect.objectContaining({ pwaDismissCount: 1 }), { immediate: true });
  });
});
