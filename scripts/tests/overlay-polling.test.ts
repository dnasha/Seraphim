// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { startVisiblePolling } from '@/components/map/overlayPolling';

class FakeVisibilityTarget {
  visibilityState: DocumentVisibilityState = 'visible';
  private listeners = new Set<EventListenerOrEventListenerObject>();

  addEventListener(_type: string, listener: EventListenerOrEventListenerObject) {
    this.listeners.add(listener);
  }

  removeEventListener(_type: string, listener: EventListenerOrEventListenerObject) {
    this.listeners.delete(listener);
  }

  setVisibility(state: DocumentVisibilityState) {
    this.visibilityState = state;
    const event = new Event('visibilitychange');
    for (const listener of this.listeners) {
      if (typeof listener === 'function') listener(event);
      else listener.handleEvent(event);
    }
  }
}

describe('startVisiblePolling', () => {
  afterEach(() => vi.useRealTimers());

  it('waits for a poll to settle before scheduling the next one', async () => {
    vi.useFakeTimers();
    let release: (() => void) | undefined;
    const poll = vi.fn(() => new Promise<void>((resolve) => { release = resolve; }));
    const visibilityTarget = new FakeVisibilityTarget();
    const stop = startVisiblePolling({
      intervalMs: 10_000,
      poll,
      visibilityTarget: visibilityTarget as unknown as Document,
    });

    expect(poll).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(poll).toHaveBeenCalledTimes(1);

    release?.();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(9_999);
    expect(poll).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(poll).toHaveBeenCalledTimes(2);
    stop();
  });

  it('aborts hidden-tab work and refreshes immediately when visible', async () => {
    vi.useFakeTimers();
    const visibilityTarget = new FakeVisibilityTarget();
    const signals: AbortSignal[] = [];
    const poll = vi.fn((signal: AbortSignal) => new Promise<void>((resolve) => {
      signals.push(signal);
      signal.addEventListener('abort', () => resolve(), { once: true });
    }));
    const stop = startVisiblePolling({
      intervalMs: 8_000,
      poll,
      visibilityTarget: visibilityTarget as unknown as Document,
    });

    visibilityTarget.setVisibility('hidden');
    expect(signals[0].aborted).toBe(true);
    await Promise.resolve();
    expect(poll).toHaveBeenCalledTimes(1);

    visibilityTarget.setVisibility('visible');
    await Promise.resolve();
    expect(poll).toHaveBeenCalledTimes(2);
    stop();
  });
});
