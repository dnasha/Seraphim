// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import LegalContents from '@/components/ui/LegalContents';

const sections = [
  { id: 'first', title: '1. First section' },
  { id: 'second', title: '2. Second section' },
  { id: 'last', title: '3. Last section' },
];
let positions: number[];
let frames: Map<number, FrameRequestCallback>;
let onResize: () => void;
let nextFrame: number;

function flushFrame() {
  act(() => {
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach(callback => callback(0));
  });
}

function mount() {
  const result = render(
    <div data-legal-scroll style={{ scrollPaddingTop: '104px' }}>
      <LegalContents sections={sections} />
      <main>{sections.map(section => <h2 key={section.id} id={section.id}>{section.title}</h2>)}</main>
    </div>,
  );
  const scroller = result.container.firstElementChild as HTMLElement;
  Object.defineProperties(scroller, {
    clientHeight: { value: 600 },
    scrollHeight: { value: 2000 },
    scrollTop: { value: 0, writable: true },
  });
  sections.forEach((section, index) => {
    vi.spyOn(document.getElementById(section.id)!, 'getBoundingClientRect').mockImplementation(
      () => ({ top: positions[index] } as DOMRect),
    );
  });
  flushFrame();
  return { ...result, scroller };
}

function expectActive(title: string) {
  expect(screen.getAllByRole('link', { name: title, hidden: true }).every(link => link.getAttribute('aria-current') === 'location')).toBe(true);
  expect(document.querySelectorAll('a[aria-current="location"]')).toHaveLength(2);
}

beforeEach(() => {
  positions = [220, 900, 1500];
  frames = new Map();
  nextFrame = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { onResize = callback; }
    observe() {}
    disconnect() {}
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('Legal contents reading position', () => {
  it('starts with the first section and follows the section at the sticky-header boundary in both directions', () => {
    const { scroller } = mount();
    expectActive('1. First section');
    positions = [-600, 104, 700];
    scroller.scrollTop = 800;
    fireEvent.scroll(scroller);
    flushFrame();
    expectActive('2. Second section');
    positions = [-200, 500, 1100];
    scroller.scrollTop = 400;
    fireEvent.scroll(scroller);
    flushFrame();
    expectActive('1. First section');
  });

  it('restores the current section on a deep-linked or restored page', () => {
    positions = [-900, -200, 104];
    mount();
    expectActive('3. Last section');
  });

  it('highlights a short final section when the reader reaches the bottom', () => {
    const { scroller } = mount();
    positions = [-1000, -300, 300];
    scroller.scrollTop = 1400;
    fireEvent.scroll(scroller);
    flushFrame();
    expectActive('3. Last section');
  });

  it('recalculates after content reflows and cancels pending work when leaving the page', () => {
    const { scroller, unmount } = mount();
    positions = [-600, 80, 650];
    onResize();
    flushFrame();
    expectActive('2. Second section');
    fireEvent.scroll(scroller);
    unmount();
    expect(frames.size).toBe(0);
  });
});
