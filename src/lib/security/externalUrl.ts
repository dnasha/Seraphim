export type SafeExternalHttpUrl = {
  href: string;
  hostname: string;
};

/** Parses a stored outbound link without ever throwing in a render path. */
export function safeExternalHttpUrl(rawUrl: unknown): SafeExternalHttpUrl | null {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) return null;

  try {
    const url = new URL(rawUrl);
    if (
      (url.protocol !== 'http:' && url.protocol !== 'https:') ||
      url.username ||
      url.password
    ) return null;
    return { href: url.toString(), hostname: url.hostname };
  } catch {
    return null;
  }
}
