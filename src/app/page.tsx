/**
 * Main application entry point for the Seraphim dashboard.
 * 
 * This file acts as a Server Component wrapper for HomeContent to handle 
 * asynchronous searchParams and manage hydration state. It uses React Suspense 
 * to ensure a smooth transition while the client side components initialize.
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
