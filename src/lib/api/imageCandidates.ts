import type { NewsItem } from '@/lib/core/types';

export type ImageOrigin =
  | 'feed'
  | 'feed-html'
  | 'gnews'
  | 'telegram'
  | 'x'
  | 'page-og'
  | 'page-twitter'
  | 'page-link'
  | 'legacy';

export interface ImageCandidate {
  url: string;
  sourceUrl: string;
  sourcePublishedAt: string;
  sourceTier: number;
  origin: ImageOrigin;
  width?: number;
  height?: number;
}

const IMAGE_EXTENSION = /\.(?:avif|gif|jpe?g|png|webp)(?:$|[?#])/i;
const OBVIOUS_ASSET = /(?:^|[\/_.-])(?:avatar|badge|emoji|favicon|icon|logo|pixel|spacer|sprite|tracking)(?:[\/_.-]|$)/i;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object'
    ? value as Record<string, unknown>
    : null;
}

function resolveCandidateUrl(rawUrl: unknown, articleUrl: string): string | null {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) return null;
  try {
    const url = new URL(rawUrl.trim(), articleUrl);
    if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password) {
      return null;
    }
    const normalized = url.toString();
    return OBVIOUS_ASSET.test(`${url.hostname}${url.pathname}`) ? null : normalized;
  } catch {
    return null;
  }
}

function dimensions(record: Record<string, unknown>) {
  const attrs = asRecord(record.$) ?? record;
  const width = Number(attrs.width);
  const height = Number(attrs.height);
  return {
    width: Number.isFinite(width) && width > 0 ? width : undefined,
    height: Number.isFinite(height) && height > 0 ? height : undefined,
  };
}

function urlFromRecord(value: unknown, articleUrl: string): {
  url: string;
  width?: number;
  height?: number;
} | null {
  if (typeof value === 'string') {
    const url = resolveCandidateUrl(value, articleUrl);
    return url ? { url } : null;
  }
  const record = asRecord(value);
  if (!record) return null;
  const attrs = asRecord(record.$) ?? record;
  const rawUrl = attrs.url ?? attrs.href ?? attrs.src;
  const url = resolveCandidateUrl(rawUrl, articleUrl);
  if (!url) return null;
  return { url, ...dimensions(record) };
}

function flatten(value: unknown): unknown[] {
  if (Array.isArray(value)) return value.flatMap(flatten);
  return value == null ? [] : [value];
}

function firstRecordUrl(values: unknown[], articleUrl: string, requireImageType = false) {
  for (const value of values) {
    const record = asRecord(value);
    if (requireImageType && record) {
      const attrs = asRecord(record.$) ?? record;
      const type = typeof attrs.type === 'string' ? attrs.type.toLowerCase() : '';
      const raw = String(attrs.url ?? attrs.href ?? '');
      if (type && !type.startsWith('image/') && !IMAGE_EXTENSION.test(raw)) continue;
    }
    const candidate = urlFromRecord(value, articleUrl);
    if (candidate) return candidate;
  }
  return null;
}

function extractHtmlImage(html: unknown, articleUrl: string) {
  if (typeof html !== 'string' || !html.includes('<')) return null;
  const matches = html.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi);
  for (const match of matches) {
    const url = resolveCandidateUrl(match[1], articleUrl);
    if (url) return { url };
  }
  return null;
}

/**
 * Extracts the best image already present in an RSS/Atom/social feed item.
 * This function is deliberately pure so every adapter can share the same
 * compatibility behavior without adding outbound requests.
 */
export function extractFeedImageCandidate(
  item: Record<string, unknown>,
  input: {
    articleUrl: string;
    sourcePublishedAt: string;
    sourceTier: number;
    origin?: ImageOrigin;
  },
): ImageCandidate | null {
  const directFields = [
    ...flatten(item['media:content']),
    ...flatten(item['media:thumbnail']),
  ];
  let found = firstRecordUrl(directFields, input.articleUrl);

  if (!found) {
    const groups = flatten(item['media:group']);
    const grouped = groups.flatMap((group) => {
      const record = asRecord(group);
      return record
        ? [...flatten(record['media:content']), ...flatten(record['media:thumbnail'])]
        : [];
    });
    found = firstRecordUrl(grouped, input.articleUrl);
  }

  if (!found) {
    found = firstRecordUrl(flatten(item.enclosure), input.articleUrl, true);
  }

  if (!found) {
    const links = flatten(item.link).concat(flatten(item.links)).filter((value) => {
      const record = asRecord(value);
      if (!record) return false;
      const attrs = asRecord(record.$) ?? record;
      return attrs.rel === 'enclosure' || attrs.rel === 'image_src';
    });
    found = firstRecordUrl(links, input.articleUrl, true);
  }

  let origin = input.origin ?? 'feed';
  if (!found) {
    const htmlFields = [
      item['content:encoded'],
      item.content,
      item.description,
      item.summary,
    ];
    for (const html of htmlFields) {
      found = extractHtmlImage(html, input.articleUrl);
      if (found) {
        origin = input.origin ?? 'feed-html';
        break;
      }
    }
  }

  return found ? {
    ...found,
    sourceUrl: input.articleUrl,
    sourcePublishedAt: input.sourcePublishedAt,
    sourceTier: input.sourceTier,
    origin,
  } : null;
}

export function applyImageCandidate<T extends NewsItem>(
  item: T,
  candidate: ImageCandidate | null,
): T {
  if (!candidate) return item;
  return {
    ...item,
    imageUrl: candidate.url,
    imageSourceUrl: candidate.sourceUrl,
    imageSourcePublishedAt: candidate.sourcePublishedAt,
    imageOrigin: candidate.origin,
  };
}

export function isObviousImageAsset(url: string) {
  try {
    const parsed = new URL(url);
    return OBVIOUS_ASSET.test(`${parsed.hostname}${parsed.pathname}`);
  } catch {
    return true;
  }
}
