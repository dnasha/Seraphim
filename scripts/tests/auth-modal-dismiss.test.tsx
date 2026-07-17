// @vitest-environment jsdom

import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const authMocks = vi.hoisted(() => ({
    setShowAuthModal: vi.fn(),
    continueAsGuest: vi.fn(),
}));

vi.mock('@/hooks/useAuth', () => ({
    useAuth: () => ({
        showAuthModal: true,
        setShowAuthModal: authMocks.setShowAuthModal,
        continueAsGuest: authMocks.continueAsGuest,
        supabase: {
            auth: {
                resetPasswordForEmail: vi.fn(),
                signUp: vi.fn(),
                signInWithPassword: vi.fn(),
                signInWithOAuth: vi.fn(),
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
        authMocks.setShowAuthModal.mockClear();
    });

    afterEach(cleanup);

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
