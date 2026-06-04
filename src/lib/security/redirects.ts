export function safeRelativeRedirect(next: string | null | undefined, origin: string, fallback = "/") {
  const candidate = next || fallback;
  if (
    !candidate.startsWith("/") ||
    candidate.startsWith("//") ||
    candidate.includes("\\") ||
    /[\u0000-\u001f\u007f]/.test(candidate)
  ) {
    return new URL(fallback, origin).toString();
  }

  const url = new URL(candidate, origin);
  return url.origin === origin ? url.toString() : new URL(fallback, origin).toString();
}
