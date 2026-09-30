'use client';

import { useSyncExternalStore } from 'react';

// Keep in sync with the compact media queries in Layout and EventSidebar CSS.
// Portrait tablets retain the split view; short phone landscapes use navigation.
export const COMPACT_LAYOUT_QUERY = '(width < 768px), (width < 1024px) and (max-height: 500px)';

function subscribe(onChange: () => void) {
    const query = window.matchMedia(COMPACT_LAYOUT_QUERY);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
}

export function useCompactLayout() {
    return useSyncExternalStore(
        subscribe,
        () => window.matchMedia(COMPACT_LAYOUT_QUERY).matches,
        () => false,
    );
}
