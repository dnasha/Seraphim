// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react';
import type { User } from '@supabase/supabase-js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useStripeCheckoutPoll } from '@/components/auth/auth/stripePoll';

describe('useStripeCheckoutPoll', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    window.history.replaceState({}, '', '/');
    window.sessionStorage.clear();
  });

  it('clears the active checkout marker before polling a successful checkout', async () => {
    vi.useFakeTimers();
    window.history.replaceState({}, '', '/?checkout=success');
    window.sessionStorage.setItem('seraphim.activeCheckoutIntent', 'intent-1');
    const fetchUserTier = vi.fn().mockResolvedValue('free');

    renderHook(() => useStripeCheckoutPoll({ id: 'user-1' } as User, fetchUserTier));

    expect(window.sessionStorage.getItem('seraphim.activeCheckoutIntent')).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(fetchUserTier).toHaveBeenCalledOnce();
    expect(fetchUserTier).toHaveBeenCalledWith('user-1', true);
  });

  it('stops as soon as the purchased tier is visible and clears the return marker', async () => {
    vi.useFakeTimers();
    window.history.replaceState({}, '', '/account?tab=billing&checkout=success&checkoutPlan=angel');
    const fetchUserTier = vi.fn()
      .mockResolvedValueOnce('free')
      .mockResolvedValueOnce('angel');

    renderHook(() => useStripeCheckoutPoll({ id: 'user-1' } as User, fetchUserTier));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });

    expect(fetchUserTier).toHaveBeenCalledTimes(2);
    expect(window.location.search).toBe('?tab=billing');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(fetchUserTier).toHaveBeenCalledTimes(2);
  });
});
