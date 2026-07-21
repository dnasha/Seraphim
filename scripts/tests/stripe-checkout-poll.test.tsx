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
    const fetchUserTier = vi.fn().mockResolvedValue(undefined);

    renderHook(() => useStripeCheckoutPoll({ id: 'user-1' } as User, fetchUserTier));

    expect(window.sessionStorage.getItem('seraphim.activeCheckoutIntent')).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(fetchUserTier).toHaveBeenCalledOnce();
    expect(fetchUserTier).toHaveBeenCalledWith('user-1', true);
  });
});
