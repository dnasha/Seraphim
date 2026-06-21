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
