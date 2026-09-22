'use client';

import { useCallback, useSyncExternalStore } from 'react';

export interface AuthModalIntent {
  initialTab?: 'login' | 'signup';
  returnTo?: string;
  subtitle?: string;
}

const closedState = { isOpen: false, intent: undefined as AuthModalIntent | undefined };
let state = closedState;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function snapshot() {
  return state;
}

export function setAuthModalOpen(nextOpen: boolean, intent?: AuthModalIntent) {
  if (state.isOpen === nextOpen && state.intent === intent) return;
  state = nextOpen ? { isOpen: true, intent } : closedState;
  for (const listener of listeners) listener();
}

export function useAuthModalState() {
  const current = useSyncExternalStore(subscribe, snapshot, () => closedState);
  const setOpen = useCallback((nextOpen: boolean) => setAuthModalOpen(nextOpen), []);
  return [current.isOpen, setOpen, current.intent] as const;
}
