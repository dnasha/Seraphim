// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: {} as Record<string, unknown>,
  tier: {} as Record<string, unknown>,
  updateUser: vi.fn(), signOut: vi.fn(), setShowAuthModal: vi.fn(), push: vi.fn(), fetch: vi.fn(),
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => mocks.auth }));
vi.mock('@/hooks/useUserTier', () => ({ useUserTier: () => mocks.tier }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock('@/lib/privacyConsent', () => ({ trackOptionalMetric: vi.fn() }));
vi.mock('@/components/ui/ThemeToggle', () => ({ default: () => null }));
vi.mock('@/components/auth/AuthModal', () => ({ default: () => null }));
import AccountPage from '@/app/account/page';

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState(null, '', '/account');
  mocks.auth = {
    user: { id: 'test-account-id', email: 'member@example.com', user_metadata: {}, app_metadata: { provider: 'email' } },
    isLoading: false, signOut: mocks.signOut, setShowAuthModal: mocks.setShowAuthModal,
    supabase: { auth: { updateUser: mocks.updateUser } },
  };
  mocks.tier = { tier: 'free', isLoading: false, subscriptionStatus: null, billingInterval: null };
  vi.stubGlobal('fetch', mocks.fetch);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('Account page', () => {
  it('offers guests sign-in without redirecting them or exposing account actions', () => {
    mocks.auth.user = null;
    render(<AccountPage />);
    fireEvent.click(screen.getByRole('button', { name: /Sign in or create/ }));
    expect(mocks.setShowAuthModal).toHaveBeenCalledWith(true);
    expect(mocks.push).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /Permanently delete/ })).toBeNull();
  });

  it('does not flash an upgrade action while the paid plan is still loading', () => {
    mocks.tier.isLoading = true;
    render(<AccountPage />);
    expect(screen.getByText('Loading your plan…').getAttribute('role')).toBe('status');
    expect(screen.queryByRole('link', { name: /View plans/ })).toBeNull();
  });

  it('shows Free access with an upgrade link that returns to account', () => {
    render(<AccountPage />);
    expect(screen.getByText('No subscription')).toBeTruthy();
    expect(screen.getByRole('link', { name: /View plans/ }).getAttribute('href')).toBe('/pricing?returnTo=%2Faccount');
  });

  it('keeps recurring billing dates and canceled subscription state out of Angel lifetime access', () => {
    mocks.tier = { tier: 'angel', subscriptionStatus: 'canceled', billingInterval: 'lifetime', currentPeriodEnd: '2027-01-01', trialEndsAt: '2026-12-01' };
    render(<AccountPage />);
    expect(screen.getByText('Lifetime access')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'View billing history' })).toBeTruthy();
    expect(screen.queryByText(/^(Next renewal|Trial ends|canceled)$/i)).toBeNull();
    expect(screen.getByRole('link', { name: /Join Discord/ }).getAttribute('href')).toContain('discord.gg/');
  });

  it('shows a scheduled cancellation as an access end date', () => {
    mocks.tier = { tier: 'pro', subscriptionStatus: 'active', billingInterval: 'month', currentPeriodEnd: '2027-01-01', cancelAtPeriodEnd: true };
    render(<AccountPage />);
    expect(screen.getByText('Access ends')).toBeTruthy();
    expect(screen.queryByText('Next renewal')).toBeNull();
  });

  it('does not describe revoked Angel access as lifetime access on a Free account', () => {
    mocks.tier = { tier: 'free', billingInterval: 'lifetime', angelStatus: 'revoked' };
    render(<AccountPage />);
    expect(screen.getByText('No subscription')).toBeTruthy();
    expect(screen.queryByText('Lifetime access')).toBeNull();
    expect(screen.getByText(/Angel access ended/)).toBeTruthy();
  });

  it('reports billing portal failures inline and allows a retry', async () => {
    mocks.tier = { tier: 'pro', subscriptionStatus: 'active', billingInterval: 'month' };
    mocks.fetch.mockResolvedValue({ ok: false, json: async () => ({ error: 'Billing is temporarily unavailable.' }) });
    render(<AccountPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Manage billing' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Billing is temporarily unavailable.');
    expect((screen.getByRole('button', { name: 'Manage billing' }) as HTMLButtonElement).disabled).toBe(false);
    expect(mocks.fetch).toHaveBeenCalledWith('/api/stripe/portal', { method: 'POST' });
  });

  it('sends email changes through the existing auth flow and announces confirmation', async () => {
    mocks.updateUser.mockResolvedValue({ error: null });
    render(<AccountPage />);
    fireEvent.click(screen.getByText('Email address'));
    fireEvent.change(screen.getByLabelText('New email address'), { target: { value: 'new@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update email' }));
    await waitFor(() => expect(mocks.updateUser).toHaveBeenCalledWith({ email: 'new@example.com' }));
    expect(await screen.findByText(/Confirmation emails sent/)).toBeTruthy();
  });

  it('explains mismatched passwords and prevents submission', () => {
    render(<AccountPage />);
    fireEvent.click(screen.getByText('Password', { exact: true }));
    fireEvent.change(screen.getByLabelText('New password', { exact: true }), { target: { value: 'first-password' } });
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'different-password' } });
    expect(screen.getByText('Passwords don’t match yet.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Save password' }) as HTMLButtonElement).disabled).toBe(true);
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it('keeps deletion collapsed and requires the exact confirmation before enabling it', () => {
    render(<AccountPage />);
    const summary = screen.getByText('Delete account');
    expect(summary.closest('details')?.open).toBe(false);
    fireEvent.click(summary);
    const submit = screen.getByRole('button', { name: 'Permanently delete account' }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Type FAREWELL to confirm'), { target: { value: 'FAREWELL' } });
    expect(submit.disabled).toBe(false);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('reopens the deletion flow when returning from its verification email', () => {
    window.history.replaceState(null, '', '/account?reauth=delete');
    render(<AccountPage />);
    expect(screen.getByText('Delete account').closest('details')?.open).toBe(true);
  });
});
