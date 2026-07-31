const RELATIVE_ORIGIN = "https://relative.invalid";

export function safeRelativePath(next: string | null | undefined, fallback = "/") {
  const safeFallback = (
    fallback.startsWith('/') &&
    !fallback.startsWith('//') &&
    !fallback.includes('\\') &&
    !/[\u0000-\u001f\u007f]/.test(fallback)
  ) ? fallback : '/';
  const candidate = next || safeFallback;
  if (
    !candidate.startsWith("/") ||
    candidate.startsWith("//") ||
    candidate.includes("\\") ||
    /[\u0000-\u001f\u007f]/.test(candidate)
  ) {
    return safeFallback;
  }

  try {
    const url = new URL(candidate, RELATIVE_ORIGIN);
    if (url.origin !== RELATIVE_ORIGIN) return safeFallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return safeFallback;
  }
}

export function safeRelativeRedirect(next: string | null | undefined, origin: string, fallback = "/") {
  return new URL(safeRelativePath(next, fallback), origin).toString();
}
