import { fetchPublicBytes } from '@/lib/security/ogImage';

export const MAX_FEED_RESPONSE_BYTES = 2 * 1024 * 1024;

export interface FeedValidator {
  etag?: string | null;
  lastModified?: string | null;
}

export interface BoundedFeedResult extends FeedValidator {
  notModified: boolean;
  text: string | null;
}

export async function fetchBoundedFeed(
  url: string,
  options: {
    timeoutMs: number;
    headers?: HeadersInit;
    validator?: FeedValidator;
    signal?: AbortSignal;
  },
): Promise<BoundedFeedResult> {
  const headers = new Headers(options.headers);
  if (options.validator?.etag) headers.set('If-None-Match', options.validator.etag);
  if (options.validator?.lastModified) {
    headers.set('If-Modified-Since', options.validator.lastModified);
  }

  const result = await fetchPublicBytes(url, {
    maxBytes: MAX_FEED_RESPONSE_BYTES + 1,
    maxRedirects: 3,
    timeoutMs: options.timeoutMs,
    requireHttps: true,
    headers,
    allowedStatuses: [304],
    signal: options.signal,
  });
  if (result?.status === 304) {
    return {
      notModified: true,
      text: null,
      etag: options.validator?.etag ?? null,
      lastModified: options.validator?.lastModified ?? null,
    };
  }
  if (!result || result.truncated || result.bytes.byteLength > MAX_FEED_RESPONSE_BYTES) {
    throw new Error('Feed response unavailable or exceeds byte limit');
  }

  const text = new TextDecoder('utf-8', { fatal: false }).decode(result.bytes).trim();
  if (!text.startsWith('<')) {
    throw new Error(`Invalid XML response (starts with "${text.slice(0, 20)}...")`);
  }
  return {
    notModified: false,
    text,
    etag: result.headers?.get('etag') ?? null,
    lastModified: result.headers?.get('last-modified') ?? null,
  };
}

export async function fetchBoundedFeedText(
  url: string,
  options: { timeoutMs: number; headers?: HeadersInit; signal?: AbortSignal },
) {
  const result = await fetchBoundedFeed(url, options);
  if (!result.text) throw new Error('Feed returned no content');
  return result.text;
}
