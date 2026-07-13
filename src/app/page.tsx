/**
 * Main application entry point for the Seraphim dashboard.
 * 
 * This file acts as a Server Component wrapper for HomeContent to handle 
 * asynchronous searchParams and manage hydration state. It uses React Suspense 
 * to ensure a smooth transition while the client side components initialize.
 */

import { Suspense } from 'react';
import { Metadata } from 'next';
import { supabase } from '@/lib/core/supabase';
import { HomeContent } from '@/components/layout/HomeContent';

interface PageProps {
    searchParams: Promise<{ eventId?: string }>;
}

export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
    const params = await searchParams;
    const eventId = params.eventId;

    if (!eventId) {
        return {};
    }

    // Validate UUID format to prevent malformed queries
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(eventId)) {
        return {
            title: "Seraphim | Invalid Event",
            robots: { index: false, follow: false, nocache: true },
        };
    }

    try {
        const { data: event } = await supabase
            .from('events')
            .select('title, description')
            .eq('id', eventId)
            .single();

        if (event) {
            const title = `${event.title} | Seraphim OSINT`;
            const description = event.description || "Real-time OSINT event details and mapping on Seraphim.";
            const ogImageUrl = `/api/og?eventId=${eventId}`;

            return {
                title,
                description,
                robots: {
                    index: false,
                    follow: false,
                    nocache: true,
                    googleBot: { index: false, follow: false, noimageindex: false },
                },
                openGraph: {
                    title,
                    description,
                    url: `/?eventId=${eventId}`,
                    images: [
                        {
                            url: ogImageUrl,
                            width: 1200,
                            height: 630,
                            alt: event.title,
                        }
                    ],
                    type: 'article',
                },
                twitter: {
                    card: 'summary_large_image',
                    title,
                    description,
                    images: [ogImageUrl],
                }
            };
        }
    } catch (err) {
        console.error('Error generating dynamic metadata:', err);
    }

    return {};
}

export default function Home() {
    return (
        <Suspense fallback={null}>
            <HomeContent />
        </Suspense>
    );
}
