import * as cheerio from 'cheerio';
import type { ImageCandidate, ImageOrigin } from './imageCandidates';
import { isObviousImageAsset } from './imageCandidates';
import {
  fetchPublicBytes,
  validatePublicImageUrl,
  type PublicImageFetchOptions,
} from '@/lib/security/ogImage';

const HTML_MAX_BYTES = 256 * 1024;
const IMAGE_PROBE_MAX_BYTES = 128 * 1024;
const MIN_IMAGE_AREA = 90_000;
const MIN_IMAGE_SIDE = 120;

export interface PageImageLookupInput {
  articleUrl: string;
  sourcePublishedAt: string;
  sourceTier: number;
}

export interface PageImageLookupOptions extends PublicImageFetchOptions {
  htmlMaxBytes?: number;
  imageProbeMaxBytes?: number;
}

function readUint16Le(bytes: Uint8Array, offset: number) {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readUint16Be(bytes: Uint8Array, offset: number) {
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function readUint24Le(bytes: Uint8Array, offset: number) {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function readUint32Be(bytes: Uint8Array, offset: number) {
  return (
    (bytes[offset] * 0x1000000) +
    (bytes[offset + 1] << 16) +
    (bytes[offset + 2] << 8) +
    bytes[offset + 3]
  ) >>> 0;
}

export function imageDimensions(bytes: Uint8Array, contentType: string) {
  if (
    contentType === 'image/png' &&
    bytes.length >= 24 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return { width: readUint32Be(bytes, 16), height: readUint32Be(bytes, 20) };
  }

  if (
    contentType === 'image/gif' &&
    bytes.length >= 10 &&
    String.fromCharCode(...bytes.subarray(0, 3)) === 'GIF'
  ) {
    return { width: readUint16Le(bytes, 6), height: readUint16Le(bytes, 8) };
  }

  if (contentType === 'image/jpeg' && bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) {
        offset++;
        continue;
      }
      const marker = bytes[offset + 1];
      if (marker === 0xd8 || marker === 0xd9) {
        offset += 2;
        continue;
      }
      const length = readUint16Be(bytes, offset + 2);
      if (length < 2 || offset + length + 2 > bytes.length) break;
      if (
        (marker >= 0xc0 && marker <= 0xc3) ||
        (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) ||
        (marker >= 0xcd && marker <= 0xcf)
      ) {
        return {
          height: readUint16Be(bytes, offset + 5),
          width: readUint16Be(bytes, offset + 7),
        };
      }
      offset += length + 2;
    }
  }

  if (
    contentType === 'image/webp' &&
    bytes.length >= 30 &&
    String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' &&
    String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP'
  ) {
    const chunk = String.fromCharCode(...bytes.subarray(12, 16));
    if (chunk === 'VP8X') {
      return {
        width: 1 + readUint24Le(bytes, 24),
        height: 1 + readUint24Le(bytes, 27),
      };
    }
  }

  return null;
}

export async function probePublicNewsImage(
  rawUrl: string,
  options: PageImageLookupOptions = {},
) {
  if (isObviousImageAsset(rawUrl)) return null;
  const safeUrl = validatePublicImageUrl(rawUrl);
  if (!safeUrl) return null;
  const result = await fetchPublicBytes(safeUrl, {
    ...options,
    maxBytes: options.imageProbeMaxBytes ?? IMAGE_PROBE_MAX_BYTES,
    allowedContentTypes: ['image/'],
    stopWhen: (bytes, contentType) => imageDimensions(bytes, contentType) !== null,
  });
  if (!result || result.contentType === 'image/svg+xml') return null;
  const dimensions = imageDimensions(result.bytes, result.contentType);
  if (
    dimensions &&
    (
      dimensions.width * dimensions.height < MIN_IMAGE_AREA ||
      Math.min(dimensions.width, dimensions.height) < MIN_IMAGE_SIDE ||
      dimensions.width / dimensions.height > 5 ||
      dimensions.height / dimensions.width > 5
    )
  ) {
    return null;
  }
  if (!dimensions && result.bytes.byteLength < 1024) return null;
  return {
    url: result.finalUrl,
    width: dimensions?.width,
    height: dimensions?.height,
  };
}

function pageCandidate(
  $: cheerio.CheerioAPI,
  finalArticleUrl: string,
): { url: string; origin: ImageOrigin } | null {
  const selectors: Array<{ selector: string; attribute: string; origin: ImageOrigin }> = [
    { selector: 'meta[property="og:image"]', attribute: 'content', origin: 'page-og' },
    { selector: 'meta[property="og:image:url"]', attribute: 'content', origin: 'page-og' },
    { selector: 'meta[name="twitter:image"]', attribute: 'content', origin: 'page-twitter' },
    { selector: 'meta[name="twitter:image:src"]', attribute: 'content', origin: 'page-twitter' },
    { selector: 'link[rel="image_src"]', attribute: 'href', origin: 'page-link' },
  ];
  for (const entry of selectors) {
    const rawUrl = $(entry.selector).first().attr(entry.attribute);
    if (!rawUrl) continue;
    try {
      const resolved = new URL(rawUrl, finalArticleUrl).toString();
      if (validatePublicImageUrl(resolved) && !isObviousImageAsset(resolved)) {
        return { url: resolved, origin: entry.origin };
      }
    } catch {
      // Try the next metadata shape.
    }
  }
  return null;
}

export async function fetchPageImageCandidate(
  input: PageImageLookupInput,
  options: PageImageLookupOptions = {},
): Promise<ImageCandidate | null> {
  const page = await fetchPublicBytes(input.articleUrl, {
    ...options,
    maxBytes: options.htmlMaxBytes ?? HTML_MAX_BYTES,
    allowedContentTypes: ['text/html', 'application/xhtml+xml'],
  });
  if (!page) return null;

  const html = new TextDecoder().decode(page.bytes);
  const metadata = pageCandidate(cheerio.load(html), page.finalUrl);
  if (!metadata) return null;
  const image = await probePublicNewsImage(metadata.url, options);
  if (!image) return null;

  return {
    ...image,
    sourceUrl: page.finalUrl,
    sourcePublishedAt: input.sourcePublishedAt,
    sourceTier: input.sourceTier,
    origin: metadata.origin,
  };
}
