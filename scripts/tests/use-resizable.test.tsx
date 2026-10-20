// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRef } from "react";
import { useResizable } from "@/hooks/useResizable";

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
    clear: () => values.clear(),
  });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
});

afterEach(() => vi.unstubAllGlobals());

describe("useResizable", () => {
  it("reports the responsive CSS width before any saved resize", () => {
    const sidebarRef = createRef<HTMLElement>();
    sidebarRef.current = document.createElement("aside");
    let width = 360;
    vi.spyOn(sidebarRef.current, 'getBoundingClientRect').mockImplementation(() => ({ width }) as DOMRect);
    const { result } = renderHook(() => useResizable({ sidebarRef }));
    expect(result.current.renderedWidth).toBe(360);
    expect(result.current.sidebarWidth).toBeUndefined();
    width = 420;
    act(() => window.dispatchEvent(new Event('resize')));
    expect(result.current.renderedWidth).toBe(420);
  });

  it("restores a valid persisted width", () => {
    localStorage.setItem("sidebar", "650");
    const sidebarRef = createRef<HTMLElement>();
    sidebarRef.current = document.createElement("aside");

    const { result } = renderHook(() => useResizable({ minWidth: 400, maxWidth: 800, localStorageKey: "sidebar", sidebarRef }));

    expect(result.current.sidebarWidth).toBe(650);
  });

  it("clamps mouse movement, updates the CSS variable, and persists on release", () => {
    const sidebarRef = createRef<HTMLElement>();
    sidebarRef.current = document.createElement("aside");
    const { result } = renderHook(() => useResizable({ minWidth: 400, maxWidth: 800, localStorageKey: "sidebar", sidebarRef }));

    act(() => result.current.startResizing({ preventDefault: vi.fn() } as never));
    expect(result.current.isResizing).toBe(true);
    expect(document.body.classList.contains("is-resizing-sidebar")).toBe(true);

    act(() => window.dispatchEvent(new MouseEvent("mousemove", { clientX: 999 })));
    expect(sidebarRef.current.style.getPropertyValue("--sidebar-width")).toBe("800px");

    act(() => window.dispatchEvent(new MouseEvent("mouseup")));
    expect(result.current.isResizing).toBe(false);
    expect(result.current.sidebarWidth).toBe(800);
    expect(localStorage.getItem("sidebar")).toBe("800");
    expect(document.body.classList.contains("is-resizing-sidebar")).toBe(false);
  });

  it("ignores persisted widths outside the configured bounds", () => {
    localStorage.setItem("sidebar", "9999");
    const sidebarRef = createRef<HTMLElement>();
    sidebarRef.current = document.createElement("aside");

    const { result } = renderHook(() => useResizable({ minWidth: 400, maxWidth: 800, localStorageKey: "sidebar", sidebarRef }));

    expect(result.current.sidebarWidth).toBeUndefined();
  });
});

it('restores body styles when unmounted during a drag', () => {
  const sidebarRef = createRef<HTMLElement>(); sidebarRef.current = document.createElement('aside');
  document.body.style.cursor = 'crosshair'; document.body.style.userSelect = 'text';
  const { result, unmount } = renderHook(() => useResizable({ sidebarRef }));
  act(() => result.current.startResizing({ preventDefault: vi.fn() } as never));
  unmount();
  expect(document.body.style.cursor).toBe('crosshair');
  expect(document.body.style.userSelect).toBe('text');
  expect(document.body.classList.contains('is-resizing-sidebar')).toBe(false);
  document.body.style.cursor = ''; document.body.style.userSelect = '';
});
it('supports pointer dragging and keyboard resizing within the limits', () => {
  const sidebarRef = createRef<HTMLElement>(); sidebarRef.current = document.createElement('aside');
  const { result } = renderHook(() => useResizable({ minWidth: 400, maxWidth: 800, localStorageKey: 'sidebar', sidebarRef }));
  act(() => result.current.startResizing({ preventDefault: vi.fn() } as never));
  act(() => window.dispatchEvent(new MouseEvent('pointermove', { clientX: 650 })));
  act(() => window.dispatchEvent(new Event('pointerup')));
  expect(result.current.sidebarWidth).toBe(650);
  act(() => result.current.resizeWithKeyboard({ key: 'ArrowRight', preventDefault: vi.fn() } as never));
  expect(result.current.sidebarWidth).toBe(670);
  act(() => result.current.resizeWithKeyboard({ key: 'End', preventDefault: vi.fn() } as never));
  expect(result.current.sidebarWidth).toBe(800);
  act(() => result.current.resizeWithKeyboard({ key: 'Home', preventDefault: vi.fn() } as never));
  expect(localStorage.getItem('sidebar')).toBe('400');
});
