// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import PageError from '@/app/error';

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

it('retries loading the route through Next’s retry callback', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const retry = vi.fn();
    render(<PageError error={new Error('Server failure')} retry={retry} />);

    expect(screen.getByRole('alert', { name: 'Something went wrong' }).textContent).toContain('This view couldn’t be loaded.');
    await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    });
    expect(retry).toHaveBeenCalledTimes(1);
});
