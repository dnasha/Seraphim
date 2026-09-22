// @vitest-environment jsdom

import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import StartupGate from '@/components/layout/StartupGate';
import StartupScreen from '@/components/layout/StartupScreen';
import { renderToString } from 'react-dom/server';

const props = { sessionReady: false, storiesReady: false, mapState: 'loading' as const, hasError: false };
const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

describe('coordinated startup', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(0), 16));
        vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
        HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
        HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
    });
    afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

    it('includes a loading screen in the server HTML before hydration', () => {
        const html = renderToString(<StartupScreen />);
        expect(html).toContain('role="progressbar"');
        expect(html).toContain('Preparing your view');
        expect(html).toContain('SERAPHIM');
    });

    it('keeps both surfaces mounted and inert until auth, stories, and a rendered map are ready', async () => {
        const content = <div data-testid="dashboard"><button>Story</button><canvas /></div>;
        const { rerender } = render(<StartupGate {...props}>{content}</StartupGate>);
        const dashboard = screen.getByTestId('dashboard');
        const wrapper = dashboard.parentElement!;
        expect(wrapper.hasAttribute('inert')).toBe(true);
        expect(wrapper.getAttribute('aria-hidden')).toBe('true');

        rerender(<StartupGate {...props} sessionReady storiesReady>{content}</StartupGate>);
        await advance(100);
        expect(screen.getByRole('progressbar').getAttribute('aria-valuetext')).toBe('Rendering the map');
        expect(wrapper.hasAttribute('inert')).toBe(true);

        rerender(<StartupGate {...props} sessionReady storiesReady mapState="ready">{content}</StartupGate>);
        await advance(32);
        expect(screen.queryByRole('progressbar')).toBeNull();
        expect(wrapper.hasAttribute('inert')).toBe(false);
        expect(screen.getByTestId('dashboard')).toBe(dashboard);
        expect(wrapper.getAttribute('data-startup-ms')).not.toBeNull();

        // Panning, refreshing, or changing style must never cover the app again.
        rerender(<StartupGate {...props}>{content}</StartupGate>);
        await advance(9_000);
        expect(screen.queryByRole('progressbar')).toBeNull();
    });

    it.each(['news', 'map'])('reveals actionable content when %s fails', async (failure) => {
        render(<StartupGate {...props} hasError={failure === 'news'} mapState={failure === 'map' ? 'error' : 'loading'}>
            <button>Retry failed resource</button>
        </StartupGate>);
        await advance(32);
        expect(screen.queryByRole('progressbar')).toBeNull();
        expect(screen.getByRole('button', { name: 'Retry failed resource' })).toBeTruthy();
    });

    it('offers an escape on a slow connection without pretending loading has completed', async () => {
        render(<StartupGate {...props}><button>Available stories</button></StartupGate>);
        await advance(8_000);
        expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('10');
        fireEvent.click(screen.getByRole('button', { name: 'Open available content' }));
        expect(screen.queryByRole('progressbar')).toBeNull();
        expect(screen.getByRole('button', { name: 'Available stories' })).toBeTruthy();
    });

    it('cancels a pending reveal if preferences trigger another feed or style load', async () => {
        const { rerender } = render(<StartupGate {...props} sessionReady storiesReady mapState="ready">Map</StartupGate>);
        await advance(16);
        rerender(<StartupGate {...props} sessionReady>Map</StartupGate>);
        await advance(100);
        expect(screen.getByRole('progressbar')).toBeTruthy();
    });

    it('lets keyboard users open available content with Escape', () => {
        render(<StartupGate {...props}><button>Available stories</button></StartupGate>);
        fireEvent(screen.getByRole('dialog', { name: 'Loading Seraphim' }), new Event('cancel', { cancelable: true }));
        expect(screen.queryByRole('progressbar')).toBeNull();
        expect(screen.getByRole('button', { name: 'Available stories' })).toBeTruthy();
    });
});
