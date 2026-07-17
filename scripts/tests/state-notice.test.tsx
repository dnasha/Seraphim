// @vitest-environment jsdom

import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import StateNotice from '@/components/ui/StateNotice';

describe('StateNotice', () => {
    afterEach(cleanup);

    it('announces loading states politely and marks them busy', () => {
        render(<StateNotice title="Loading map" variant="loading" placement="overlay" />);

        const status = screen.getByRole('status');
        expect(status.getAttribute('aria-live')).toBe('polite');
        expect(status.getAttribute('aria-busy')).toBe('true');
    });

    it('announces errors assertively and runs the retry action', () => {
        const onAction = vi.fn();
        render(
            <StateNotice
                title="Map unavailable"
                message="The map could not be loaded."
                variant="error"
                actionLabel="Retry"
                onAction={onAction}
            />,
        );

        expect(screen.getByRole('alert').getAttribute('aria-live')).toBe('assertive');
        fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
        expect(onAction).toHaveBeenCalledTimes(1);
    });

    it('uses the supplied accessible label for dismissal', () => {
        const onDismiss = vi.fn();
        render(
            <StateNotice
                title="Checkout unavailable"
                variant="error"
                onDismiss={onDismiss}
                dismissLabel="Dismiss checkout error"
            />,
        );

        fireEvent.click(screen.getByRole('button', { name: 'Dismiss checkout error' }));
        expect(onDismiss).toHaveBeenCalledTimes(1);
    });
});
// @vitest-environment jsdom
