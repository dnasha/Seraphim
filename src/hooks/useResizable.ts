/**
 * useResizable hook provides logic for creating resizable UI components 
 * with persistence and performance optimizations. It is primarily used 
 * for the application sidebar.
 */

import { useState, useRef, useEffect, useCallback, RefObject } from "react";

interface UseResizableOptions {
  minWidth?: number;
  maxWidth?: number;
  localStorageKey?: string;
  sidebarRef: RefObject<HTMLElement | null>;
}

export function useResizable({
  minWidth = 340,
  maxWidth = 800,
  localStorageKey = "seraphim-sidebar-width",
  sidebarRef,
}: UseResizableOptions) {
  // Start as undefined so CSS clamp() handles the default sizing. This prevents hydration mismatches.
  const [sidebarWidth, setSidebarWidth] = useState<number | undefined>(undefined);
  const [isResizing, setIsResizing] = useState(false);
  const lastWidthRef = useRef<number | undefined>(undefined);

  /** 
   * Loads the previously saved sidebar width from localStorage on mount.
   */
  useEffect(() => {
    const saved = localStorage.getItem(localStorageKey);
    if (saved) {
      const parsed = parseInt(saved, 10);
      if (!isNaN(parsed) && parsed >= minWidth && parsed <= maxWidth) {
        const rafId = requestAnimationFrame(() => {
          setSidebarWidth(parsed);
          lastWidthRef.current = parsed;
        });
        return () => cancelAnimationFrame(rafId);
      }
    }
    return;
  }, [localStorageKey, minWidth, maxWidth]);

  const startResizing = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  }, []);

  const stopResizing = useCallback(() => {
    setIsResizing(false);
    if (lastWidthRef.current !== undefined) {
      localStorage.setItem(
        localStorageKey,
        lastWidthRef.current.toString(),
      );
      setSidebarWidth(lastWidthRef.current);
    }
  }, [localStorageKey]);

  /**
   * Performance Optimization: Instead of updating React state during every 
   * mouse movement (which triggers expensive re-renders), we directly 
   * manipulate the CSS variable on the DOM element for smooth resizing.
   */
  const resize = useCallback(
    (e: MouseEvent) => {
      if (!isResizing) return;

      const newWidth = Math.max(minWidth, Math.min(maxWidth, e.clientX));
      lastWidthRef.current = newWidth;

      if (sidebarRef.current) {
        sidebarRef.current.style.setProperty(
          "--sidebar-width",
          `${newWidth}px`,
        );
      }
    },
    [isResizing, minWidth, maxWidth, sidebarRef],
  );

  /**
   * Manages global event listeners and body styling during a resize operation.
   */
  useEffect(() => {
    if (isResizing) {
      window.addEventListener("mousemove", resize);
      window.addEventListener("mouseup", stopResizing);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      document.body.classList.add("is-resizing-sidebar");
    } else {
      window.removeEventListener("mousemove", resize);
      window.removeEventListener("mouseup", stopResizing);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.body.classList.remove("is-resizing-sidebar");
    }
    return () => {
      window.removeEventListener("mousemove", resize);
      window.removeEventListener("mouseup", stopResizing);
    };
  }, [isResizing, resize, stopResizing]);

  return {
    sidebarWidth,
    isResizing,
    startResizing,
  };
}
