import { useState, useRef, useEffect, useCallback, RefObject } from "react";

interface UseResizableOptions {
  defaultWidth?: number;
  minWidth?: number;
  maxWidth?: number;
  localStorageKey?: string;
  sidebarRef: RefObject<HTMLElement | null>;
}

export function useResizable({
  defaultWidth = 400,
  minWidth = 380,
  maxWidth = 800,
  localStorageKey = "seraphim-sidebar-width",
  sidebarRef,
}: UseResizableOptions) {
  const [sidebarWidth, setSidebarWidth] = useState<number>(defaultWidth);
  const [isResizing, setIsResizing] = useState(false);
  const lastWidthRef = useRef(defaultWidth);

  /* Load persisted width on mount */
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
    localStorage.setItem(
      localStorageKey,
      lastWidthRef.current.toString(),
    );
    setSidebarWidth(lastWidthRef.current);
  }, [localStorageKey]);

  const resize = useCallback(
    (e: MouseEvent) => {
      if (!isResizing) return;

      /* Clamp width between min and max */
      const newWidth = Math.max(minWidth, Math.min(maxWidth, e.clientX));
      lastWidthRef.current = newWidth;

      /* Direct DOM manipulation for maximum performance during drag */
      if (sidebarRef.current) {
        sidebarRef.current.style.setProperty(
          "--sidebar-width",
          `${newWidth}px`,
        );
      }
    },
    [isResizing, minWidth, maxWidth, sidebarRef],
  );

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
