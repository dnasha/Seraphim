// @vitest-environment jsdom

import React from 'react';
import { cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { GatedButton } from '@/components/ui/FeatureGate';
import MapActionTools from '@/components/map/MapActionTools';
import MapSettings from '@/components/map/MapSettings';
import { setAuthModalOpen, useAuthModalState } from '@/hooks/useAuthModalState';
import { pricingHref } from '@/lib/upgradeNavigation';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('next/link', () => ({
  default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a>,
}));

// jsdom does not implement the native dialog API. Focus containment and inert
// background behavior are also checked in the browser against the real dialog.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
    this.querySelector('button')?.focus();
  };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
});

beforeEach(() => {
  vi.stubGlobal('localStorage', { getItem: vi.fn(() => 'true'), setItem: vi.fn() });
  window.history.replaceState(null, '', '/?lat=20&lng=30&zoom=4&time=1d#story');
  setAuthModalOpen(false);
});
afterEach(() => { cleanup(); setAuthModalOpen(false); vi.unstubAllGlobals(); });

const gateProps = {
  allowed: false,
  requiredTier: 'pro' as const,
  featureName: 'Satellite map style',
  featureDescription: 'Explore satellite imagery alongside live events.',
  title: 'Switch to satellite imagery',
};

function pointer(target: Element, type: string, x: number, y: number, pointerId = 1) {
  const event = new Event(type, { bubbles: true });
  Object.defineProperties(event, {
    button: { value: 0 }, pointerId: { value: pointerId },
    clientX: { value: x }, clientY: { value: y },
  });
  fireEvent(target, event);
}

describe('shared upgrade flow', () => {
  it('shows the selected feature, preserves the full return URL, and never runs the locked action', () => {
    const action = vi.fn();
    render(<GatedButton {...gateProps} onClick={action}>Satellite</GatedButton>);
    const trigger = screen.getByRole('button', { name: 'Satellite' });
    trigger.focus();
    fireEvent.click(trigger);

    const dialog = screen.getByRole('dialog', { name: 'Satellite map style' });
    expect(dialog.getAttribute('aria-describedby')).toBeTruthy();
    expect(screen.getByText(gateProps.featureDescription)).toBeTruthy();
    const href = new URL(screen.getByRole('link', { name: 'View Pro plan' }).getAttribute('href')!, window.location.origin);
    expect(href.searchParams.get('returnTo')).toBe('/?lat=20&lng=30&zoom=4&time=1d#story');
    expect(href.searchParams.get('feature')).toBe('Satellite map style');
    expect(href.searchParams.get('tier')).toBe('pro');
    expect(action).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close feature preview' }));

    fireEvent.click(screen.getByRole('button', { name: 'Maybe later' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('opens account creation directly for free capabilities', () => {
    const { result } = renderHook(() => useAuthModalState());
    render(<GatedButton {...gateProps} requiredTier="free" featureName="Draw and measure tools">Draw</GatedButton>);
    fireEvent.click(screen.getByRole('button', { name: 'Draw' }));
    expect(screen.queryByRole('link')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Create free account' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(result.current[0]).toBe(true);
    expect(result.current[2]).toMatchObject({ initialTab: 'signup', returnTo: '/?lat=20&lng=30&zoom=4&time=1d#story' });
  });

  it('closes on the native Escape cancellation event', () => {
    render(<GatedButton {...gateProps}>Satellite</GatedButton>);
    fireEvent.click(screen.getByRole('button', { name: 'Satellite' }));
    fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('wraps keyboard focus between the first and last dialog controls', () => {
    render(<GatedButton {...gateProps}>Satellite</GatedButton>);
    fireEvent.click(screen.getByRole('button', { name: 'Satellite' }));
    const first = screen.getByRole('button', { name: 'Close feature preview' });
    const last = screen.getByRole('button', { name: 'Maybe later' });
    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
    fireEvent.keyDown(last, { key: 'Tab' });
    expect(document.activeElement).toBe(first);
  });

  it('dismisses only a stationary backdrop press, not a selection drag or another pointer', () => {
    render(<GatedButton {...gateProps}>Satellite</GatedButton>);
    fireEvent.click(screen.getByRole('button', { name: 'Satellite' }));
    const dialog = screen.getByRole('dialog');
    pointer(screen.getByText(gateProps.featureDescription), 'pointerdown', 100, 100);
    pointer(dialog, 'pointerup', 20, 20);
    expect(screen.getByRole('dialog')).toBeTruthy();
    pointer(dialog, 'pointerdown', 20, 20);
    pointer(dialog, 'pointerup', 70, 20);
    expect(screen.getByRole('dialog')).toBeTruthy();
    pointer(dialog, 'pointerdown', 20, 20, 1);
    pointer(dialog, 'pointerup', 20, 20, 2);
    expect(screen.getByRole('dialog')).toBeTruthy();
    pointer(dialog, 'pointerdown', 20, 20);
    pointer(dialog, 'pointerup', 20, 20);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('does not bubble dialog clicks to the menu that owns the gate', () => {
    const parentClick = vi.fn();
    render(<div onClick={parentClick}><GatedButton {...gateProps}>Satellite</GatedButton></div>);
    fireEvent.click(screen.getByRole('button', { name: 'Satellite' }));
    fireEvent.click(screen.getByText(gateProps.featureDescription));
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(parentClick).not.toHaveBeenCalled();
  });

  it('keeps allowed controls working and respects real disabled states', () => {
    const action = vi.fn();
    const { rerender } = render(<GatedButton {...gateProps} allowed onClick={action} aria-pressed>Satellite</GatedButton>);
    const button = screen.getByRole('button', { name: 'Satellite' });
    fireEvent.click(button);
    expect(action).toHaveBeenCalledOnce();
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(button.getAttribute('aria-haspopup')).toBeNull();
    rerender(<GatedButton {...gateProps} disabled onClick={action}>Satellite</GatedButton>);
    fireEvent.click(screen.getByRole('button', { name: 'Satellite' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(action).toHaveBeenCalledOnce();
  });

  it('does not present a locked control as an active toggle', () => {
    render(<GatedButton {...gateProps} aria-pressed>Satellite</GatedButton>);
    expect(screen.getByRole('button', { name: 'Satellite' }).getAttribute('aria-pressed')).toBeNull();
  });

  it('clears an open prompt when access changes without reopening it later', () => {
    const { rerender } = render(<GatedButton {...gateProps}>Satellite</GatedButton>);
    fireEvent.click(screen.getByRole('button', { name: 'Satellite' }));
    rerender(<GatedButton {...gateProps} allowed>Satellite</GatedButton>);
    expect(screen.queryByRole('dialog')).toBeNull();
    rerender(<GatedButton {...gateProps}>Satellite</GatedButton>);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: 'Satellite' }).getAttribute('aria-expanded')).toBe('false');
  });

  it('sanitizes upgrade destinations', () => {
    const href = new URL(pricingHref('//external.example', 'GeoJSON export', 'analyst'), window.location.origin);
    expect(href.searchParams.get('returnTo')).toBe('/');
    expect(href.searchParams.get('tier')).toBe('analyst');
  });
});

describe('map access indications', () => {
  it('shows paid requirements to guests and free signup for the standard styles', () => {
    render(<MapSettings mapStyle="standard" onStyleChange={vi.fn()} forceIndividualPins={false} onForceIndividualPinsToggle={vi.fn()}
      isOpen onToggleOpen={vi.fn()} panelRef={{ current: null } as unknown as React.RefObject<HTMLDivElement>}
      animatedEffects={false} onAnimatedEffectsChange={vi.fn()} mutedClusters={false} onMutedClustersChange={vi.fn()} userTier="guest" />);
    expect(screen.getByRole('button', { name: 'Satellite Pro' }).getAttribute('title')).toContain('Pro plan');
    expect(screen.getByRole('button', { name: 'Standard Free' }).getAttribute('title')).toContain('free account');
  });

  it('keeps guest upgrade buttons reachable and replaces locked overlay switches with plan badges', () => {
    const onToggle = vi.fn();
    render(<MapActionTools overlays={{}} onOverlayToggle={onToggle} isGlobe={false} onToggleGlobe={vi.fn()} onResetOrientation={vi.fn()}
      drawToolsOpen={false} onToggleDrawTools={vi.fn()} userTier="guest" disabled />);
    const globe = screen.getByRole('button', { name: '3D' });
    expect(globe.getAttribute('title')).toContain('Pro plan');
    expect(globe.hasAttribute('disabled')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Open environmental overlay controls' }));
    const flights = screen.getByRole('button', { name: 'Live flight tracking requires the Analyst plan' });
    expect(flights.textContent).toBe('Analyst');
    fireEvent.click(flights);
    expect(screen.getByRole('dialog', { name: 'Live flight tracking' })).toBeTruthy();
    expect(onToggle).not.toHaveBeenCalled();
  });
});
