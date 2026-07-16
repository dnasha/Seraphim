/* eslint-disable @next/next/no-img-element */
import { ImageResponse } from 'next/og';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { supabaseAdmin } from '@/lib/core/supabase-admin';
import { fetchPublicImage, safeReadImageResponse } from '@/lib/security/ogImage';
import { getTrustedClientIp } from '@/lib/security/clientIdentity';
import { createLocalFixedWindowLimiter, createThrottledDiagnostic } from '@/lib/security/localRateLimit';
import { createSingleFlight } from '@/lib/server/singleFlight';
import { getSiteOrigin } from '@/lib/siteConfig';

export const runtime = 'nodejs';

const BRAND_IMAGE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const EVENT_IMAGE_CACHE_TTL_MS = 60 * 60 * 1000;
const IMAGE_CACHE_MAX_ENTRIES = 8;
const OG_CACHE_CONTROL = 'public, s-maxage=86400, stale-while-revalidate=604800';
const BASE64_CHUNK_SIZE = 0x8000;
const imageDataUrlCache = new Map<string, { dataUrl: string; expiresAt: number }>();
const imageSingleFlight = createSingleFlight(IMAGE_CACHE_MAX_ENTRIES);
const ogPerIpLimit = createLocalFixedWindowLimiter({ limit: 60, windowMs: 60_000 });
const ogInstanceLimit = createLocalFixedWindowLimiter({ limit: 120, windowMs: 60_000, maxEntries: 1 });
const distributedRateLimitConfigured = process.env.NODE_ENV === 'test' || Boolean(
    process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN,
);
const ogDistributedRateLimit = distributedRateLimitConfigured
    ? new Ratelimit({
        redis: Redis.fromEnv(),
        limiter: Ratelimit.slidingWindow(60, '1 m'),
        analytics: false,
        prefix: '@upstash/ratelimit/seraphim-og',
    })
    : null;
const reportRateLimitUnavailable = createThrottledDiagnostic(() => {
    console.error('[api/og] Distributed rate limiter unavailable; local hard ceilings remain active.');
});

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
            'X-Robots-Tag': 'noindex, nofollow, noarchive',
        },
    });
}

// Helper to fetch an image and convert it to a base64 Data URL, avoiding edge issues.
async function fetchImageAsBase64(
    url: string,
    timeoutMs = 1500,
    trustedAsset = false,
    cacheTtlMs = EVENT_IMAGE_CACHE_TTL_MS,
): Promise<string | null> {
    return imageSingleFlight.run(url, async () => {
      try {
        const now = Date.now();
        pruneImageDataUrlCache(now);

        const cached = imageDataUrlCache.get(url);
        if (cached && cached.expiresAt > now) {
            return cached.dataUrl;
        }

        const safeImage = trustedAsset
            ? await fetchTrustedAsset(url, timeoutMs)
            : await fetchPublicImage(url, { timeoutMs });
        if (!safeImage) return null;
        
        const bytes = new Uint8Array(safeImage.arrayBuffer);
        const dataUrl = `data:${safeImage.contentType};base64,${uint8ArrayToBase64(bytes)}`;
        imageDataUrlCache.set(url, { dataUrl, expiresAt: now + cacheTtlMs });
        pruneImageDataUrlCache();
        return dataUrl;
      } catch (err) {
        console.error(`Error fetching image as base64 from ${url}:`, err);
        return null;
      }
    });
}

async function fetchTrustedAsset(url: string, timeoutMs: number) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(url, {
            signal: controller.signal,
            redirect: 'error',
            headers: { 'User-Agent': 'Seraphim/1.0 (OG brand asset)' },
        });
        if (!response.ok) return null;
        return safeReadImageResponse(response);
    } finally {
        clearTimeout(timeoutId);
    }
}

function genericOgRedirect(request: Request) {
    return Response.redirect(new URL('/Seraphim_OG_Dynamic.png', request.url), 302);
}

async function allowOgGeneration(request: Request) {
    const clientIp = getTrustedClientIp(request.headers);
    if (!clientIp) return false;
    const now = Date.now();
    const perIp = ogPerIpLimit.check([`net:${clientIp}`], now);
    const perInstance = ogInstanceLimit.check(['instance:og'], now);
    if (!perIp.success || !perInstance.success) return false;
    if (!ogDistributedRateLimit) {
        reportRateLimitUnavailable(now);
        return true;
    }
    try {
        return (await ogDistributedRateLimit.limit(`net:${clientIp}`)).success;
    } catch {
        reportRateLimitUnavailable(now);
        return true;
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

        if (!(await allowOgGeneration(request))) return genericOgRedirect(request);

        // Query the database to retrieve the event's image_url
        const { data: event } = await supabaseAdmin
            .from('events')
            .select('image_url')
            .eq('id', eventId)
            .single();

        const origin = getSiteOrigin();
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
        console.error('Error generating OG image:', e);
        return new Response('Failed to generate image', { status: 500 });
    }
}
