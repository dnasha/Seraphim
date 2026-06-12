/* eslint-disable @next/next/no-img-element */
import { ImageResponse } from 'next/og';
import { supabase } from '@/lib/core/supabase';
import { safeReadImageResponse, validatePublicImageUrl } from '@/lib/security/ogImage';

export const runtime = 'edge';

const BRAND_IMAGE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const EVENT_IMAGE_CACHE_TTL_MS = 60 * 60 * 1000;
const IMAGE_CACHE_MAX_ENTRIES = 32;
const OG_CACHE_CONTROL = 'public, s-maxage=86400, stale-while-revalidate=604800';
const BASE64_CHUNK_SIZE = 0x8000;

const imageDataUrlCache = new Map<string, { dataUrl: string; expiresAt: number }>();

function pruneImageDataUrlCache(now = Date.now()) {
    for (const [key, cached] of imageDataUrlCache.entries()) {
        if (cached.expiresAt <= now) {
            imageDataUrlCache.delete(key);
        }
    }

    while (imageDataUrlCache.size > IMAGE_CACHE_MAX_ENTRIES) {
        const oldestKey = imageDataUrlCache.keys().next().value as string | undefined;
        if (!oldestKey) break;
        imageDataUrlCache.delete(oldestKey);
    }
}

function uint8ArrayToBase64(bytes: Uint8Array) {
    const chunks: string[] = [];
    for (let i = 0; i < bytes.length; i += BASE64_CHUNK_SIZE) {
        chunks.push(String.fromCharCode(...bytes.subarray(i, i + BASE64_CHUNK_SIZE)));
    }
    return btoa(chunks.join(''));
}

function imageResponse(element: React.ReactElement) {
    return new ImageResponse(element, {
        width: 1200,
        height: 630,
        headers: {
            'Cache-Control': OG_CACHE_CONTROL,
        },
    });
}

// Helper to fetch an image and convert it to a base64 Data URL, avoiding edge issues.
async function fetchImageAsBase64(
    url: string,
    timeoutMs = 1500,
    allowLocal = false,
    cacheTtlMs = EVENT_IMAGE_CACHE_TTL_MS,
): Promise<string | null> {
    try {
        const safeUrl = allowLocal ? url : validatePublicImageUrl(url);
        if (!safeUrl) return null;

        const now = Date.now();
        pruneImageDataUrlCache(now);

        const cached = imageDataUrlCache.get(safeUrl);
        if (cached && cached.expiresAt > now) {
            return cached.dataUrl;
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
        let response: Response;
        try {
            response = await fetch(safeUrl, {
                signal: controller.signal,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                }
            });
        } finally {
            clearTimeout(timeoutId);
        }
        
        if (!response.ok) {
            console.warn(`Failed to fetch image from ${url}, status: ${response.status}`);
            return null;
        }
        
        const safeImage = await safeReadImageResponse(response);
        if (!safeImage) return null;
        
        const bytes = new Uint8Array(safeImage.arrayBuffer);
        const dataUrl = `data:${safeImage.contentType};base64,${uint8ArrayToBase64(bytes)}`;
        imageDataUrlCache.set(safeUrl, { dataUrl, expiresAt: now + cacheTtlMs });
        pruneImageDataUrlCache();
        return dataUrl;
    } catch (err) {
        console.error(`Error fetching image as base64 from ${url}:`, err);
        return null;
    }
}

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const eventId = searchParams.get('eventId');

        if (!eventId) {
            return new Response('Missing eventId', { status: 400 });
        }

        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (!uuidRegex.test(eventId)) {
            return new Response('Invalid UUID format', { status: 400 });
        }

        // Query the database to retrieve the event's image_url
        const { data: event } = await supabase
            .from('events')
            .select('image_url')
            .eq('id', eventId)
            .single();

        const urlObj = new URL(request.url);
        const origin = urlObj.origin;
        const fallbackUrl = `${origin}/Seraphim_OG_Dynamic.png`;
        const halfBrandUrl = `${origin}/Seraphim_OG_Dynamic_Half.png`;

        // Pre-fetch brand assets locally for resilient rendering in Satori
        const [fallbackBase64, halfBrandBase64] = await Promise.all([
            fetchImageAsBase64(fallbackUrl, 2000, true, BRAND_IMAGE_CACHE_TTL_MS),
            fetchImageAsBase64(halfBrandUrl, 2000, true, BRAND_IMAGE_CACHE_TTL_MS),
        ]);

        const fallbackImageSrc = fallbackBase64 || fallbackUrl;
        const halfBrandImageSrc = halfBrandBase64 || halfBrandUrl;

        let eventImageBase64: string | null = null;
        if (event?.image_url) {
            eventImageBase64 = await fetchImageAsBase64(event.image_url, 1500, false, EVENT_IMAGE_CACHE_TTL_MS);
        }

        // Determine if we should render split-screen or full-screen fallback
        if (eventImageBase64) {
            return imageResponse(
                (
                    <div
                        style={{
                            height: '100%',
                            width: '100%',
                            display: 'flex',
                            flexDirection: 'row',
                            backgroundColor: '#0b0f19',
                            boxSizing: 'border-box',
                        }}
                    >
                        {/* Left Half: Crop of news event image */}
                        <img
                            src={eventImageBase64}
                            alt="Event Image"
                            style={{
                                width: '600px',
                                height: '630px',
                                objectFit: 'cover',
                            }}
                        />
                        {/* Right Half: Brand Panel */}
                        <img
                            src={halfBrandImageSrc}
                            alt="Seraphim Brand Panel"
                            style={{
                                width: '600px',
                                height: '630px',
                                objectFit: 'cover',
                            }}
                        />
                    </div>
                )
            );
        }

        // Fallback: Full-bleed static brand image
        return imageResponse(
            (
                <div
                    style={{
                        height: '100%',
                        width: '100%',
                        display: 'flex',
                        backgroundColor: '#0b0f19',
                        boxSizing: 'border-box',
                    }}
                >
                    <img
                        src={fallbackImageSrc}
                        alt="Seraphim OG Fallback"
                        style={{
                            width: '1200px',
                            height: '630px',
                            objectFit: 'cover',
                        }}
                    />
                </div>
            )
        );
    } catch (e) {
        const error = e as Error;
        console.error('Error generating OG image:', error);
        return new Response(`Failed to generate image: ${error.message}`, { status: 500 });
    }
}
