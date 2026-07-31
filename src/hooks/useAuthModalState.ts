'use client';

import { useCallback, useSyncExternalStore } from 'react';

let isOpen = false;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function snapshot() {
  return isOpen;
}

export function setAuthModalOpen(nextOpen: boolean) {
  if (isOpen === nextOpen) return;
  isOpen = nextOpen;
  for (const listener of listeners) listener();
}

export function useAuthModalState() {
  const open = useSyncExternalStore(subscribe, snapshot, () => false);
  const setOpen = useCallback((nextOpen: boolean) => setAuthModalOpen(nextOpen), []);
  return [open, setOpen] as const;
}
