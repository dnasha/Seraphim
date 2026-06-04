const MAX_OG_IMAGE_BYTES = 5 * 1024 * 1024;

function isPrivateIPv4(hostname: string) {
  const parts = hostname.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }
  const [a, b] = parts;
  return (
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a === 0
  );
}

function isBlockedHostname(hostname: string) {
  const normalized = hostname.toLowerCase();
  return (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".local") ||
    normalized === "::1" ||
    isPrivateIPv4(normalized)
  );
}

export function validatePublicImageUrl(rawUrl: string) {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (isBlockedHostname(url.hostname)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export async function safeReadImageResponse(response: Response) {
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.toLowerCase().startsWith("image/")) return null;

  const contentLength = Number(response.headers.get("content-length") || 0);
  if (contentLength > MAX_OG_IMAGE_BYTES) return null;

  const arrayBuffer = await response.arrayBuffer();
  if (arrayBuffer.byteLength > MAX_OG_IMAGE_BYTES) return null;
  return { contentType, arrayBuffer };
}
