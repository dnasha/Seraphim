// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  track: vi.fn(),
  setShowAuthModal: vi.fn(),
  user: { id: 'user-1' } as { id: string } | null,
  isGuest: false,
  authLoading: false,
  showAuthModal: false,
  tier: 'free',
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    user: mocks.user,
    isGuest: mocks.isGuest,
    isLoading: mocks.authLoading,
    showAuthModal: mocks.showAuthModal,
    setShowAuthModal: mocks.setShowAuthModal,
  }),
}));
vi.mock('@/hooks/useUserTier', () => ({
  useUserTier: () => ({ tier: mocks.tier, isLoading: false }),
}));
vi.mock('@/lib/privacyConsent', () => ({ trackOptionalMetric: mocks.track }));
vi.mock('@/components/ui/ThemeToggle', () => ({ default: () => null }));
vi.mock('next/dynamic', () => ({
  default: () => ({ returnTo }: { returnTo: string }) => <a href={returnTo}>Signup return destination</a>,
}));

import { PricingPageClient, type PricingPageClientProps } from '@/app/pricing/PricingPageClient';

const defaultProps: PricingPageClientProps = {
  returnTo: '/',
  requestedFeature: null,
  recommendedTier: null,
  cancelledCheckoutIntent: null,
};

function renderPricing(props: Partial<PricingPageClientProps> = {}) {
  return render(<PricingPageClient {...defaultProps} {...props} />);
}

function checkoutCalls() {
  return mocks.fetch.mock.calls.filter(([url]) => url === '/api/stripe/checkout');
}

describe('pricing checkout flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', mocks.fetch);
    window.sessionStorage.clear();
    mocks.user = { id: 'user-1' };
    mocks.isGuest = false;
    mocks.authLoading = false;
    mocks.showAuthModal = false;
    mocks.tier = 'free';
    mocks.setShowAuthModal.mockImplementation((show: boolean) => { mocks.showAuthModal = show; });
    mocks.track.mockResolvedValue(undefined);
    mocks.fetch.mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input) === '/api/stripe/angel-count') {
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
    ['pro_yearly', 'Try Pro free', false],
    ['analyst_yearly', 'Try Analyst free', false],
    ['pro_monthly', 'Try Pro free', true],
    ['analyst_monthly', 'Try Analyst free', true],
    ['angel', 'Get Lifetime Access', false],
  ] as const)('issues exactly one checkout request for %s', async (priceKey, buttonName, monthly) => {
    renderPricing({ returnTo: '/?eventId=123' });
    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledWith('/api/stripe/angel-count'));

    if (monthly) fireEvent.click(screen.getByRole('button', { name: 'Monthly' }));
    fireEvent.click(screen.getByRole('button', { name: buttonName }));

    await waitFor(() => {
      expect(checkoutCalls()).toHaveLength(1);
      expect(JSON.parse(String(checkoutCalls()[0][1]?.body))).toEqual({ priceKey, returnTo: '/?eventId=123' });
    });
  });

  it('shows the full annual charge beside the trial and updates it when monthly billing is selected', () => {
    renderPricing();
    const pro = within(screen.getByRole('article', { name: 'Pro' }));
    expect(pro.getByText('$99.99 billed yearly after your trial')).toBeTruthy();
    expect(pro.getByText(/card required/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Monthly' }));
    expect(pro.getByText('$9.99 billed monthly after your trial')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Monthly' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('keeps guests on pricing and preserves their plan, interval, and return destination through signup', async () => {
    mocks.user = null;
    mocks.isGuest = true;
    renderPricing({ returnTo: '/account', requestedFeature: 'History', recommendedTier: 'analyst' });
    fireEvent.click(screen.getByRole('button', { name: 'Monthly' }));
    fireEvent.click(screen.getByRole('button', { name: 'Try Analyst free' }));

    expect(mocks.setShowAuthModal).toHaveBeenCalledWith(true);
    expect(checkoutCalls()).toHaveLength(0);
    const destination = new URL(screen.getByRole('link', { name: 'Signup return destination' }).getAttribute('href')!, 'https://seraphi.me');
    expect(destination.pathname).toBe('/pricing');
    expect(Object.fromEntries(destination.searchParams)).toEqual({
      returnTo: '/account', plan: 'analyst_monthly', feature: 'History', tier: 'analyst',
    });
    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledWith('/api/stripe/angel-count'));
  });

  it('restores the selected monthly plan after authentication without automatically starting checkout', () => {
    renderPricing({ initialPriceKey: 'analyst_monthly' });
    expect(screen.getByRole('button', { name: 'Monthly' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('article', { name: 'Analyst' }).getAttribute('data-mobile-selected')).toBe('true');
    expect(screen.getByRole('status').textContent).toContain('Your Analyst selection is saved');
    expect(checkoutCalls()).toHaveLength(0);
  });

  it('prevents competing checkouts, announces a failure, and lets the customer retry', async () => {
    renderPricing();
    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledWith('/api/stripe/angel-count'));
    let finishCheckout!: (response: Response) => void;
    mocks.fetch.mockImplementation(() => new Promise<Response>((resolve) => { finishCheckout = resolve; }));
    fireEvent.click(screen.getByRole('button', { name: 'Try Pro free' }));
    expect((screen.getByRole('button', { name: 'Opening checkout…' }) as HTMLButtonElement).disabled).toBe(true);
    const analyst = screen.getByRole('button', { name: 'Try Analyst free' });
    expect((analyst as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(analyst);
    expect(checkoutCalls()).toHaveLength(1);

    finishCheckout(new Response(JSON.stringify({ error: 'Please try again.' }), { status: 503 }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Please try again.'));
    expect(document.activeElement).toBe(screen.getByRole('alert'));
    expect((screen.getByRole('button', { name: 'Try Pro free' }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Try Analyst free' }));
    expect(checkoutCalls()).toHaveLength(2);
    finishCheckout(new Response(JSON.stringify({ error: 'Try later.' }), { status: 503 }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Try later.'));
  });

  it('routes existing subscribers to account management instead of offering another trial', () => {
    mocks.tier = 'pro';
    renderPricing();
    expect(screen.getByRole('link', { name: 'Manage plan' }).getAttribute('href')).toBe('/account');
    expect(screen.getByRole('link', { name: 'Switch to Analyst' }).getAttribute('href')).toBe('/account');
    expect(screen.queryByRole('button', { name: 'Try Analyst free' })).toBeNull();
    expect(checkoutCalls()).toHaveLength(0);
  });

  it('disables the Angel offer when availability is zero', async () => {
    mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ remaining: 0, total: 100 }), { status: 200 }));
    renderPricing();
    await waitFor(() => expect((screen.getByRole('button', { name: 'Sold out' }) as HTMLButtonElement).disabled).toBe(true));
  });

  it('waits for authentication to finish before offering checkout', () => {
    mocks.authLoading = true;
    renderPricing();
    expect((screen.getByRole('button', { name: 'Try Pro free' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Try Pro free' }));
    expect(checkoutCalls()).toHaveLength(0);
  });

  it('refreshes Angel availability once after releasing a returned checkout', async () => {
    window.sessionStorage.setItem('seraphim.activeCheckoutIntent', '123e4567-e89b-42d3-a456-426614174000');
    renderPricing();
    await waitFor(() => {
      expect(mocks.fetch.mock.calls.filter(([url]) => url === '/api/stripe/checkout/cancel')).toHaveLength(1);
      expect(mocks.fetch.mock.calls.filter(([url]) => url === '/api/stripe/angel-count')).toHaveLength(1);
    });
  });

  it('releases checkout when browser Back restores a cached pricing page', async () => {
    renderPricing();
    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledWith('/api/stripe/angel-count'));
    mocks.fetch.mockClear();
    window.sessionStorage.setItem('seraphim.activeCheckoutIntent', '123e4567-e89b-42d3-a456-426614174000');
    fireEvent(window, new PageTransitionEvent('pageshow', { persisted: true }));
    await waitFor(() => {
      expect(mocks.fetch.mock.calls.filter(([url]) => url === '/api/stripe/checkout/cancel')).toHaveLength(1);
      expect(mocks.fetch.mock.calls.filter(([url]) => url === '/api/stripe/angel-count')).toHaveLength(1);
    });
    expect(window.sessionStorage.getItem('seraphim.activeCheckoutIntent')).toBeNull();
  });
});
