// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { DrawingActionButton } from '@/components/map/draw/DrawingActionButton';
afterEach(cleanup);
const pointer = (element: HTMLElement, type: string, options: Record<string, unknown> = {}) => {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, { pointerType: 'touch', pointerId: 1, isPrimary: true, clientX: 5, clientY: 5, ...options });
  fireEvent(element, event);
};
it('activates a touch tap once even if the browser suppresses or later synthesizes its click, and keeps keyboard activation', () => {
  const action = vi.fn(); render(<DrawingActionButton onAction={action} title="Undo">Undo</DrawingActionButton>);
  const button = screen.getByRole('button');
  pointer(button, 'pointerdown'); pointer(button, 'pointerup');
  expect(action).toHaveBeenCalledTimes(1);
  fireEvent.click(button, { detail: 1 }); expect(action).toHaveBeenCalledTimes(1);
  fireEvent.click(button, { detail: 0 }); expect(action).toHaveBeenCalledTimes(2);
});
it('ignores swipes, cancelled gestures, secondary touches and disabled actions', () => {
  const action = vi.fn(); const view = render(<DrawingActionButton onAction={action} title="Undo">Undo</DrawingActionButton>);
  const button = screen.getByRole('button');
  pointer(button, 'pointerdown'); pointer(button, 'pointerup', { clientX: 40 });
  pointer(button, 'pointerdown'); pointer(button, 'pointercancel'); pointer(button, 'pointerup');
  pointer(button, 'pointerdown', { isPrimary: false }); pointer(button, 'pointerup');
  expect(action).not.toHaveBeenCalled();
  view.rerender(<DrawingActionButton onAction={action} disabled title="Undo">Undo</DrawingActionButton>);
  pointer(button, 'pointerdown'); pointer(button, 'pointerup'); fireEvent.click(button);
  expect(action).not.toHaveBeenCalled();
});
