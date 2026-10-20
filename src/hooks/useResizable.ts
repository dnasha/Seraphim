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
  minWidth = 420,
  maxWidth = 900,
  localStorageKey = "seraphim-sidebar-width",
  sidebarRef,
}: UseResizableOptions) {
  // Start as undefined so CSS clamp() handles the default sizing. This prevents hydration mismatches.
  const [sidebarWidth, setSidebarWidth] = useState<number | undefined>(undefined);
  const [renderedWidth, setRenderedWidth] = useState(minWidth);
  const [isResizing, setIsResizing] = useState(false);
  const lastWidthRef = useRef<number | undefined>(undefined);

  // Read the responsive CSS width for assistive technology without rendering
  // the list on each drag movement.
  useEffect(() => {
    const measure = () => {
      const width = sidebarRef.current?.getBoundingClientRect().width;
      if (width && width > 0) setRenderedWidth(Math.round(width));
    };
    const frame = requestAnimationFrame(measure);
    window.addEventListener('resize', measure);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', measure);
    };
  }, [sidebarRef, sidebarWidth]);

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

  const startResizing = useCallback((e: React.MouseEvent | React.PointerEvent) => {
    e.preventDefault();
    if ('pointerId' in e) e.currentTarget.setPointerCapture?.(e.pointerId);
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
    (e: MouseEvent | PointerEvent) => {
      if (!isResizing) return;

      const newWidth = Math.max(minWidth, Math.min(maxWidth, e.clientX - (sidebarRef.current?.getBoundingClientRect().left ?? 0)));
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
  const resizeWithKeyboard = useCallback((event: React.KeyboardEvent) => {
    const current = lastWidthRef.current ?? sidebarRef.current?.getBoundingClientRect().width ?? minWidth;
    const next = event.key === 'Home' ? minWidth : event.key === 'End' ? maxWidth
      : event.key === 'ArrowLeft' ? current - 20 : event.key === 'ArrowRight' ? current + 20 : null;
    if (next === null) return;
    event.preventDefault();
    const width = Math.max(minWidth, Math.min(maxWidth, next));
    lastWidthRef.current = width;
    sidebarRef.current?.style.setProperty('--sidebar-width', `${width}px`);
    setSidebarWidth(width);
    localStorage.setItem(localStorageKey, String(width));
  }, [localStorageKey, maxWidth, minWidth, sidebarRef]);

  useEffect(() => {
    if (!isResizing) return;
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    const hadDragClass = document.body.classList.contains('is-resizing-sidebar');
    window.addEventListener('mousemove', resize);
    window.addEventListener('mouseup', stopResizing);
    window.addEventListener('pointermove', resize);
    window.addEventListener('pointerup', stopResizing);
    window.addEventListener('pointercancel', stopResizing);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.body.classList.add('is-resizing-sidebar');
    return () => {
      window.removeEventListener('mousemove', resize);
      window.removeEventListener('mouseup', stopResizing);
      window.removeEventListener('pointermove', resize);
      window.removeEventListener('pointerup', stopResizing);
      window.removeEventListener('pointercancel', stopResizing);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      if (!hadDragClass) document.body.classList.remove('is-resizing-sidebar');
    };
  }, [isResizing, resize, stopResizing]);

  return {
    sidebarWidth,
    renderedWidth,
    isResizing,
    startResizing,
    resizeWithKeyboard,
    minWidth,
    maxWidth,
  };
}
