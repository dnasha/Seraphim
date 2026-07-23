import { GET as renderLegacyOgImage } from '@/app/api/og/route';

export const runtime = 'nodejs';

/**
 * Public event-card image route.
 *
 * The API namespace is deliberately excluded by robots.txt, so social crawlers
 * must receive the same renderer from a crawlable URL. Keeping the legacy API
 * handler as the implementation also preserves already-shared image URLs.
 */
export async function GET(
    request: Request,
    { params }: { params: Promise<{ eventId: string }> },
) {
    const { eventId } = await params;
    const legacyUrl = new URL('/api/og', request.url);
    legacyUrl.searchParams.set('eventId', eventId);

    return renderLegacyOgImage(new Request(legacyUrl, {
        headers: request.headers,
        signal: request.signal,
    }));
}
