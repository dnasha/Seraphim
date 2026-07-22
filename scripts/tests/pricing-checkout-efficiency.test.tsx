// @vitest-environment jsdom

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  push: vi.fn(),
  track: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push }),
}));
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'user-1' }, isGuest: false }),
}));
vi.mock('@/hooks/useUserTier', () => ({
  useUserTier: () => ({ tier: 'free' }),
}));
vi.mock('@/lib/privacyConsent', () => ({
  trackOptionalMetric: mocks.track,
}));
vi.mock('@/components/ui/ThemeToggle', () => ({ default: () => null }));
vi.mock('@/components/ui/StateNotice', () => ({ default: () => null }));
vi.mock('@/app/pricing/FaqSection', () => ({ FaqSection: () => null }));
vi.mock('@/app/pricing/PricingCard', () => ({
  PricingCard: ({ tier, isYearly, handleCheckout }: {
    tier: { key: string };
    isYearly: boolean;
    handleCheckout: (priceKey: string) => void;
  }) => {
    const priceKey = tier.key === 'angel'
      ? 'angel'
      : `${tier.key}_${isYearly ? 'yearly' : 'monthly'}`;
    return (
      <button type="button" onClick={() => handleCheckout(priceKey)}>
        Checkout {priceKey}
      </button>
    );
  },
}));

import { PricingPageClient } from '@/app/pricing/PricingPageClient';

function renderPricing() {
  render(
    <PricingPageClient
      returnTo="/"
      requestedFeature={null}
      recommendedTier={null}
      cancelledCheckoutIntent={null}
    />,
  );
}

describe('pricing checkout request efficiency', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', mocks.fetch);
    window.sessionStorage.clear();
    mocks.track.mockResolvedValue(undefined);
    mocks.fetch.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/stripe/angel-count') {
        return new Response(JSON.stringify({ remaining: 100, total: 100 }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: 'Test checkout stopped before navigation.' }), { status: 409 });
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it.each([
    ['pro_yearly', false],
    ['analyst_yearly', false],
    ['pro_monthly', true],
    ['analyst_monthly', true],
    ['angel', false],
  ] as const)('issues exactly one checkout request for %s', async (priceKey, switchToMonthly) => {
    renderPricing();

    await waitFor(() => {
      expect(mocks.fetch).toHaveBeenCalledWith('/api/stripe/angel-count');
    });
    mocks.fetch.mockClear();

    if (switchToMonthly) {
      fireEvent.click(screen.getByRole('button', { name: 'Toggle billing period' }));
    }
    fireEvent.click(screen.getByRole('button', { name: `Checkout ${priceKey}` }));

    await waitFor(() => {
      const checkoutCalls = mocks.fetch.mock.calls.filter(([url]) => url === '/api/stripe/checkout');
      expect(checkoutCalls).toHaveLength(1);
      expect(JSON.parse(String(checkoutCalls[0][1]?.body))).toEqual({ priceKey, returnTo: '/' });
    });
  });

  it('refreshes Angel availability once after releasing a returned checkout', async () => {
    window.sessionStorage.setItem(
      'seraphim.activeCheckoutIntent',
      '123e4567-e89b-42d3-a456-426614174000',
    );
    renderPricing();

    await waitFor(() => {
      const cancelCalls = mocks.fetch.mock.calls.filter(([url]) => url === '/api/stripe/checkout/cancel');
      const availabilityCalls = mocks.fetch.mock.calls.filter(([url]) => url === '/api/stripe/angel-count');
      expect(cancelCalls).toHaveLength(1);
      expect(availabilityCalls).toHaveLength(1);
    });
  });
});
