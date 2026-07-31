if (
  process.env.NODE_ENV !== 'test' &&
  !process.env.VITEST &&
  !process.versions?.bun
) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('server-only');
}

import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { Agent, buildConnector } from 'undici';

const MAX_OG_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_REDIRECTS = 3;

export type ResolvedAddress = { address: string; family: 4 | 6 };
export type ResolveHost = (hostname: string) => Promise<ResolvedAddress[]>;

type PinnedResponse = {
  response: Response;
  close: () => Promise<void>;
};

export type FetchHop = (
  url: URL,
  address: string,
  timeoutMs: number,
  headers?: HeadersInit,
) => Promise<PinnedResponse>;

export type PublicImageFetchOptions = {
  timeoutMs?: number;
  maxRedirects?: number;
  resolveHost?: ResolveHost;
  fetchHop?: FetchHop;
};

export type PublicBytesFetchOptions = PublicImageFetchOptions & {
  maxBytes: number;
  allowedContentTypes?: string[];
  headers?: HeadersInit;
  requireHttps?: boolean;
};

function unbracket(address: string) {
  return address.startsWith('[') && address.endsWith(']')
    ? address.slice(1, -1)
    : address;
}

function parseIpv4(address: string) {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return null;
  }
  return parts;
}

function parseIpv6(address: string) {
  const normalized = unbracket(address).toLowerCase();
  if (!normalized || normalized.includes('%') || normalized.split('::').length > 2) return null;

  const convert = (segment: string) => {
    if (!segment) return [] as number[];
    const chunks = segment.split(':');
    const values: number[] = [];
    for (let index = 0; index < chunks.length; index++) {
      const chunk = chunks[index];
      if (chunk.includes('.')) {
        if (index !== chunks.length - 1) return null;
        const ipv4 = parseIpv4(chunk);
        if (!ipv4) return null;
        values.push((ipv4[0] << 8) | ipv4[1], (ipv4[2] << 8) | ipv4[3]);
        continue;
      }
      if (!/^[0-9a-f]{1,4}$/.test(chunk)) return null;
      values.push(Number.parseInt(chunk, 16));
    }
    return values;
  };

  const [headRaw, tailRaw] = normalized.split('::');
  const head = convert(headRaw);
  const tail = tailRaw === undefined ? [] : convert(tailRaw);
  if (!head || !tail) return null;

  if (tailRaw === undefined) return head.length === 8 ? head : null;
  const missing = 8 - head.length - tail.length;
  return missing >= 1 ? [...head, ...Array(missing).fill(0), ...tail] : null;
}

/** Returns whether an IP address is globally routable for this fetch policy. */
export function isPublicIpAddress(rawAddress: string) {
  const address = unbracket(rawAddress);
  const family = isIP(address);

  if (family === 4) {
    const parts = parseIpv4(address);
    if (!parts) return false;
    const [a, b] = parts;
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }

  if (family !== 6) return false;
  const parts = parseIpv6(address);
  if (!parts) return false;

  const isUnspecified = parts.every((part) => part === 0);
  const isLoopback = parts.slice(0, 7).every((part) => part === 0) && parts[7] === 1;
  const isIpv4Embedded = parts.slice(0, 6).every((part) => part === 0) ||
    (parts.slice(0, 5).every((part) => part === 0) && parts[5] === 0xffff);
  if (isIpv4Embedded) {
    return isPublicIpAddress([
      parts[6] >> 8,
      parts[6] & 0xff,
      parts[7] >> 8,
      parts[7] & 0xff,
    ].join('.'));
  }

  return !(
    isUnspecified ||
    isLoopback ||
    (parts[0] & 0xffc0) === 0xfe80 || // link-local fe80::/10
    (parts[0] & 0xfe00) === 0xfc00 || // unique local fc00::/7
    (parts[0] & 0xff00) === 0xff00 // multicast ff00::/8
  );
}

function isBlockedHostname(hostname: string) {
  const normalized = hostname.toLowerCase();
  return normalized === 'localhost' || normalized.endsWith('.localhost') || normalized.endsWith('.local');
}

/** Performs only syntax checks; DNS answers are validated immediately before connection. */
export function validatePublicImageUrl(rawUrl: string) {
  try {
    const url = new URL(rawUrl);
    if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password) return null;
    if (isBlockedHostname(url.hostname)) return null;
    if (isIP(unbracket(url.hostname)) && !isPublicIpAddress(url.hostname)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export async function safeReadImageResponse(response: Response) {
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.toLowerCase().startsWith('image/')) return null;

  const contentLength = Number(response.headers.get('content-length') || 0);
  if (contentLength > MAX_OG_IMAGE_BYTES) return null;

  if (!response.body) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_OG_IMAGE_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { contentType, arrayBuffer: bytes.buffer };
}

async function resolveHost(hostname: string): Promise<ResolvedAddress[]> {
  const answers = await lookup(hostname, { all: true, verbatim: true });
  return answers.filter((answer): answer is ResolvedAddress => answer.family === 4 || answer.family === 6);
}

async function fetchPinnedHop(
  url: URL,
  address: string,
  timeoutMs: number,
  headers?: HeadersInit,
): Promise<PinnedResponse> {
  const connector = buildConnector({ timeout: timeoutMs });
  const dispatcher = new Agent({
    connections: 1,
    connect(options, callback) {
      connector({ ...options, hostname: address, servername: url.hostname }, callback);
    },
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const closeDispatcher = async () => {
    const compatible = dispatcher as Agent & {
      close?: () => Promise<void> | void;
      destroy?: () => Promise<void> | void;
    };
    if (typeof compatible.close === 'function') await compatible.close();
    else if (typeof compatible.destroy === 'function') await compatible.destroy();
  };
  try {
    // `dispatcher` is supported by Node's undici fetch but is absent from the DOM RequestInit type.
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: 'manual',
      headers: headers ?? { 'User-Agent': 'Seraphim/1.0 (OG image fetcher)' },
      // @ts-expect-error undici dispatcher extension
      dispatcher,
    });
    return {
      response,
      close: async () => {
        clearTimeout(timeout);
        await closeDispatcher();
      },
    };
  } catch (error) {
    clearTimeout(timeout);
    await closeDispatcher();
    throw error;
  }
}

function isRedirect(response: Response) {
  return [301, 302, 303, 307, 308].includes(response.status);
}

async function readResponsePrefix(response: Response, maxBytes: number) {
  if (!response.body || maxBytes <= 0) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let truncated = false;
  try {
    while (size < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      const remaining = maxBytes - size;
      if (value.byteLength > remaining) {
        chunks.push(value.subarray(0, remaining));
        size += remaining;
        truncated = true;
        await reader.cancel();
        break;
      }
      chunks.push(value);
      size += value.byteLength;
    }
    if (size === maxBytes && !truncated) {
      truncated = true;
      await reader.cancel();
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { bytes, truncated };
}

/**
 * Fetches a bounded prefix of a public HTTP resource through the same
 * DNS-pinned transport used by the OG image route. Redirect destinations are
 * revalidated independently, and the connection is closed as soon as the byte
 * budget is reached.
 */
export async function fetchPublicBytes(rawUrl: string, options: PublicBytesFetchOptions) {
  const timeoutMs = options.timeoutMs ?? 1500;
  const maxRedirects = options.maxRedirects ?? MAX_REDIRECTS;
  const resolver = options.resolveHost ?? resolveHost;
  const fetchHop = options.fetchHop ?? fetchPinnedHop;
  let rawDestination = rawUrl;

  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount++) {
    const safeDestination = validatePublicImageUrl(rawDestination);
    if (!safeDestination) return null;
    const url = new URL(safeDestination);
    if (options.requireHttps && url.protocol !== 'https:') return null;

    let answers: ResolvedAddress[];
    try {
      answers = await resolver(unbracket(url.hostname));
    } catch {
      return null;
    }
    const address = answers.find((answer) => isPublicIpAddress(answer.address));
    if (!address) return null;

    let hop: PinnedResponse;
    try {
      hop = await fetchHop(url, address.address, timeoutMs, options.headers);
    } catch {
      return null;
    }

    try {
      if (isRedirect(hop.response)) {
        const location = hop.response.headers.get('location');
        if (!location || redirectCount === maxRedirects) return null;
        rawDestination = new URL(location, url).toString();
        continue;
      }
      if (!hop.response.ok) return null;
      const contentType = (hop.response.headers.get('content-type') || '')
        .split(';', 1)[0]
        .trim()
        .toLowerCase();
      if (
        options.allowedContentTypes?.length &&
        !options.allowedContentTypes.some((allowed) => contentType.startsWith(allowed))
      ) {
        return null;
      }
      const prefix = await readResponsePrefix(hop.response, options.maxBytes);
      return prefix ? {
        ...prefix,
        contentType,
        finalUrl: url.toString(),
      } : null;
    } finally {
      if (!hop.response.bodyUsed) await hop.response.body?.cancel();
      await hop.close();
    }
  }

  return null;
}

/**
 * Fetches an external image through a DNS-pinned connection. Every redirect is
 * independently parsed, resolved, and checked before a socket is opened.
 */
export async function fetchPublicImage(rawUrl: string, options: PublicImageFetchOptions = {}) {
  const timeoutMs = options.timeoutMs ?? 1500;
  const maxRedirects = options.maxRedirects ?? MAX_REDIRECTS;
  const resolver = options.resolveHost ?? resolveHost;
  const fetchHop = options.fetchHop ?? fetchPinnedHop;
  let rawDestination = rawUrl;

  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount++) {
    const safeDestination = validatePublicImageUrl(rawDestination);
    if (!safeDestination) return null;
    const url = new URL(safeDestination);

    let answers: ResolvedAddress[];
    try {
      answers = await resolver(unbracket(url.hostname));
    } catch {
      return null;
    }
    const address = answers.find((answer) => isPublicIpAddress(answer.address));
    if (!address) return null;

    let hop: PinnedResponse;
    try {
      hop = await fetchHop(url, address.address, timeoutMs);
    } catch {
      return null;
    }

    try {
      if (isRedirect(hop.response)) {
        const location = hop.response.headers.get('location');
        if (!location || redirectCount === maxRedirects) return null;
        rawDestination = new URL(location, url).toString();
        continue;
      }
      if (!hop.response.ok) return null;
      return await safeReadImageResponse(hop.response);
    } finally {
      if (!hop.response.bodyUsed) await hop.response.body?.cancel();
      await hop.close();
    }
  }

  return null;
}
