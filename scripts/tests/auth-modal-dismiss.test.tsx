// @vitest-environment jsdom

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const authMocks = vi.hoisted(() => ({
    setShowAuthModal: vi.fn(),
    continueAsGuest: vi.fn(),
    signInWithOAuth: vi.fn(),
    signUp: vi.fn(),
}));

vi.mock('@/hooks/useAuth', () => ({
    useAuth: () => ({
        showAuthModal: true,
        setShowAuthModal: authMocks.setShowAuthModal,
        continueAsGuest: authMocks.continueAsGuest,
        supabase: {
            auth: {
                resetPasswordForEmail: vi.fn(),
                signUp: authMocks.signUp,
                signInWithPassword: vi.fn(),
                signInWithOAuth: authMocks.signInWithOAuth,
            },
        },
    }),
}));

vi.mock('next-themes', () => ({
    useTheme: () => ({ resolvedTheme: 'light' }),
}));

vi.mock('next/link', () => ({
    default: ({ children, href }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
        <a href={href}>{children}</a>
    ),
}));

vi.mock('@marsidev/react-turnstile', () => ({
    Turnstile: () => <div data-testid="turnstile" />,
}));

import AuthModal from '@/components/auth/AuthModal';
import { setAuthModalOpen } from '@/hooks/useAuthModalState';

function firePointer(
    target: Element,
    type: 'pointerdown' | 'pointerup',
    options: { pointerId: number; clientX: number; clientY: number },
) {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperties(event, {
        pointerId: { value: options.pointerId },
        isPrimary: { value: true },
        button: { value: 0 },
        clientX: { value: options.clientX },
        clientY: { value: options.clientY },
    });
    fireEvent(target, event);
}

describe('AuthModal backdrop dismissal', () => {
    beforeEach(() => {
        setAuthModalOpen(false);
        authMocks.setShowAuthModal.mockClear();
        authMocks.signInWithOAuth.mockReset().mockResolvedValue({ error: null });
        authMocks.signUp.mockReset().mockResolvedValue({ error: null });
    });

    afterEach(cleanup);

    it('opens free feature requests on signup with the map return destination', async () => {
        setAuthModalOpen(true, { initialTab: 'signup', returnTo: '/?lat=20&lng=30', subtitle: 'Create a free account for map tools' });
        render(<AuthModal />);
        expect(screen.getByRole('button', { name: 'Create Account' })).toBeTruthy();
        expect(screen.getByText('Create a free account for map tools')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Continue with Google' }));
        await waitFor(() => expect(authMocks.signInWithOAuth).toHaveBeenCalledOnce());
        const callback = new URL(authMocks.signInWithOAuth.mock.calls[0][0].options.redirectTo);
        expect(callback.searchParams.get('next')).toBe('/?lat=20&lng=30');
    });

    it('can close with Escape or the explicit close button', () => {
        render(<AuthModal />);
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(authMocks.setShowAuthModal).toHaveBeenCalledWith(false);
        authMocks.setShowAuthModal.mockClear();
        fireEvent.click(screen.getByRole('button', { name: 'Close sign-in' }));
        expect(authMocks.setShowAuthModal).toHaveBeenCalledWith(false);
    });

    it('contains keyboard focus and restores the trigger when dismissed', () => {
        const trigger = document.createElement('button');
        document.body.appendChild(trigger);
        trigger.focus();
        const { unmount } = render(<AuthModal />);
        expect(document.activeElement).toBe(screen.getByRole('dialog'));
        fireEvent.keyDown(document, { key: 'Tab' });
        expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close sign-in' }));
        fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
        expect(document.activeElement).toBe(screen.getByRole('link', { name: 'Privacy Policy' }));
        unmount();
        expect(document.activeElement).toBe(trigger);
        trigger.remove();
    });

    it.each([
        ['/pricing?plan=pro_monthly&returnTo=%2Faccount', '/pricing?plan=pro_monthly&returnTo=%2Faccount'],
        ['//example.com', '/'],
    ])('returns OAuth signups to a safe destination: %s', async (returnTo, expected) => {
        render(<AuthModal returnTo={returnTo} initialTab="signup" />);
        fireEvent.click(screen.getByRole('button', { name: 'Continue with Google' }));
        await waitFor(() => expect(authMocks.signInWithOAuth).toHaveBeenCalledOnce());
        const callback = new URL(authMocks.signInWithOAuth.mock.calls[0][0].options.redirectTo);
        expect(callback.origin).toBe(window.location.origin);
        expect(callback.pathname).toBe('/auth/callback');
        expect(callback.searchParams.get('next')).toBe(expected);
    });

    it('preserves pricing selection in the email confirmation link', async () => {
        const returnTo = '/pricing?plan=analyst_yearly&returnTo=%2F';
        render(<AuthModal returnTo={returnTo} initialTab="signup" />);
        fireEvent.change(screen.getByPlaceholderText('Email address'), { target: { value: 'reader@example.com' } });
        fireEvent.change(screen.getByPlaceholderText('Password'), { target: { value: 'test-password' } });
        fireEvent.click(screen.getByRole('button', { name: 'Create Account' }));
        await waitFor(() => expect(authMocks.signUp).toHaveBeenCalledOnce());
        const callback = new URL(authMocks.signUp.mock.calls[0][0].options.emailRedirectTo);
        expect(callback.searchParams.get('next')).toBe(returnTo);
        await waitFor(() => expect(screen.getByText('Check your email for a confirmation link.')).toBeTruthy());
    });

    it('closes for a stationary primary click that starts and ends on the backdrop', () => {
        render(<AuthModal />);
        const dialog = screen.getByRole('dialog', { name: 'Sign in or create an account' });
        const backdrop = dialog.parentElement as HTMLElement;

        firePointer(backdrop, 'pointerdown', { pointerId: 1, clientX: 20, clientY: 20 });
        firePointer(backdrop, 'pointerup', { pointerId: 1, clientX: 20, clientY: 20 });

        expect(authMocks.setShowAuthModal).toHaveBeenCalledOnce();
        expect(authMocks.setShowAuthModal).toHaveBeenCalledWith(false);
    });

    it('stays open when a selection drag starts inside the dialog and ends on the backdrop', () => {
        render(<AuthModal />);
        const dialog = screen.getByRole('dialog', { name: 'Sign in or create an account' });
        const backdrop = dialog.parentElement as HTMLElement;
        const selectableText = screen.getByText('Real-time global intelligence');

        firePointer(selectableText, 'pointerdown', { pointerId: 2, clientX: 180, clientY: 160 });
        firePointer(backdrop, 'pointerup', { pointerId: 2, clientX: 20, clientY: 160 });

        expect(authMocks.setShowAuthModal).not.toHaveBeenCalled();
    });

    it('stays open for a drag gesture performed entirely on the backdrop', () => {
        render(<AuthModal />);
        const dialog = screen.getByRole('dialog', { name: 'Sign in or create an account' });
        const backdrop = dialog.parentElement as HTMLElement;

        firePointer(backdrop, 'pointerdown', { pointerId: 3, clientX: 20, clientY: 20 });
        firePointer(backdrop, 'pointerup', { pointerId: 3, clientX: 40, clientY: 20 });

        expect(authMocks.setShowAuthModal).not.toHaveBeenCalled();
    });
});
