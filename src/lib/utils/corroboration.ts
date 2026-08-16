export interface PublisherReport {
  name?: string | null;
  url?: string | null;
  source_type?: string | null;
  title?: string | null;
  content_fingerprint?: string | null;
}

const MULTI_LABEL_PUBLIC_SUFFIXES = new Set([
  "co.uk", "org.uk", "com.au", "net.au", "co.nz", "co.za",
  "com.br", "com.mx", "co.jp", "co.kr", "com.sg", "com.tr",
]);

function normalizeName(name?: string | null): string {
  return (name ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function contentFingerprint(title?: string | null): string {
  return (title ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/&(?:amp;)?/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function registrableDomain(rawUrl?: string | null): string {
  if (!rawUrl) return "";
  try {
    const hostname = new URL(rawUrl).hostname
      .toLocaleLowerCase("en-US")
      .replace(/^(?:www|m|amp)\./, "")
      .replace(/\.$/, "");
    if (!hostname || hostname === "localhost" || /^\d+(?:\.\d+){3}$/.test(hostname)) {
      return hostname;
    }

    const labels = hostname.split(".");
    if (labels.length <= 2) return hostname;
    const suffix = labels.slice(-2).join(".");
    return MULTI_LABEL_PUBLIC_SUFFIXES.has(suffix)
      ? labels.slice(-3).join(".")
      : suffix;
  } catch {
    return "";
  }
}

function socialAccountKey(report: PublisherReport): string {
  const name = normalizeName(report.name);
  if (name) return name;
  try {
    const url = new URL(report.url ?? "");
    return `${url.hostname.toLocaleLowerCase("en-US")}/${url.pathname.split("/").filter(Boolean)[0] ?? ""}`;
  } catch {
    return "";
  }
}

/**
 * Returns the editorial origin used for corroboration. RSS/GNews reports are
 * grouped at the publisher-domain level; social reports retain account-level
 * independence instead of collapsing an entire platform into one source.
 */
export function publisherKey(report: PublisherReport): string {
  if (report.source_type === "social") {
    const account = socialAccountKey(report);
    if (account) return `social:${account}`;
  }

  const domain = registrableDomain(report.url);
  if (domain) return `domain:${domain}`;

  const name = normalizeName(report.name);
  return name ? `name:${name}` : "unknown";
}

export function countIndependentSources(
  primary: PublisherReport,
  corroborators: PublisherReport[] = [],
): number {
  const publishers = new Set<string>();
  const fingerprints = new Set<string>();
  let independentCount = 0;

  for (const report of [primary, ...corroborators]) {
    const publisher = publisherKey(report);
    if (publisher === "unknown" || publishers.has(publisher)) continue;
    publishers.add(publisher);

    const fingerprint = report.content_fingerprint || contentFingerprint(report.title);
    if (fingerprint && fingerprints.has(fingerprint)) continue;
    if (fingerprint) fingerprints.add(fingerprint);
    independentCount++;
  }

  return Math.max(1, independentCount);
}

/**
 * Keeps the existing single-report credibility baseline, then awards volume
 * only when another editorial origin independently reports the event.
 */
export function calculateImpactScore(
  credibilityTier: number,
  independentPublisherCount: number,
): number {
  const tier = Number.isFinite(credibilityTier)
    ? Math.min(3, Math.max(1, credibilityTier))
    : 3;
  const count = Number.isFinite(independentPublisherCount)
    ? Math.max(1, Math.floor(independentPublisherCount))
    : 1;
  const baseScore = 3.5 - tier;
  return baseScore + (count - 1) * (5 - tier);
}
