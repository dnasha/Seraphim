/**
 * Main application entry point for the Seraphim dashboard.
 * 
 * This file acts as a Server Component wrapper for HomeContent to handle 
 * asynchronous searchParams and manage hydration state. It uses React Suspense 
 * to ensure a smooth transition while the client side components initialize.
 */

import { Suspense } from 'react';
import { Metadata } from 'next';
import { supabaseAdmin } from '@/lib/core/supabase-admin';
import { HomeContent } from '@/components/layout/HomeContent';
import {
    absoluteSiteUrl,
    buildWebsiteJsonLd,
    serializeJsonLd,
} from '@/lib/siteConfig';

interface PageProps {
    searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const EVENT_NOINDEX_ROBOTS = {
    index: false,
    follow: true,
    nocache: true,
    googleBot: { index: false, follow: true, noimageindex: false },
} as const;

export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
    const params = await searchParams;
    const rawEventId = params.eventId;
    const eventId = Array.isArray(rawEventId) ? rawEventId[0] : rawEventId;

    if (!eventId) {
        return {
            alternates: { canonical: absoluteSiteUrl('/') },
        };
    }

    // Validate UUID format to prevent malformed queries
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(eventId)) {
        return {
            title: "Invalid Event",
            robots: { index: false, follow: false, nocache: true },
        };
    }

    try {
        const { data: event, error } = await supabaseAdmin
            .from('events')
            .select('title, description')
            .eq('id', eventId)
            .maybeSingle();

        if (error) {
            console.error('Error generating dynamic metadata:', error);
            return {
                title: "Event Unavailable",
                robots: EVENT_NOINDEX_ROBOTS,
            };
        }

        if (event) {
            const title = `${event.title} | Seraphim OSINT`;
            const description = event.description || "Real-time OSINT event details and mapping on Seraphim.";
            const eventUrl = absoluteSiteUrl(`/?eventId=${encodeURIComponent(eventId)}`);
            const ogImageUrl = absoluteSiteUrl(`/api/og?eventId=${encodeURIComponent(eventId)}`);

            return {
                title: { absolute: title },
                description,
                robots: EVENT_NOINDEX_ROBOTS,
                openGraph: {
                    title,
                    description,
                    url: eventUrl,
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
        return {
            title: "Event Unavailable",
            robots: EVENT_NOINDEX_ROBOTS,
        };
    }

    return {
        title: "Event Unavailable",
        robots: EVENT_NOINDEX_ROBOTS,
    };
}

export default function Home() {
    const websiteJsonLd = serializeJsonLd(buildWebsiteJsonLd());

    return (
        <>
            <script
                type="application/ld+json"
                dangerouslySetInnerHTML={{ __html: websiteJsonLd }}
            />
            <Suspense fallback={null}>
                <HomeContent />
            </Suspense>
        </>
    );
}
