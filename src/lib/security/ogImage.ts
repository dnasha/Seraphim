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
  signal?: AbortSignal,
) => Promise<PinnedResponse>;

export type PublicImageFetchOptions = {
  timeoutMs?: number;
  maxRedirects?: number;
  resolveHost?: ResolveHost;
  fetchHop?: FetchHop;
  signal?: AbortSignal;
};

export type PublicBytesFetchOptions = PublicImageFetchOptions & {
  maxBytes: number;
  allowedContentTypes?: string[];
  allowedStatuses?: number[];
  headers?: HeadersInit;
  requireHttps?: boolean;
  stopWhen?: (bytes: Uint8Array, contentType: string) => boolean;
  throwOnError?: boolean;
};

export type PublicFetchFailureCode =
  | 'invalid_url'
  | 'https_required'
  | 'dns_failure'
  | 'no_public_address'
  | 'timeout'
  | 'connect_failure'
  | 'redirect_missing'
  | 'redirect_limit'
  | 'http_error'
  | 'content_type'
  | 'body_read_failure';

export class PublicFetchError extends Error {
  readonly code: PublicFetchFailureCode;
  readonly status?: number;
  readonly retryAfterMs?: number;
  readonly finalUrl?: string;

  constructor(
    code: PublicFetchFailureCode,
    message: string,
    details: { status?: number; retryAfterMs?: number; finalUrl?: string } = {},
  ) {
    super(message);
    this.name = 'PublicFetchError';
    this.code = code;
    this.status = details.status;
    this.retryAfterMs = details.retryAfterMs;
    this.finalUrl = details.finalUrl;
  }
}

function parseRetryAfter(value: string | null, now = Date.now()) {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : undefined;
}

function failPublicBytes(options: PublicBytesFetchOptions, error: PublicFetchError): null {
  if (options.throwOnError) throw error;
  return null;
}

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

const MAX_PINNED_AGENT_POOL_SIZE = 32;
const pinnedAgentPool = new Map<string, Agent>();

/**
 * Node's undici Agent exposes close/destroy, while Bun's compatible dispatcher
 * may expose neither. Transport cleanup must never turn a completed ingestion
 * run into a failed job.
 */
export async function disposePublicFetchAgent(agent: unknown) {
  if (!agent || typeof agent !== 'object') return;
  const compatible = agent as {
    close?: () => Promise<void> | void;
    destroy?: () => Promise<void> | void;
  };

  try {
    if (typeof compatible.close === 'function') {
      await compatible.close();
      return;
    }
    if (typeof compatible.destroy === 'function') await compatible.destroy();
  } catch {
    // The process is already exiting and requests are complete. Cleanup is
    // best-effort, so a runtime-specific dispatcher error must not fail the run.
  }
}

function pooledPinnedAgent(url: URL, address: string, timeoutMs: number) {
  const key = `${url.protocol}//${url.hostname}|${address}|${timeoutMs}`;
  const existing = pinnedAgentPool.get(key);
  if (existing) {
    pinnedAgentPool.delete(key);
    pinnedAgentPool.set(key, existing);
    return existing;
  }

  const connector = buildConnector({ timeout: timeoutMs });
  const dispatcher = new Agent({
    connections: 2,
    keepAliveTimeout: 5_000,
    keepAliveMaxTimeout: 15_000,
    connect(options, callback) {
      connector({ ...options, hostname: address, servername: url.hostname }, callback);
    },
  });
  pinnedAgentPool.set(key, dispatcher);

  while (pinnedAgentPool.size > MAX_PINNED_AGENT_POOL_SIZE) {
    const oldestKey = pinnedAgentPool.keys().next().value as string | undefined;
    if (!oldestKey) break;
    const oldest = pinnedAgentPool.get(oldestKey);
    pinnedAgentPool.delete(oldestKey);
    void disposePublicFetchAgent(oldest);
  }
  return dispatcher;
}

export async function closePublicFetchAgents() {
  const agents = [...pinnedAgentPool.values()];
  pinnedAgentPool.clear();
  await Promise.all(agents.map(disposePublicFetchAgent));
}

async function fetchPinnedHop(
  url: URL,
  address: string,
  timeoutMs: number,
  headers?: HeadersInit,
  signal?: AbortSignal,
): Promise<PinnedResponse> {
  const dispatcher = pooledPinnedAgent(url, address, timeoutMs);
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort(signal?.reason);
  if (signal?.aborted) abortFromCaller();
  else signal?.addEventListener('abort', abortFromCaller, { once: true });
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const releaseRequest = async () => {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abortFromCaller);
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
      close: releaseRequest,
    };
  } catch (error) {
    await releaseRequest();
    throw error;
  }
}

function isRedirect(response: Response) {
  return [301, 302, 303, 307, 308].includes(response.status);
}

async function readResponsePrefix(
  response: Response,
  maxBytes: number,
  contentType: string,
  stopWhen?: (bytes: Uint8Array, contentType: string) => boolean,
) {
  if (!response.body || maxBytes <= 0) return null;
  const reader = response.body.getReader();
  const buffer = new Uint8Array(maxBytes);
  let size = 0;
  let truncated = false;
  try {
    while (size < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      const remaining = maxBytes - size;
      if (value.byteLength > remaining) {
        buffer.set(value.subarray(0, remaining), size);
        size += remaining;
        truncated = true;
        await reader.cancel();
        break;
      }
      buffer.set(value, size);
      size += value.byteLength;
      if (stopWhen?.(buffer.subarray(0, size), contentType)) {
        await reader.cancel();
        break;
      }
    }
    if (size === maxBytes && !truncated) {
      truncated = true;
      await reader.cancel();
    }
  } finally {
    reader.releaseLock();
  }

  return { bytes: buffer.slice(0, size), truncated };
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
    if (!safeDestination) {
      return failPublicBytes(options, new PublicFetchError(
        'invalid_url',
        'Public resource URL is invalid or blocked',
        { finalUrl: rawDestination },
      ));
    }
    const url = new URL(safeDestination);
    if (options.requireHttps && url.protocol !== 'https:') {
      return failPublicBytes(options, new PublicFetchError(
        'https_required',
        `HTTPS required for redirect destination ${url.hostname}`,
        { finalUrl: url.toString() },
      ));
    }

    let answers: ResolvedAddress[];
    try {
      answers = await resolver(unbracket(url.hostname));
    } catch (error) {
      return failPublicBytes(options, new PublicFetchError(
        'dns_failure',
        `DNS resolution failed for ${url.hostname}: ${error instanceof Error ? error.message : 'unknown error'}`,
        { finalUrl: url.toString() },
      ));
    }
    const publicAddresses = answers.filter((answer) => isPublicIpAddress(answer.address));
    if (publicAddresses.length === 0) {
      return failPublicBytes(options, new PublicFetchError(
        'no_public_address',
        `No public address available for ${url.hostname}`,
        { finalUrl: url.toString() },
      ));
    }

    let hop: PinnedResponse | null = null;
    let lastConnectError: unknown;
    for (const address of publicAddresses) {
      try {
        hop = await fetchHop(url, address.address, timeoutMs, options.headers, options.signal);
        break;
      } catch (error) {
        lastConnectError = error;
      }
    }
    if (!hop) {
      const timedOut = lastConnectError instanceof Error &&
        (lastConnectError.name === 'AbortError' || /timeout|aborted/i.test(lastConnectError.message));
      return failPublicBytes(options, new PublicFetchError(
        timedOut ? 'timeout' : 'connect_failure',
        `${timedOut ? 'Request timed out' : 'Connection failed'} for ${url.hostname}`,
        { finalUrl: url.toString() },
      ));
    }

    try {
      if (isRedirect(hop.response)) {
        const location = hop.response.headers.get('location');
        if (!location) {
          return failPublicBytes(options, new PublicFetchError(
            'redirect_missing',
            `Redirect from ${url.hostname} did not include a destination`,
            { status: hop.response.status, finalUrl: url.toString() },
          ));
        }
        if (redirectCount === maxRedirects) {
          return failPublicBytes(options, new PublicFetchError(
            'redirect_limit',
            `Redirect limit exceeded for ${url.hostname}`,
            { status: hop.response.status, finalUrl: url.toString() },
          ));
        }
        rawDestination = new URL(location, url).toString();
        continue;
      }
      if (!hop.response.ok && !options.allowedStatuses?.includes(hop.response.status)) {
        return failPublicBytes(options, new PublicFetchError(
          'http_error',
          `HTTP ${hop.response.status} from ${url.hostname}`,
          {
            status: hop.response.status,
            retryAfterMs: parseRetryAfter(hop.response.headers.get('retry-after')),
            finalUrl: url.toString(),
          },
        ));
      }
      const contentType = (hop.response.headers.get('content-type') || '')
        .split(';', 1)[0]
        .trim()
        .toLowerCase();
      if (
        options.allowedContentTypes?.length &&
        !options.allowedContentTypes.some((allowed) => contentType.startsWith(allowed))
      ) {
        return failPublicBytes(options, new PublicFetchError(
          'content_type',
          `Unexpected content type "${contentType || 'unknown'}" from ${url.hostname}`,
          { status: hop.response.status, finalUrl: url.toString() },
        ));
      }
      const responseMeta = {
        contentType,
        finalUrl: url.toString(),
        status: hop.response.status,
        headers: new Headers(hop.response.headers),
      };
      if (!hop.response.body) {
        return {
          bytes: new Uint8Array(0),
          truncated: false,
          ...responseMeta,
        };
      }
      try {
        const prefix = await readResponsePrefix(
          hop.response,
          options.maxBytes,
          contentType,
          options.stopWhen,
        );
        return prefix ? { ...prefix, ...responseMeta } : failPublicBytes(
          options,
          new PublicFetchError('body_read_failure', `Response body unavailable from ${url.hostname}`, {
            status: hop.response.status,
            finalUrl: url.toString(),
          }),
        );
      } catch (error) {
        return failPublicBytes(options, new PublicFetchError(
          error instanceof Error && (error.name === 'AbortError' || /timeout|aborted/i.test(error.message))
            ? 'timeout'
            : 'body_read_failure',
          `Response read failed for ${url.hostname}`,
          { status: hop.response.status, finalUrl: url.toString() },
        ));
      }
    } finally {
      if (!hop.response.bodyUsed) await hop.response.body?.cancel();
      await hop.close();
    }
  }

  return failPublicBytes(options, new PublicFetchError(
    'redirect_limit',
    'Redirect limit exceeded',
    { finalUrl: rawDestination },
  ));
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
