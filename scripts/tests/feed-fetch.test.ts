import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ fetchPublicBytes: vi.fn() }));

vi.mock('@/lib/security/ogImage', () => ({
  fetchPublicBytes: mocks.fetchPublicBytes,
}));

import {
  MAX_FEED_RESPONSE_BYTES,
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
});
