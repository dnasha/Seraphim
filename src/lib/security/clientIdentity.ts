import 'server-only';

import { isIP } from 'node:net';

const VERCEL_CLIENT_IP_HEADER = 'x-vercel-forwarded-for';

/**
 * Returns the client address injected by Vercel's edge. Deliberately do not
 * fall back to X-Forwarded-For: callers can supply that header themselves.
 */
export function getTrustedClientIp(headers: Headers): string | null {
  const value = headers.get(VERCEL_CLIENT_IP_HEADER)?.trim();
  if (!value || value.includes(',') || isIP(value) === 0) return null;
  return value;
}

export function getRateLimitKeys(clientIp: string, userId?: string | null) {
  return [
    `net:${clientIp}`,
    ...(userId ? [`user:${userId}`] : []),
  ];
}
