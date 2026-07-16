import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const single = vi.hoisted(() => vi.fn());

vi.mock('@/lib/core/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({ single }),
      }),
    }),
  },
}));

import { generateMetadata } from '@/app/page';

const EVENT_ID = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  vi.stubEnv('SITE_URL', 'https://www.seraphi.me');
  single.mockReset();
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
    expect(single).not.toHaveBeenCalled();
  });

  it('keeps valid event shares out of the index while preserving social metadata', async () => {
    single.mockResolvedValue({
      data: { title: 'Example event', description: 'Example description' },
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
    });
  });

  it('marks invalid event identifiers noindex and nofollow', async () => {
    const metadata = await generateMetadata({
      searchParams: Promise.resolve({ eventId: 'invalid' }),
    });

    expect(metadata.robots).toMatchObject({ index: false, follow: false, nocache: true });
    expect(single).not.toHaveBeenCalled();
  });

  it('marks missing events and lookup failures noindex but followable', async () => {
    single.mockResolvedValueOnce({ data: null });
    const missing = await generateMetadata({
      searchParams: Promise.resolve({ eventId: EVENT_ID }),
    });
    expect(missing).toMatchObject({
      title: 'Event Unavailable',
      robots: { index: false, follow: true, nocache: true },
    });

    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    single.mockRejectedValueOnce(new Error('unavailable'));
    const failed = await generateMetadata({
      searchParams: Promise.resolve({ eventId: EVENT_ID }),
    });
    consoleError.mockRestore();
    expect(failed).toMatchObject({
      title: 'Event Unavailable',
      robots: { index: false, follow: true, nocache: true },
    });
  });
});
