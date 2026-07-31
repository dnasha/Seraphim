import { fetchPublicBytes } from '@/lib/security/ogImage';

export const MAX_FEED_RESPONSE_BYTES = 2 * 1024 * 1024;

export async function fetchBoundedFeedText(
  url: string,
  options: { timeoutMs: number; headers?: HeadersInit },
) {
  const result = await fetchPublicBytes(url, {
    maxBytes: MAX_FEED_RESPONSE_BYTES + 1,
    maxRedirects: 3,
    timeoutMs: options.timeoutMs,
    requireHttps: true,
    headers: options.headers,
  });
  if (!result || result.truncated || result.bytes.byteLength > MAX_FEED_RESPONSE_BYTES) {
    throw new Error('Feed response unavailable or exceeds byte limit');
  }

  const text = new TextDecoder('utf-8', { fatal: false }).decode(result.bytes).trim();
  if (!text.startsWith('<')) {
    throw new Error(`Invalid XML response (starts with "${text.slice(0, 20)}...")`);
  }
  return text;
}
