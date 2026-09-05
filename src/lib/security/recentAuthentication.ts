const REAUTH_WINDOW_MS = 10 * 60 * 1000;
const INTERACTIVE_METHODS = new Set([
  'password', 'oauth', 'otp', 'totp', 'recovery', 'magiclink', 'sso/saml', 'email/signup',
]);

/** Accept only verified claims for the requesting user's current session. */
export function hasRecentAuthentication(claims: unknown, userId: string, now = Date.now()): boolean {
  if (!claims || typeof claims !== 'object') return false;
  const value = claims as Record<string, unknown>;
  if (value.sub !== userId || typeof value.session_id !== 'string' || !value.session_id) return false;
  if (!Array.isArray(value.amr)) return false;
  return value.amr.some((entry: unknown) => {
    if (!entry || typeof entry !== 'object') return false;
    const { method, timestamp } = entry as Record<string, unknown>;
    if (typeof method !== 'string' || !INTERACTIVE_METHODS.has(method) || typeof timestamp !== 'number') return false;
    const age = now - timestamp * 1000;
    return Number.isFinite(age) && age >= 0 && age <= REAUTH_WINDOW_MS;
  });
}
