import {
  fetchPublicBytes,
  PublicFetchError,
} from '@/lib/security/ogImage';

export const MAX_FEED_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_INLINE_RETRY_DELAY_MS = 5_000;

export class FeedFetchError extends Error {
  readonly sourceErrorCode: string;
  readonly retryable: boolean;
  readonly retryAfterMs?: number;
  readonly status?: number;
  readonly finalUrl?: string;

  constructor(
    sourceErrorCode: string,
    message: string,
    details: {
      retryable?: boolean;
      retryAfterMs?: number;
      status?: number;
      finalUrl?: string;
    } = {},
  ) {
    super(message);
    this.name = 'FeedFetchError';
    this.sourceErrorCode = sourceErrorCode;
    this.retryable = details.retryable ?? false;
    this.retryAfterMs = details.retryAfterMs;
    this.status = details.status;
    this.finalUrl = details.finalUrl;
  }
}

export interface FeedValidator {
  etag?: string | null;
  lastModified?: string | null;
}

export interface BoundedFeedResult extends FeedValidator {
  notModified: boolean;
  text: string | null;
  finalUrl?: string;
  status?: number;
  bytesRead?: number;
}

interface FeedFetchOptions {
  timeoutMs: number;
  headers?: HeadersInit;
  validator?: FeedValidator;
  signal?: AbortSignal;
  maxAttempts?: number;
  retryBaseDelayMs?: number;
  sleep?: (delayMs: number) => Promise<void>;
  random?: () => number;
}

function isRetryableStatus(status: number | undefined) {
  return status === 408 || status === 425 || status === 429 || (status !== undefined && status >= 500);
}

function normalizePublicFetchError(error: PublicFetchError) {
  const sourceErrorCode = error.status ? `http_${error.status}` : error.code;
  return new FeedFetchError(sourceErrorCode, error.message, {
    retryable: error.code === 'timeout' ||
      error.code === 'dns_failure' ||
      error.code === 'connect_failure' ||
      error.code === 'body_read_failure' ||
      (error.code === 'http_error' && isRetryableStatus(error.status)),
    retryAfterMs: error.retryAfterMs,
    status: error.status,
    finalUrl: error.finalUrl,
  });
}

async function fetchBoundedFeedOnce(
  url: string,
  options: FeedFetchOptions,
  headers: Headers,
): Promise<BoundedFeedResult> {
  let result;
  try {
    result = await fetchPublicBytes(url, {
      maxBytes: MAX_FEED_RESPONSE_BYTES + 1,
      maxRedirects: 3,
      timeoutMs: options.timeoutMs,
      requireHttps: true,
      headers,
      allowedStatuses: [304],
      signal: options.signal,
      throwOnError: true,
    });
  } catch (error) {
    if (error instanceof PublicFetchError) throw normalizePublicFetchError(error);
    throw error;
  }

  if (result?.status === 304) {
    return {
      notModified: true,
      text: null,
      etag: options.validator?.etag ?? null,
      lastModified: options.validator?.lastModified ?? null,
      finalUrl: result.finalUrl,
      status: result.status,
      bytesRead: 0,
    };
  }
  if (!result) {
    throw new FeedFetchError('body_unavailable', 'Feed response body is unavailable', { retryable: true });
  }
  if (result.truncated || result.bytes.byteLength > MAX_FEED_RESPONSE_BYTES) {
    throw new FeedFetchError(
      'byte_limit',
      `Feed response exceeds ${MAX_FEED_RESPONSE_BYTES} byte limit`,
      { status: result.status, finalUrl: result.finalUrl },
    );
  }

  const text = new TextDecoder('utf-8', { fatal: false }).decode(result.bytes).trim();
  if (!text.startsWith('<')) {
    throw new FeedFetchError(
      'invalid_xml',
      `Invalid XML response (starts with "${text.slice(0, 20)}...")`,
      { status: result.status, finalUrl: result.finalUrl },
    );
  }
  return {
    notModified: false,
    text,
    etag: result.headers?.get('etag') ?? null,
    lastModified: result.headers?.get('last-modified') ?? null,
    finalUrl: result.finalUrl,
    status: result.status,
    bytesRead: result.bytes.byteLength,
  };
}

export async function fetchBoundedFeed(
  url: string,
  options: FeedFetchOptions,
): Promise<BoundedFeedResult> {
  const headers = new Headers(options.headers);
  if (options.validator?.etag) headers.set('If-None-Match', options.validator.etag);
  if (options.validator?.lastModified) {
    headers.set('If-Modified-Since', options.validator.lastModified);
  }

  const maxAttempts = Math.max(1, options.maxAttempts ?? 1);
  const sleep = options.sleep ?? ((delayMs: number) => new Promise<void>((resolve) => setTimeout(resolve, delayMs)));
  const random = options.random ?? Math.random;
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fetchBoundedFeedOnce(url, options, headers);
    } catch (error) {
      lastError = error;
      const retryable = error instanceof FeedFetchError && error.retryable;
      const retryAfterMs = error instanceof FeedFetchError ? error.retryAfterMs : undefined;
      if (
        !retryable ||
        attempt === maxAttempts ||
        options.signal?.aborted ||
        (retryAfterMs !== undefined && retryAfterMs > MAX_INLINE_RETRY_DELAY_MS)
      ) {
        throw error;
      }
      const exponentialDelay = (options.retryBaseDelayMs ?? 500) * 2 ** (attempt - 1);
      const delayMs = retryAfterMs ?? Math.round(exponentialDelay * (0.75 + random() * 0.5));
      await sleep(delayMs);
    }
  }
  throw lastError;
}

export async function fetchBoundedFeedText(
  url: string,
  options: FeedFetchOptions,
) {
  const result = await fetchBoundedFeed(url, options);
  if (!result.text) throw new Error('Feed returned no content');
  return result.text;
}
