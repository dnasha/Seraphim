/*
  Main application entry point.
  Coordinates the layout, data fetching, filtering logic, and state management
  between the map, sidebar, and filter components.
*/

import { Suspense } from 'react';
import { HomeContent } from '@/components/layout/HomeContent';

export default function Home() {
    return (
        <Suspense fallback={null}>
            <HomeContent />
        </Suspense>
    );
}
