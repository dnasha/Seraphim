/*
  Main application entry point.
  Coordinates the layout, data fetching, filtering logic, and state management
  between the map, sidebar, and filter components.
*/

import { Suspense } from 'react';
import { HomeContent } from '@/components/HomeContent';

export default async function Home(props: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
    const searchParams = await props.searchParams;
    
    return (
        <Suspense fallback={null}>
            <HomeContent searchParams={searchParams} />
        </Suspense>
    );
}
