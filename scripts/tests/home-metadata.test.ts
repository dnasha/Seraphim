import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const maybeSingle = vi.hoisted(() => vi.fn());

vi.mock('@/lib/core/supabase-admin', () => ({
  supabaseAdmin: {
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle }),
      }),
    }),
  },
}));

import { generateMetadata } from '@/app/page';

const EVENT_ID = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  vi.stubEnv('SITE_URL', 'https://www.seraphi.me');
  maybeSingle.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('homepage metadata', () => {
  it('canonicalizes ordinary map-state URLs to the homepage', async () => {
    const metadata = await generateMetadata({
      searchParams: Promise.resolve({ lat: '1', lng: '2', zoom: '3' }),
    });

    expect(metadata.alternates).toEqual({ canonical: 'https://www.seraphi.me/' });
    expect(metadata.robots).toBeUndefined();
    expect(maybeSingle).not.toHaveBeenCalled();
  });

  it('keeps valid event shares out of the index while preserving social metadata', async () => {
    maybeSingle.mockResolvedValue({
      data: { title: 'Example event', description: 'Example description' },
      error: null,
    });

    const metadata = await generateMetadata({
      searchParams: Promise.resolve({ eventId: EVENT_ID }),
    });

    expect(metadata.title).toEqual({ absolute: 'Example event | Seraphim OSINT' });
    expect(metadata.robots).toMatchObject({ index: false, follow: true, nocache: true });
    expect(metadata.alternates).toBeUndefined();
    expect(metadata.openGraph).toMatchObject({
      url: `https://www.seraphi.me/?eventId=${EVENT_ID}`,
      type: 'article',
      images: [{ url: `https://www.seraphi.me/og/${EVENT_ID}` }],
    });
    expect(metadata.twitter).toMatchObject({
      card: 'summary_large_image',
      images: [`https://www.seraphi.me/og/${EVENT_ID}`],
    });
  });

  it('marks invalid event identifiers noindex and nofollow', async () => {
    const metadata = await generateMetadata({
      searchParams: Promise.resolve({ eventId: 'invalid' }),
    });

    expect(metadata.robots).toMatchObject({ index: false, follow: false, nocache: true });
    expect(maybeSingle).not.toHaveBeenCalled();
  });

  it('marks missing events noindex but followable', async () => {
    maybeSingle.mockResolvedValueOnce({ data: null, error: null });
    const missing = await generateMetadata({
      searchParams: Promise.resolve({ eventId: EVENT_ID }),
    });
    expect(missing).toMatchObject({
      title: 'Event Unavailable',
      robots: { index: false, follow: true, nocache: true },
    });
  });

  it('handles resolved Supabase permission errors without inheriting event metadata', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const permissionError = { code: '42501', message: 'permission denied for table events' };
    maybeSingle.mockResolvedValueOnce({ data: null, error: permissionError });
    const failed = await generateMetadata({
      searchParams: Promise.resolve({ eventId: EVENT_ID }),
    });

    expect(failed).toMatchObject({
      title: 'Event Unavailable',
      robots: { index: false, follow: true, nocache: true },
    });
    expect(failed.openGraph).toBeUndefined();
    expect(consoleError).toHaveBeenCalledWith('Error generating dynamic metadata:', permissionError);
    consoleError.mockRestore();
  });

  it('handles thrown lookup failures', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    maybeSingle.mockRejectedValueOnce(new Error('unavailable'));

    const failed = await generateMetadata({
      searchParams: Promise.resolve({ eventId: EVENT_ID }),
    });

    expect(failed).toMatchObject({
      title: 'Event Unavailable',
      robots: { index: false, follow: true, nocache: true },
    });
    consoleError.mockRestore();
  });
});
