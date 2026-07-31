import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ fetchPublicBytes: vi.fn() }));

vi.mock('@/lib/security/ogImage', () => ({
  fetchPublicBytes: mocks.fetchPublicBytes,
}));

import {
  MAX_FEED_RESPONSE_BYTES,
  fetchBoundedFeed,
  fetchBoundedFeedText,
} from '@/lib/security/feedFetch';

describe('bounded feed transport', () => {
  beforeEach(() => vi.clearAllMocks());

  it('requires verified HTTPS and a bounded redirect chain', async () => {
    mocks.fetchPublicBytes.mockResolvedValue({
      bytes: new TextEncoder().encode('<rss></rss>'),
      truncated: false,
      contentType: 'application/rss+xml',
      finalUrl: 'https://feed.example/rss',
      status: 200,
      headers: new Headers({ etag: '"feed-v1"' }),
    });

    await expect(fetchBoundedFeedText('https://feed.example/rss', {
      timeoutMs: 15_000,
      headers: { Accept: 'application/rss+xml' },
    })).resolves.toBe('<rss></rss>');
    expect(mocks.fetchPublicBytes).toHaveBeenCalledWith('https://feed.example/rss', expect.objectContaining({
      maxBytes: MAX_FEED_RESPONSE_BYTES + 1,
      maxRedirects: 3,
      requireHttps: true,
      timeoutMs: 15_000,
    }));
  });

  it('rejects oversized, truncated, and non-XML responses before parsing', async () => {
    mocks.fetchPublicBytes.mockResolvedValueOnce({
      bytes: new Uint8Array(MAX_FEED_RESPONSE_BYTES + 1),
      truncated: false,
    });
    await expect(fetchBoundedFeedText('https://feed.example/large', { timeoutMs: 15_000 }))
      .rejects.toThrow(/byte limit/);

    mocks.fetchPublicBytes.mockResolvedValueOnce({
      bytes: new TextEncoder().encode('not xml'),
      truncated: false,
    });
    await expect(fetchBoundedFeedText('https://feed.example/html', { timeoutMs: 15_000 }))
      .rejects.toThrow(/Invalid XML/);
  });

  it('returns a body-free not-modified result and sends stored validators', async () => {
    mocks.fetchPublicBytes.mockResolvedValueOnce({
      bytes: new Uint8Array(0),
      truncated: false,
      status: 304,
      headers: new Headers(),
    });

    await expect(fetchBoundedFeed('https://feed.example/rss', {
      timeoutMs: 15_000,
      validator: { etag: '"feed-v1"', lastModified: 'Wed, 29 Jul 2026 12:00:00 GMT' },
    })).resolves.toMatchObject({ notModified: true, text: null, etag: '"feed-v1"' });

    const options = mocks.fetchPublicBytes.mock.calls[0][1];
    expect(new Headers(options.headers).get('if-none-match')).toBe('"feed-v1"');
    expect(new Headers(options.headers).get('if-modified-since')).toBe('Wed, 29 Jul 2026 12:00:00 GMT');
  });
});
