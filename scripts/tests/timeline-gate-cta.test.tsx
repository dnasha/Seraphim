// @vitest-environment jsdom

import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const authMocks = vi.hoisted(() => ({
    setShowAuthModal: vi.fn(),
}));

vi.mock('@/hooks/useAuth', () => ({
    useAuth: () => ({ setShowAuthModal: authMocks.setShowAuthModal }),
}));

vi.mock('next/navigation', () => ({
    usePathname: () => '/',
}));

vi.mock('next/link', () => ({
    default: ({ children, href }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
        <a href={href}>{children}</a>
    ),
}));

import TimelineGateCta from '@/components/ui/TimelineGateCta';

describe('TimelineGateCta', () => {
    beforeEach(() => {
        authMocks.setShowAuthModal.mockClear();
    });

    afterEach(cleanup);

    it('invites guests to create an account and opens the auth modal', () => {
        render(<TimelineGateCta userTier="guest" className="base" guestClassName="guest" />);

        const accountCta = screen.getByRole('button', { name: 'Create an account to see more' });
        expect(accountCta.className).toContain('guest');
        expect(screen.queryByRole('button', { name: 'Unlock full timeline' })).toBeNull();

        fireEvent.click(accountCta);
        expect(authMocks.setShowAuthModal).toHaveBeenCalledOnce();
        expect(authMocks.setShowAuthModal).toHaveBeenCalledWith(true);
    });

    it('keeps the Pro upgrade action for signed-in free users', () => {
        render(<TimelineGateCta userTier="free" className="base" />);

        expect(screen.getByRole('button', { name: 'Unlock full timeline' })).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Create an account to see more' })).toBeNull();
    });

    it('renders no gate for tiers with full timeline access', () => {
        const { container } = render(<TimelineGateCta userTier="pro" className="base" />);
        expect(container.childElementCount).toBe(0);
    });
});
