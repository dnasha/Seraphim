// @vitest-environment jsdom

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

    it('keeps the same card mounted and prevents repeat actions during recovery', () => {
        const onAction = vi.fn();
        const props = { title: 'Map unavailable', variant: 'error' as const, actionLabel: 'Try again', onAction };
        const { rerender } = render(<StateNotice {...props} />);
        const alert = screen.getByRole('alert', { name: 'Map unavailable' });
        const button = screen.getByRole('button', { name: 'Try again' });

        fireEvent.click(button);
        rerender(<StateNotice {...props} actionPending />);
        expect(screen.getByRole('alert')).toBe(alert);
        expect(screen.getByRole('button', { name: 'Trying again…' })).toBe(button);
        expect((button as HTMLButtonElement).disabled).toBe(true);
        expect(alert.getAttribute('aria-busy')).toBe('true');
        expect(alert.getAttribute('aria-live')).toBe('polite');
        fireEvent.click(button);
        expect(onAction).toHaveBeenCalledTimes(1);

        rerender(<StateNotice {...props} />);
        expect((button as HTMLButtonElement).disabled).toBe(false);
        expect(alert.getAttribute('aria-busy')).toBeNull();
        fireEvent.click(button);
        expect(onAction).toHaveBeenCalledTimes(2);
    });

    it('dismisses with Escape only while focus is inside the notice', () => {
        const onDismiss = vi.fn();
        const onAction = vi.fn();
        render(<StateNotice title="Stories unavailable" onDismiss={onDismiss} actionLabel="Try again" onAction={onAction} />);

        fireEvent.keyDown(document.body, { key: 'Escape' });
        expect(onDismiss).not.toHaveBeenCalled();
        fireEvent.keyDown(screen.getByRole('button', { name: 'Try again' }), { key: 'Escape' });
        expect(onDismiss).toHaveBeenCalledTimes(1);
        expect(onAction).not.toHaveBeenCalled();
    });
});
